import { and, eq, ne, sql } from 'drizzle-orm';
import { guard, lockAsAdmin, type AccountActionError, type AdminActor, type Tx } from '@/lib/admin/accounts/service';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { departments, directoryUsers, employeeIdentities, employees } from '@/lib/db/schema';
import {
  EMPLOYEE_CODE,
  parseEmployeeWorkbook,
  planEmployeeImport,
  workbookHash,
  WorkbookRejected,
  type ImportPlan,
} from '@/lib/admin/employees/import';
import { CHANGE_FIELDS, fieldChanges, type ChangeField, type FieldChange } from '@/lib/directory/review';
import { directoryIssuer } from '@/lib/directory/service';

export type EmployeeActionResult =
  | { ok: true; employeeId?: string; applied?: number }
  | { ok: false; error: AccountActionError; detail?: string };

const fail = (error: AccountActionError, detail?: string): EmployeeActionResult => ({ ok: false, error, detail });

/** New employees start as staff or finance; admin is granted afterwards through the audited role change. */
const CREATE_ROLES = ['staff', 'finance'] as const;
const CODE = EMPLOYEE_CODE;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (v.length > max) return undefined;
  return v === '' ? null : v;
}

export type EmployeeFields = {
  employeeCode: string;
  name: string;
  departmentId: string;
  title: string | null;
  googleEmail: string | null;
  phone: string | null;
  extension: string | null;
};

/** Validates admin-entered employee fields; null when anything is malformed. */
export function parseEmployeeFields(raw: unknown): EmployeeFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const employeeCode = text(r.employeeCode, 32);
  const name = text(r.name, 100);
  const title = text(r.title, 100);
  const email = text(r.googleEmail, 200);
  const phone = text(r.phone, 40);
  const extension = text(r.extension, 20);
  if (!employeeCode || !CODE.test(employeeCode) || !name || !isUuid(r.departmentId)) return null;
  if (title === undefined || email === undefined || phone === undefined || extension === undefined) return null;
  if (email && !EMAIL.test(email)) return null;
  return {
    employeeCode,
    name,
    departmentId: r.departmentId as string,
    title,
    googleEmail: email?.toLowerCase() ?? null,
    phone,
    extension,
  };
}

/** Code / email uniqueness against other employees; runs under the admin lock. */
async function conflict(tx: Tx, f: { employeeCode?: string; googleEmail?: string | null }, exceptId?: string) {
  const others = exceptId ? ne(employees.id, exceptId) : undefined;
  if (f.employeeCode) {
    const [hit] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.employeeCode, f.employeeCode), others));
    if (hit) return fail('duplicate_code', f.employeeCode);
  }
  if (f.googleEmail) {
    const [hit] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(sql`lower(${employees.googleEmail}) = ${f.googleEmail}`, others));
    if (hit) return fail('duplicate_email', f.googleEmail);
  }
  return null;
}

async function departmentExists(tx: Tx, id: string): Promise<boolean> {
  const [dept] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, id), eq(departments.active, true)));
  return Boolean(dept);
}

/** Manual entry (before Workspace sync, or for people without a Workspace account). */
export async function createEmployee(actor: AdminActor | null, input: unknown): Promise<EmployeeActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  const fields = parseEmployeeFields(input);
  const role = (input as { role?: unknown })?.role ?? 'staff';
  if (!fields || typeof role !== 'string' || !(CREATE_ROLES as readonly string[]).includes(role)) return fail('invalid_input');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    if (!(await departmentExists(tx, fields.departmentId))) return fail('invalid_input');
    const clash = await conflict(tx, fields);
    if (clash) return clash;
    const [row] = await tx.insert(employees).values({ ...fields, role }).returning({ id: employees.id });
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'employee.created',
      entityType: 'employee',
      entityId: row.id,
      details: { source: 'manual', employeeCode: fields.employeeCode, email: fields.googleEmail, role },
    });
    return { ok: true, employeeId: row.id };
  });
}

const EDITABLE: (keyof EmployeeFields)[] = ['employeeCode', 'name', 'departmentId', 'title', 'googleEmail', 'phone', 'extension'];

