import { and, eq, ne, sql } from 'drizzle-orm';
import { guard, lockAsAdmin, type AccountActionError, type AdminActor, type Tx } from '@/lib/admin/accounts/service';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { departments, directoryUsers, employeeIdentities, employees } from '@/lib/db/schema';
import { CHANGE_FIELDS, fieldChanges, type ChangeField, type FieldChange } from '@/lib/directory/review';
import { directoryIssuer } from '@/lib/directory/service';

export type EmployeeActionResult =
  | { ok: true; employeeId?: string; applied?: number }
  | { ok: false; error: AccountActionError; detail?: string };

const fail = (error: AccountActionError, detail?: string): EmployeeActionResult => ({ ok: false, error, detail });

/** New employees start as staff or finance; admin is granted afterwards through the audited role change. */
const CREATE_ROLES = ['staff', 'finance'] as const;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
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
