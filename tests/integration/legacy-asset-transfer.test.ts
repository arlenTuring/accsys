import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSET_TRANSFER_FORM } from '@/lib/custom-forms/migrated/asset-transfer';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Batch 4 switch-over: the designer form drives the same register update as
// the old 資產異動申請單 through the generic asset register link. The key is
// tagged per run and the legacy link is cleared afterwards so later files
// reach the old form.
describe('batch 4: asset transfer moved to the designer runtime', () => {
  let sql: Sql;
  const tag = `la${Date.now()}`;
  const ids = {} as Record<'dept' | 'otherDept' | 'mgr' | 'otherMgr' | 'alice' | 'bob' | 'carol' | 'applicant' | 'budget' | 'gm', string>;
  const assetIds: Record<string, string> = {};
  const submissionIds: string[] = [];
  const legacyIds: string[] = [];
  const form: MigratedForm = { ...clone(ASSET_TRANSFER_FORM), key: `${tag}-at`, numberPrefix: 'TA' };

  type Row = { assetId: string; reason?: string; newCustodianEmployeeId?: string; newLocation?: string };
  const data = (rows: Row[], o: Record<string, unknown> = {}) => ({
    useDepartmentId: ids.dept,
    useBudgetCodeId: ids.budget,
    transferTypes: ['custodian_change'],
    remark: '',
    items: { rows: rows.map((r) => ({ reason: 'custodian_change', newCustodianEmployeeId: ids.bob, newLocation: '8F', ...r })) },
    originalCustodianEmployeeId: ids.alice,
    newCustodianEmployeeId: ids.bob,
    otherCustodianEmployeeId: '',
    ...o,
  });
  const legacyInput = (assetId: string) => ({
    idempotencyKey: crypto.randomUUID(),
    departmentId: ids.dept,
    useDepartmentId: ids.dept,
    useBudgetCodeId: ids.budget,
    transferTypes: ['custodian_change'],
    remark: '',
    items: [{ assetId, reason: 'custodian_change', newCustodianEmployeeId: ids.bob, newLocation: '8F' }],
    originalCustodianEmployeeId: ids.alice,
    newCustodianEmployeeId: ids.bob,
    otherCustodianEmployeeId: '',
  });
  const create = async (applicant: string, d: Record<string, unknown>) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission({ id: applicant }, form.key, { data: d, idempotencyKey: crypto.randomUUID(), fileCount: 1 });
    if (r.ok) submissionIds.push(r.submissionId);
    return r;
  };
  const approve = async (approver: string, id: string) => {
    const service = await import('@/lib/custom-forms/service');
    const [row] = await sql`select version from form_submissions where id = ${id}`;
    return service.approveSubmissionStep({ id: approver }, id, Number(row.version));
  };
  const approvers = async (id: string) =>
    (
      await sql`select approver_employee_id from approval_steps
        where form_type = 'custom' and form_id = ${id} and status = 'pending' order by step_order`
    ).map((s) => s.approver_employee_id);
  const assetRow = async (id: string) =>
    (await sql`select custodian_employee_id, location, status from assets where id = ${id}`)[0];

  beforeAll(async () => {
    sql = await loadSql();
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type = 'asset_transfer'`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.otherMgr = await employee('otherMgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '資產轉換測試部', ${ids.mgr}) returning id`)[0].id;
    ids.otherDept = (await sql`insert into departments (code, name, manager_employee_id) values (${`${tag}-2`}, '資產轉換測試二部', ${ids.otherMgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    await sql`update employees set department_id = ${ids.otherDept} where id = ${ids.otherMgr}`;
    ids.alice = await employee('alice', ids.dept);
    ids.bob = await employee('bob', ids.otherDept);
    ids.carol = await employee('carol', ids.dept);
    ids.applicant = await employee('applicant', ids.dept);
    ids.budget = (
      await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
        values (${`${tag}-BC`}, ${ids.dept}, '雜項購置', '115', 100000, ${ids.mgr}) returning id`
    )[0].id;
    for (const [suffix, custodian] of [['A', ids.alice], ['B', ids.alice], ['C', ids.carol], ['D', ids.alice], ['E', ids.alice], ['M', ids.mgr], ['X', ids.alice]] as const) {
      assetIds[suffix] = (
        await sql`insert into assets (tag, name, custodian_employee_id, location) values (${`${tag}-${suffix}`}, '測試財產', ${custodian}, '7F') returning id`
      )[0].id;
    }
    ids.gm = (
      await sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
        where j.code = 'general_manager' and r.department_id is null and r.is_primary`
    )[0].employee_id;
  });

  afterAll(async () => {
    await sql`update form_definitions set legacy_form_type = null where key like ${`${tag}-%`}`;
    if (submissionIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    if (legacyIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'asset_transfer' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'asset_transfer' and form_id = any(${legacyIds}::uuid[])`;
      const cases = await sql`delete from asset_transfers where id = any(${legacyIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    await sql`delete from assets where id = any(${Object.values(assetIds)}::uuid[])`;
    await sql`delete from budget_codes where id = ${ids.budget}`;
  });

  it('a draft changes nothing; publishing retires the old create; a pending old transfer still blocks its asset', async () => {
    const legacy = await import('@/lib/asset-transfers/service');
    const { replacementFor } = await import('@/lib/custom-forms/legacy');
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
    const legacyActor = { id: ids.applicant, departmentId: ids.dept };

    const drafted = await runInTransaction('test.migrate', async (tx) => ({ ok: true as const, ...(await installMigratedForm(tx, form, ids.mgr, 'draft')) }));
    expect(drafted).toMatchObject({ ok: true, outcome: 'drafted' });
    expect(await replacementFor('asset_transfer')).toBeNull();
    const before = await legacy.createAssetTransfer(legacyActor, legacyInput(assetIds.X));
    if (!before.ok) throw new Error(before.error);
    legacyIds.push(before.transferId);

    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    await runInTransaction('test.publish', async (tx) => ({ ok: true as const, ...(await publishDefinition(tx, { ...form, actorId: ids.mgr })) }));
    expect(await replacementFor('asset_transfer')).toBe(form.key);
    expect(await legacy.createAssetTransfer(legacyActor, legacyInput(assetIds.A))).toMatchObject({ ok: false, code: 'conflict' });

    expect(await create(ids.applicant, data([{ assetId: assetIds.X }]))).toMatchObject({
      ok: false,
      code: 'conflict',
      error: expect.stringContaining('已在另一張簽核中'),
    });
  });

  it('routes 原保管人 → 新保管人 → 兩位單位主管 and updates the register only on final approval', async () => {
    const created = await create(ids.applicant, data([{ assetId: assetIds.A }, { assetId: assetIds.B, newLocation: '9F' }]));
    if (!created.ok) throw new Error(created.error);
    expect(await approvers(created.submissionId)).toEqual([ids.alice, ids.bob, ids.mgr, ids.otherMgr]);
    const lines = await sql`select asset_id, original_custodian_employee_id, original_location from form_submission_asset_lines
      where submission_id = ${created.submissionId} order by line_no`;
    expect(lines.map((l) => [l.asset_id, l.original_custodian_employee_id, l.original_location])).toEqual([
      [assetIds.A, ids.alice, '7F'],
      [assetIds.B, ids.alice, '7F'],
    ]);

    for (const approver of [ids.alice, ids.bob, ids.mgr]) expect(await approve(approver, created.submissionId)).toMatchObject({ ok: true });
    expect(await assetRow(assetIds.A)).toMatchObject({ custodian_employee_id: ids.alice, location: '7F' });

    expect(await approve(ids.otherMgr, created.submissionId)).toMatchObject({ ok: true });
    expect(await assetRow(assetIds.A)).toMatchObject({ custodian_employee_id: ids.bob, location: '8F', status: 'in_custody' });
    expect(await assetRow(assetIds.B)).toMatchObject({ custodian_employee_id: ids.bob, location: '9F' });
    const [row] = await sql`select status, register_applied_at from form_submissions where id = ${created.submissionId}`;
    expect(row.status).toBe('approved');
    expect(row.register_applied_at).not.toBeNull();
    const [audit] = await sql`select count(*)::int as n from audit_events where action = 'custom.asset_register_applied' and entity_id = ${created.submissionId}`;
    expect(audit.n).toBe(1);
  });

  it('keeps an asset on one pending transfer at a time, across the old and new forms', async () => {
    const legacy = await import('@/lib/asset-transfers/service');
    const first = await create(ids.applicant, data([{ assetId: assetIds.D }]));
    if (!first.ok) throw new Error(first.error);
    expect(await create(ids.applicant, data([{ assetId: assetIds.D }]))).toMatchObject({ ok: false, code: 'conflict' });

    await sql`update form_definitions set status = 'archived' where key = ${form.key}`;
    try {
      const old = await legacy.createAssetTransfer({ id: ids.applicant, departmentId: ids.dept }, legacyInput(assetIds.D));
      expect(old).toMatchObject({ ok: false, code: 'conflict' });
    } finally {
      await sql`update form_definitions set status = 'published' where key = ${form.key}`;
    }

    const register = await import('@/lib/assets/service');
    const [asset] = await sql`select tag, name, quantity, location from assets where id = ${assetIds.D}`;
    const edit = await register.upsertAsset(
      { id: ids.mgr, role: 'admin' },
      { tag: asset.tag, name: asset.name, quantity: asset.quantity, custodianEmployeeId: ids.carol, location: asset.location, status: null, remark: null }
    );
    expect(edit).toMatchObject({ ok: false, code: 'conflict', error: expect.stringContaining('簽核中') });
  });

  it('checks that the named custodians match the register', async () => {
    expect(await create(ids.applicant, data([{ assetId: assetIds.C }]))).toMatchObject({
      ok: false,
      code: 'validation',
      error: expect.stringContaining('目前保管人不是所填的原保管人'),
    });
    const withOther = await create(ids.applicant, data([{ assetId: assetIds.C }, { assetId: assetIds.E }], { otherCustodianEmployeeId: ids.carol }));
    if (!withOther.ok) throw new Error(withOther.error);
    expect(await approvers(withOther.submissionId)).toEqual([ids.alice, ids.bob, ids.carol, ids.mgr, ids.otherMgr]);
  });

  it('escalates to 總經理 when the applicant is every custodian and manager', async () => {
    const created = await create(
      ids.mgr,
      data([{ assetId: assetIds.M, reason: 'scrap', newCustodianEmployeeId: ids.mgr, newLocation: '管理部' }], {
        transferTypes: ['scrap'],
        originalCustodianEmployeeId: ids.mgr,
        newCustodianEmployeeId: ids.mgr,
      })
    );
    if (!created.ok) throw new Error(created.error);
    expect(await approvers(created.submissionId)).toEqual([ids.gm]);
    expect((await assetRow(assetIds.M)).status).not.toBe('scrapped');
  });

  it('refuses the final approval when the register changed after submission', async () => {
    const [b] = await sql`select id from assets where id = ${assetIds.B}`;
    await sql`update assets set custodian_employee_id = ${ids.alice} where id = ${b.id}`;
    const created = await create(ids.applicant, data([{ assetId: assetIds.B }]));
    if (!created.ok) throw new Error(created.error);
    for (const approver of [ids.alice, ids.bob, ids.mgr]) expect(await approve(approver, created.submissionId)).toMatchObject({ ok: true });
    await sql`update assets set custodian_employee_id = ${ids.carol} where id = ${b.id}`;
    expect(await approve(ids.otherMgr, created.submissionId)).toMatchObject({ ok: false, code: 'conflict', error: expect.stringContaining('送簽後變更') });
    const [row] = await sql`select status, register_applied_at from form_submissions where id = ${created.submissionId}`;
    expect(row).toMatchObject({ status: 'pending_approval', register_applied_at: null });
    expect((await assetRow(assetIds.B)).custodian_employee_id).toBe(ids.carol);
  });
});