/**
 * Replaces an employee's basic data. Role, access and login bindings have their
 * own audited actions on /admin/accounts; changing the record email does not
 * move a login binding.
 */
export async function updateEmployee(actor: AdminActor | null, input: { employeeId: string } & Record<string, unknown>): Promise<EmployeeActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  const fields = parseEmployeeFields(input);
  if (!isUuid(input?.employeeId) || !fields) return fail('invalid_input');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const [before] = await tx.select().from(employees).where(eq(employees.id, input.employeeId)).for('update');
    if (!before) return fail('not_found');
    const changes = EDITABLE.filter((k) => (before[k] ?? null) !== fields[k]).map((k) => ({ field: k, from: before[k] ?? null, to: fields[k] }));
    if (changes.length === 0) return { ok: true, employeeId: before.id };
    if (fields.departmentId !== before.departmentId && !(await departmentExists(tx, fields.departmentId))) return fail('invalid_input');
    const clash = await conflict(
      tx,
      {
        employeeCode: fields.employeeCode !== before.employeeCode ? fields.employeeCode : undefined,
        googleEmail: fields.googleEmail !== (before.googleEmail?.toLowerCase() ?? null) ? fields.googleEmail : null,
      },
      before.id
    );
    if (clash) return clash;
    await tx.update(employees).set(fields).where(eq(employees.id, before.id));
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'employee.updated',
      entityType: 'employee',
      entityId: before.id,
      details: { source: 'manual', changes },
    });
    return { ok: true, employeeId: before.id };
  });
}

/**
 * Creates an employee from an active directory account. Name, email, phone and
 * title come from the snapshot on the server; the admin only chooses the code,
 * department and role. No login binding is made: the person signs in once and
 * the link request is approved on /admin/accounts.
 */
export async function createEmployeeFromDirectory(
  actor: AdminActor | null,
  input: { directoryUserId: string; employeeCode: string; departmentId: string; role?: string }
): Promise<EmployeeActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  const code = typeof input?.employeeCode === 'string' ? input.employeeCode.trim() : '';
  const role = input.role ?? 'staff';
  if (typeof input.directoryUserId !== 'string' || !/^[0-9]{1,32}$/.test(input.directoryUserId)) return fail('invalid_input');
  if (!CODE.test(code) || !isUuid(input.departmentId) || !(CREATE_ROLES as readonly string[]).includes(role)) return fail('invalid_input');

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const [dir] = await tx.select().from(directoryUsers).where(eq(directoryUsers.directoryUserId, input.directoryUserId));
    if (!dir) return fail('not_found');
    if (dir.suspended || dir.archived || dir.removedAt) return fail('invalid_state');
    const [bound] = await tx
      .select({ id: employeeIdentities.id })
      .from(employeeIdentities)
      .where(and(eq(employeeIdentities.provider, 'google'), eq(employeeIdentities.issuer, directoryIssuer()), eq(employeeIdentities.subject, dir.directoryUserId)));
    if (bound) return fail('invalid_state');
    if (!(await departmentExists(tx, input.departmentId))) return fail('invalid_input');
    const clash = await conflict(tx, { employeeCode: code, googleEmail: dir.primaryEmail });
    if (clash) return clash;

    const [row] = await tx
      .insert(employees)
      .values({
        employeeCode: code,
        name: dir.fullName.trim() || dir.primaryEmail,
        departmentId: input.departmentId,
        title: dir.title,
        googleEmail: dir.primaryEmail,
        phone: dir.phone,
        role,
      })
      .returning({ id: employees.id });
    await recordAudit(tx, {
      actorEmployeeId: actor!.id,
      action: 'employee.created',
      entityType: 'employee',
      entityId: row.id,
      details: { source: 'directory', directoryUserId: dir.directoryUserId, employeeCode: code, email: dir.primaryEmail, role },
    });
    return { ok: true, employeeId: row.id };
  });
}

export type DirectoryChangeItem = { employeeId: string; directoryUserId: string; fields: string[] };

/**
 * Copies directory values onto employee records, in one transaction. Values are
 * re-read from the snapshot; the client only says which fields. The employee
 * must be linked to that account by a login binding, or (before the first
 * login) unbound and carrying the same Workspace email or employee code.
 * Rows that already match are skipped; any other problem aborts the batch.
 */
