import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PURCHASE_ADMIN_SAMPLE } from '@/lib/custom-forms/samples';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';

const currentEmployee: { value: unknown } = { value: null };
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => currentEmployee.value }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('designer form runtime (form_submissions, form_type custom)', () => {
  let sql: Sql;
  const tag = `cf${Date.now()}`;
  const key = `${tag}-buy`;
  const ids = {} as Record<'dept' | 'other' | 'mgr' | 'applicant' | 'owner' | 'handler' | 'outsider' | 'budget' | 'gm' | 'chairman', string>;
  const submissionIds: string[] = [];

  const actor = (id: string) => ({ id });
  const asEmployee = (id: string, departmentId = ids.dept, role = 'staff') => {
    currentEmployee.value = { id, departmentId, role };
  };
  const data = (overrides: Record<string, unknown> = {}) => ({
    subject: '文具',
    urgency: 'normal',
    neededBy: addDays(taipeiToday(), 3),
    budget: ids.budget,
    handler: ids.handler,
    needsIt: false,
    items: { rows: [{ name: '原子筆', qty: '10', unitPrice: '12.5', amount: '999' }], total: '1' },
    ...overrides,
  });
  const versionOf = async (id: string) => Number((await sql`select version from form_submissions where id = ${id}`)[0].version);
  const steps = async (id: string) =>
    (
      await sql`select approver_employee_id, approver_role, status from approval_steps
        where form_type = 'custom' and form_id = ${id} order by step_order`
    ).map((s) => [s.approver_role, s.approver_employee_id, s.status]);

  const publish = async (input: Record<string, unknown>) => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    return runInTransaction('test.publish', async (tx) => ({
      ok: true as const,
      ...(await publishDefinition(tx, { ...clone(PURCHASE_ADMIN_SAMPLE), key, actorId: ids.mgr, ...input } as never)),
    }));
  };
  const create = async (who: string, d: unknown, extra: { key?: string; fileCount?: number } = {}) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission(actor(who), extra.key ?? key, {
      data: d,
      idempotencyKey: crypto.randomUUID(),
      fileCount: extra.fileCount ?? 0,
    });
    if (r.ok && !submissionIds.includes(r.submissionId)) submissionIds.push(r.submissionId);
    return r;
  };

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '表單測試部', ${ids.mgr}) returning id`)[0].id;
    ids.other = (await sql`insert into departments (code, name) values (${`${tag}-O`}, '其他部門') returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.applicant = await employee('applicant', ids.dept);
    ids.owner = await employee('owner', ids.dept);
    ids.handler = await employee('handler', ids.dept);
    ids.outsider = await employee('outsider', ids.other);
    ids.budget = (
      await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
        values (${`${tag}-BC`}, ${ids.dept}, '文具', '115', 100000, ${ids.owner}) returning id`
    )[0].id;
    const primary = (code: string) => sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
      where j.code = ${code} and r.department_id is null and r.is_primary`;
    ids.gm = (await primary('general_manager'))[0].employee_id;
    ids.chairman = (await primary('chairman'))[0].employee_id;
  });

  afterAll(async () => {
    // Definitions and their published versions are immutable by design and stay in the disposable test database.
    if (submissionIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    await sql`delete from budget_codes where id = ${ids.budget}`;
  });

  it('refuses invalid definitions and unknown flow references', async () => {
    const badSchema = await publish({ schema: { version: 1, sections: [] } });
    expect(badSchema).toMatchObject({ ok: false, code: 'validation' });

    const flow = clone(PURCHASE_ADMIN_SAMPLE.flow) as unknown as { blocks: unknown[] };
    flow.blocks.unshift({ id: 'ghost', type: 'approver', label: '不存在的人', source: { kind: 'employee', employeeId: crypto.randomUUID() } });
    const ghost = await publish({ flow });
    expect(ghost).toMatchObject({ ok: false, code: 'validation' });
    if (!ghost.ok) expect(ghost.error).toContain('員工');

    expect(await publish({ numberPrefix: 'ga' })).toMatchObject({ ok: false, code: 'validation' });
    expect(await publish({ categoryKey: 'no_such_category' })).toMatchObject({ ok: false, code: 'validation' });
    const [{ n }] = await sql`select count(*)::int as n from form_definitions where key = ${key}`;
    expect(n).toBe(0);
  });

  it('publishes immutable versions with a fixed key', async () => {
    const v1 = await publish({});
    expect(v1).toMatchObject({ ok: true, version: 1 });
    if (!v1.ok) return;
    const [def] = await sql`select status, published_version_id from form_definitions where id = ${v1.definitionId}`;
    expect(def).toEqual({ status: 'published', published_version_id: v1.versionId });

    await expect(sql`update form_definition_versions set flow = '{}'::jsonb where id = ${v1.versionId}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`delete from form_definition_versions where id = ${v1.versionId}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`update form_definitions set key = ${`${key}-x`} where id = ${v1.definitionId}`).rejects.toMatchObject({ code: '23514' });
    // A published version must belong to the definition.
    const other = await sql`select id from form_definition_versions where definition_id <> ${v1.definitionId} limit 1`;
    if (other.length > 0) {
      await expect(sql`update form_definitions set published_version_id = ${other[0].id} where id = ${v1.definitionId}`).rejects.toMatchObject({
        code: '23503',
      });
    }
  });

  it('runs create → approve → return → resubmit → update → approve to the end', async () => {
    const service = await import('@/lib/custom-forms/service');
    const created = await create(ids.applicant, { ...data(), injected: '<script>' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.submissionId;
    expect(created.formNumber).toMatch(new RegExp(`^${taipeiToday().replaceAll('-', '')}GA\\d{4}$`));

    const [row] = await sql`select status, current_step_order, total_amount, budget_code_id, data, department_id from form_submissions where id = ${id}`;
    expect(row).toMatchObject({ status: 'pending_approval', current_step_order: 1, total_amount: '125.00', budget_code_id: ids.budget, department_id: ids.dept });
    // Client totals are recomputed, unknown keys dropped.
    expect(row.data.items).toEqual({ rows: [{ name: '原子筆', qty: 10, unitPrice: '12.50', amount: '125.00' }], total: '125.00' });
    expect(row.data).not.toHaveProperty('injected');
    expect(await steps(id)).toEqual([
      ['step:dept_manager', ids.mgr, 'pending'],
      ['step:budget_owner', ids.owner, 'pending'],
      ['step:handler', ids.handler, 'pending'],
      ['step:general_manager', ids.gm, 'pending'],
    ]);
    const [note] = await sql`select recipient_employee_id, message, case_number from notifications where form_type = 'custom' and form_id = ${id}`;
    expect(note).toMatchObject({ recipient_employee_id: ids.mgr, case_number: created.formNumber });
    expect(note.message).toContain('行政採買申請單');

    expect(await service.approveSubmissionStep(actor(ids.owner), id, await versionOf(id))).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await service.approveSubmissionStep(actor(ids.mgr), id, await versionOf(id))).ok).toBe(true);
    expect(await service.withdrawSubmission(actor(ids.applicant), id)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await service.reviseSubmission(actor(ids.applicant), id, 'update', { data: data(), expectedVersion: await versionOf(id), newFileCount: 0 })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    expect(await service.returnSubmissionStep(actor(ids.owner), id, ' ', await versionOf(id))).toMatchObject({ ok: false, code: 'validation' });
    expect((await service.returnSubmissionStep(actor(ids.owner), id, '金額請再確認', await versionOf(id))).ok).toBe(true);
    let [form] = await sql`select status, current_step_order from form_submissions where id = ${id}`;
    expect(form).toEqual({ status: 'returned', current_step_order: null });

    // Resubmit over NT$100,000 without a handler: the handler step is skipped, the chairman branch is taken.
    const big = data({ handler: '', items: { rows: [{ name: '筆電', qty: 3, unitPrice: '40000' }] } });
    expect(await service.reviseSubmission(actor(ids.outsider), id, 'resubmit', { data: big, expectedVersion: await versionOf(id), newFileCount: 0 })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect((await service.reviseSubmission(actor(ids.applicant), id, 'resubmit', { data: big, expectedVersion: await versionOf(id), newFileCount: 0 })).ok).toBe(true);
    expect(await steps(id)).toEqual([
      ['step:dept_manager', ids.mgr, 'pending'],
      ['step:budget_owner', ids.owner, 'pending'],
      ['step:handler', null, 'skipped'],
      ['step:general_manager', ids.gm, 'pending'],
      // Collapsed into the general manager's signature when one person holds both roles.
      ['step:chairman', ids.chairman, ids.chairman === ids.gm ? 'auto_approved' : 'pending'],
    ]);
    [form] = await sql`select status, current_step_order, total_amount from form_submissions where id = ${id}`;
    expect(form).toEqual({ status: 'pending_approval', current_step_order: 1, total_amount: '120000.00' });

    // Nobody decided yet in this round: the applicant may still edit (stale version refused).
    expect(await service.reviseSubmission(actor(ids.applicant), id, 'update', { data: big, expectedVersion: 1, newFileCount: 0 })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    expect((await service.reviseSubmission(actor(ids.applicant), id, 'update', { data: { ...big, subject: '筆電採購' }, expectedVersion: await versionOf(id), newFileCount: 0 })).ok).toBe(true);
    const audits = await sql`select action from audit_events where entity_type = 'custom' and entity_id = ${id} order by id`;
    expect(audits.map((a) => a.action)).toEqual([
      'custom.created',
      'custom.step_approved',
      'custom.step_returned',
      'custom.resubmitted',
      'custom.updated',
    ]);

    for (const approver of new Set([ids.mgr, ids.owner, ids.gm, ids.chairman])) {
      expect((await service.approveSubmissionStep(actor(approver), id, await versionOf(id))).ok).toBe(true);
    }
    [form] = await sql`select status, current_step_order from form_submissions where id = ${id}`;
    expect(form).toEqual({ status: 'approved', current_step_order: null });
    const [done] = await sql`select recipient_employee_id from notifications where form_type = 'custom' and form_id = ${id} and type = 'request_approved'`;
    expect(done.recipient_employee_id).toBe(ids.applicant);
  });

  it('keeps a submission on the version it was filed with', async () => {
    const service = await import('@/lib/custom-forms/service');
    const created = await create(ids.applicant, data());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const [before] = await sql`select version_id from form_submissions where id = ${created.submissionId}`;

    const schema = clone(PURCHASE_ADMIN_SAMPLE.schema) as unknown as { sections: { fields: unknown[] }[] };
    schema.sections[0].fields.push({ id: 'project', type: 'text', label: '專案名稱', required: true });
    const v2 = await publish({ schema });
    expect(v2).toMatchObject({ ok: true, version: 2 });

    // The old submission is still validated against v1 (no 'project' field needed)…
    const updated = await service.reviseSubmission(actor(ids.applicant), created.submissionId, 'update', {
      data: data({ subject: '改主旨' }),
      expectedVersion: await versionOf(created.submissionId),
      newFileCount: 0,
    });
    expect(updated.ok).toBe(true);
    const [after] = await sql`select version_id, data from form_submissions where id = ${created.submissionId}`;
    expect(after.version_id).toBe(before.version_id);
    expect(after.data).not.toHaveProperty('project');
    // …while new submissions use v2.
    const fresh = await create(ids.applicant, data());
    expect(fresh).toMatchObject({ ok: false, code: 'validation' });
    if (!fresh.ok) expect(fresh.error).toContain('專案名稱');
    expect((await create(ids.applicant, data({ project: 'X' }))).ok).toBe(true);
  });

  it('replays a repeated submit and refuses a reused key with different content', async () => {
    const service = await import('@/lib/custom-forms/service');
    const idempotencyKey = crypto.randomUUID();
    const d = data({ project: 'idem' });
    const first = await service.createSubmission(actor(ids.applicant), key, { data: d, idempotencyKey, fileCount: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    submissionIds.push(first.submissionId);
    const again = await service.createSubmission(actor(ids.applicant), key, { data: d, idempotencyKey, fileCount: 0 });
    expect(again).toMatchObject({ ok: true, submissionId: first.submissionId, replayed: true });
    const changed = await service.createSubmission(actor(ids.applicant), key, { data: { ...d, subject: '別的' }, idempotencyKey, fileCount: 0 });
    expect(changed).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('hides restricted, unpublished and unknown forms the same way', async () => {
    const restricted = `${tag}-r`;
    const pub = await publish({ key: restricted, visibility: { departmentIds: [ids.other] } });
    expect(pub.ok).toBe(true);
    const denied = await create(ids.applicant, data(), { key: restricted });
    const unknown = await create(ids.applicant, data(), { key: `${tag}-none` });
    expect(denied).toMatchObject({ ok: false, code: 'not_found' });
    expect(unknown).toMatchObject({ ok: false, code: 'not_found' });
    if (!denied.ok && !unknown.ok) expect(denied.error).toBe(unknown.error);

    const queries = await import('@/lib/custom-forms/queries');
    asEmployee(ids.applicant);
    expect(await queries.getNewFormContext(restricted)).toBeNull();
    expect((await queries.getFilableDefinitions()).map((d) => d.key)).not.toContain(restricted);
    asEmployee(ids.outsider, ids.other);
    expect((await queries.getFilableDefinitions()).map((d) => d.key)).toContain(restricted);

    await sql`update form_definitions set status = 'archived' where key = ${restricted}`;
    expect(await create(ids.outsider, data(), { key: restricted })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('lets only the applicant, approvers, finance and admin read a submission', async () => {
    const created = await create(ids.applicant, data({ project: 'read' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const queries = await import('@/lib/custom-forms/queries');
    const read = async (id: string, departmentId: string, role = 'staff') => {
      asEmployee(id, departmentId, role);
      return queries.getSubmissionDetail(created.submissionId);
    };
    expect(await read(ids.outsider, ids.other)).toBeNull();
    expect(await read(ids.outsider, ids.other, 'finance')).not.toBeNull();
    const asApplicant = await read(ids.applicant, ids.dept);
    expect(asApplicant).toMatchObject({
      key,
      canEdit: true,
      isOwner: true,
      filerName: null,
      canAttach: true,
      isCurrentApprover: false,
      labels: { [ids.budget]: `表單測試部：owner（文具｜${tag}-BC）` },
    });
    const asMgr = await read(ids.mgr, ids.dept);
    expect(asMgr).toMatchObject({ canEdit: false, isOwner: false, canAttach: false, isCurrentApprover: true });

    asEmployee(ids.mgr);
    const queue = await queries.getMyCustomApprovalQueue();
    expect(queue.find((q) => q.id === created.submissionId)).toMatchObject({ formType: 'custom', label: '行政採買申請單', caseNumber: created.formNumber });
    asEmployee(ids.owner);
    expect((await queries.getMyCustomApprovalQueue()).some((q) => q.id === created.submissionId)).toBe(false);
  });

  it('auto-approves when the system signs every step, or refuses when the flow says so', async () => {
    const auto = `${tag}-auto`;
    const flow = {
      version: 1,
      blocks: [{ id: 'mgr', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 } }],
      options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
    };
    const schema = { version: 1, sections: [{ id: 's', fields: [{ id: 'note', type: 'text', label: '說明', required: true }] }] };
    expect((await publish({ key: auto, flow, schema, numberPrefix: 'AU' })).ok).toBe(true);
    const created = await create(ids.mgr, { note: '主管自己申請' }, { key: auto });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await steps(created.submissionId)).toEqual([['step:mgr', ids.mgr, 'auto_approved']]);
    const [row] = await sql`select status, current_step_order from form_submissions where id = ${created.submissionId}`;
    expect(row).toEqual({ status: 'approved', current_step_order: null });

    const strict = `${tag}-strict`;
    expect((await publish({ key: strict, flow: { ...flow, options: { ...flow.options, whenEmpty: 'block' } }, schema, numberPrefix: 'ST' })).ok).toBe(true);
    const refused = await create(ids.mgr, { note: 'x' }, { key: strict });
    expect(refused).toMatchObject({ ok: false, code: 'validation' });
  });

  it('enforces required attachments and referenced records', async () => {
    const att = `${tag}-att`;
    const schema = {
      version: 1,
      sections: [{ id: 's', fields: [{ id: 'who', type: 'employee', label: '對象' }, { id: 'files', type: 'attachments', label: '文件', required: true, maxFiles: 2 }] }],
    };
    const flow = {
      version: 1,
      blocks: [{ id: 'mgr', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 } }],
      options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block' },
    };
    expect((await publish({ key: att, schema, flow, numberPrefix: 'AT' })).ok).toBe(true);
    const none = await create(ids.applicant, {}, { key: att });
    expect(none).toMatchObject({ ok: false, code: 'validation' });
    if (!none.ok) expect(none.error).toContain('附件');
    expect(await create(ids.applicant, {}, { key: att, fileCount: 3 })).toMatchObject({ ok: false, code: 'validation' });
    const ghost = await create(ids.applicant, { who: crypto.randomUUID() }, { key: att, fileCount: 1 });
    expect(ghost).toMatchObject({ ok: false, code: 'validation' });
    if (!ghost.ok) expect(ghost.error).toContain('員工');
    const ok = await create(ids.applicant, { who: ids.handler }, { key: att, fileCount: 1 });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;

    // Later uploads respect the field's own limit (2), not only the global 20.
    const { uploadAttachmentFor } = await import('@/lib/attachments/service');
    const pdf = () => new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'quote.pdf', { type: 'application/pdf' });
    const applicant = { id: ids.applicant, role: 'staff' };
    expect((await uploadAttachmentFor(applicant, 'custom', ok.submissionId, pdf())).ok).toBe(true);
    expect((await uploadAttachmentFor(applicant, 'custom', ok.submissionId, pdf())).ok).toBe(true);
    expect(await uploadAttachmentFor(applicant, 'custom', ok.submissionId, pdf())).toEqual({ ok: false, error: '這張表單最多 2 個附件' });
    const stored = await sql`select storage_path from attachments where form_type = 'custom' and form_id = ${ok.submissionId}`;
    expect(stored).toHaveLength(2);
    const root = process.env.STORAGE_LOCAL_PATH!;
    for (const s of stored) await rm(path.join(root, s.storage_path), { force: true });
    await sql`delete from attachments where form_type = 'custom' and form_id = ${ok.submissionId}`;

    // A form without an attachments field takes no files at all.
    const [noField] = await sql`select s.id from form_submissions s join form_definitions d on d.id = s.definition_id where d.key = ${`${tag}-auto`}`;
    expect(await uploadAttachmentFor({ id: ids.mgr, role: 'staff' }, 'custom', noField.id, pdf())).toEqual({ ok: false, error: '這張表單沒有附件欄位' });
  });
});