export async function applyDirectoryChanges(
  actor: AdminActor | null,
  input: { items: DirectoryChangeItem[] }
): Promise<EmployeeActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0 || items.length > 200) return fail('invalid_input');
  for (const item of items) {
    if (!isUuid(item?.employeeId) || typeof item.directoryUserId !== 'string' || !/^[0-9]{1,32}$/.test(item.directoryUserId)) return fail('invalid_input');
    if (!Array.isArray(item.fields) || item.fields.length === 0) return fail('invalid_input');
    if (!item.fields.every((f) => (CHANGE_FIELDS as readonly string[]).includes(f))) return fail('invalid_input');
  }
  if (new Set(items.map((i) => i.employeeId)).size !== items.length) return fail('invalid_input');

  const issuer = directoryIssuer();
  try {
    return await getDb().transaction(async (tx) => {
      if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
      let applied = 0;
      for (const item of items) {
        const outcome = await applyOne(tx, item, issuer, actor!.id);
        if (outcome === 'applied') applied++;
        else if (outcome !== 'skipped') throw new Rollback(outcome);
      }
      return { ok: true, applied };
    });
  } catch (err) {
    if (err instanceof Rollback) return err.result;
    throw err;
  }
}

/** Thrown to undo earlier rows of a batch; returning from a transaction callback commits. */
class Rollback extends Error {
  constructor(readonly result: EmployeeActionResult) {
    super('rollback');
  }
}

async function applyOne(
  tx: Tx,
  item: DirectoryChangeItem,
  issuer: string,
  actorId: string
): Promise<'applied' | 'skipped' | EmployeeActionResult> {
  const [dir] = await tx.select().from(directoryUsers).where(eq(directoryUsers.directoryUserId, item.directoryUserId));
  if (!dir) return fail('not_found');
  if (dir.suspended || dir.archived || dir.removedAt) return fail('invalid_state', dir.primaryEmail);
  const [emp] = await tx
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      googleEmail: employees.googleEmail,
      phone: employees.phone,
      title: employees.title,
    })
    .from(employees)
    .where(eq(employees.id, item.employeeId))
    .for('update');
  if (!emp) return fail('not_found');

  const google = and(eq(employeeIdentities.provider, 'google'), eq(employeeIdentities.issuer, issuer));
  const identities = await tx
    .select({ subject: employeeIdentities.subject, revokedAt: employeeIdentities.revokedAt })
    .from(employeeIdentities)
    .where(and(google, eq(employeeIdentities.employeeId, emp.id)));
  const [subjectOwner] = await tx
    .select({ employeeId: employeeIdentities.employeeId })
    .from(employeeIdentities)
    .where(and(google, eq(employeeIdentities.subject, dir.directoryUserId)));
  const linkedByLogin = identities.some((i) => i.subject === dir.directoryUserId);
  const boundElsewhere = identities.some((i) => i.revokedAt === null && i.subject !== dir.directoryUserId);
  const sameRecord =
    (emp.googleEmail ?? '').toLowerCase() === dir.primaryEmail || (dir.employeeCode !== null && dir.employeeCode === emp.employeeCode);
  if (!linkedByLogin && (subjectOwner || boundElsewhere || !sameRecord)) return fail('invalid_state', emp.employeeCode);

  const wanted = new Set(item.fields as ChangeField[]);
  const changes: FieldChange[] = fieldChanges(dir, emp).filter((c) => wanted.has(c.field));
  if (changes.length === 0) return 'skipped';

  const set: Partial<typeof employees.$inferInsert> = {};
  for (const c of changes) {
    if (c.field === 'name') set.name = c.next;
    if (c.field === 'email') set.googleEmail = c.next;
    if (c.field === 'phone') set.phone = c.next;
    if (c.field === 'title') set.title = c.next;
  }
  if (set.googleEmail) {
    const clash = await conflict(tx, { googleEmail: set.googleEmail }, emp.id);
    if (clash) return clash;
  }
  await tx.update(employees).set(set).where(eq(employees.id, emp.id));
  await recordAudit(tx, {
    actorEmployeeId: actorId,
    action: 'employee.directory_updated',
    entityType: 'employee',
    entityId: emp.id,
    details: { directoryUserId: dir.directoryUserId, changes: changes.map((c) => ({ field: c.field, from: c.current, to: c.next })) },
  });
  return 'applied';
}

export type ImportPreviewResult = { ok: true; plan: ImportPlan; sha256: string } | { ok: false; error: AccountActionError; detail?: string };

const WORKBOOK_REASONS: Record<string, string> = {
  file_too_large: '檔案超過 5 MB',
  too_many_rows: '超過 5000 列',
  missing_link_sheet: '找不到工作表「link」',
};

async function readWorkbook(buffer: Buffer) {
  try {
    return { ok: true as const, rows: await parseEmployeeWorkbook(buffer) };
  } catch (err) {
    const reason = err instanceof WorkbookRejected ? (WORKBOOK_REASONS[err.message] ?? '檔案格式不正確') : '無法讀取此 Excel 檔案';
    return { ok: false as const, result: fail('invalid_input', reason) };
  }
}

async function planFor(tx: Tx | ReturnType<typeof getDb>, rows: Awaited<ReturnType<typeof parseEmployeeWorkbook>>) {
  const [employeeRows, departmentRows] = await Promise.all([
    tx
      .select({ id: employees.id, employeeCode: employees.employeeCode, name: employees.name, departmentId: employees.departmentId, title: employees.title })
      .from(employees),
    tx.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(eq(departments.active, true)),
  ]);
  return planEmployeeImport(rows, employeeRows, departmentRows);
}

/** Read-only: what importing the workbook would change. */
export async function previewEmployeeImport(actor: AdminActor | null, buffer: Buffer): Promise<ImportPreviewResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied) as ImportPreviewResult;
  const parsed = await readWorkbook(buffer);
  if (!parsed.ok) return parsed.result as ImportPreviewResult;
  return { ok: true, plan: await planFor(getDb(), parsed.rows), sha256: workbookHash(buffer) };
}

/**
 * Applies the rows the admin kept from the preview. The same file must be sent
 * again (checked by hash) and the plan is recomputed under the admin lock, so
 * only changes still valid at that moment are made, all in one transaction.
 */
export async function applyEmployeeImport(
  actor: AdminActor | null,
  input: { buffer: Buffer; sha256: string; include: string[] }
): Promise<EmployeeActionResult> {
  const denied = await guard(actor);
  if (denied) return fail(denied);
  if (!Array.isArray(input?.include) || input.include.length === 0 || input.include.some((c) => typeof c !== 'string')) return fail('invalid_input');
  if (workbookHash(input.buffer) !== input.sha256) return fail('invalid_state', '檔案與預覽時不同，請重新預覽');
  const parsed = await readWorkbook(input.buffer);
  if (!parsed.ok) return parsed.result;
  const include = new Set(input.include);

  return getDb().transaction(async (tx) => {
    if (!(await lockAsAdmin(tx, actor!.id))) return fail('forbidden');
    const plan = await planFor(tx, parsed.rows);
    let applied = 0;
    for (const c of plan.creates.filter((c) => include.has(c.employeeCode))) {
      const [row] = await tx
        .insert(employees)
        .values({ employeeCode: c.employeeCode, name: c.name, departmentId: c.departmentId, title: c.title, role: 'staff' })
        .returning({ id: employees.id });
      await recordAudit(tx, {
        actorEmployeeId: actor!.id,
        action: 'employee.created',
        entityType: 'employee',
        entityId: row.id,
        details: { source: 'excel', employeeCode: c.employeeCode, row: c.rowNumber },
      });
      applied++;
    }
    for (const u of plan.updates.filter((u) => include.has(u.employeeCode))) {
      await tx.update(employees).set({ name: u.name, departmentId: u.departmentId, title: u.title }).where(eq(employees.id, u.employeeId));
      await recordAudit(tx, {
        actorEmployeeId: actor!.id,
        action: 'employee.updated',
        entityType: 'employee',
        entityId: u.employeeId,
        details: { source: 'excel', row: u.rowNumber, changes: u.changes.map((c) => ({ field: c.field, from: c.current, to: c.next })) },
      });
      applied++;
    }
    return { ok: true, applied };
  });
}
