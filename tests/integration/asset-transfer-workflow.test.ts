import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('asset transfer workflow', () => {
  let sql: Sql;
  const tag = `AT${Date.now()}`;
  const ids = {} as Record<'dept' | 'budget' | 'alice' | 'bob' | 'mgr' | 'applicant' | 'assetA' | 'assetB' | 'assetC' | 'assetD', string>;
  const transferIds: string[] = [];

  const actor = (id: string) => ({ id, departmentId: ids.dept });
  const input = (assetId: string, overrides: Record<string, unknown> = {}) => ({
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
    ...overrides,
  });
  const versionOf = async (id: string) => Number((await sql`select version from asset_transfers where id = ${id}`)[0].version);

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '資產測試部', ${ids.mgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.alice = await employee('alice', ids.dept);
    ids.bob = await employee('bob', ids.dept);
    ids.applicant = await employee('applicant', ids.dept);
    ids.budget = (
      await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
        values (${`${tag}-BC`}, ${ids.dept}, '雜項購置', '115', 100000, ${ids.mgr}) returning id`
    )[0].id;
    const asset = async (suffix: string, custodian = ids.alice) =>
      (await sql`insert into assets (tag, name, custodian_employee_id, location) values (${`${tag}-${suffix}`}, '測試財產', ${custodian}, '7F') returning id`)[0]
        .id as string;
    ids.assetA = await asset('A');
    ids.assetB = await asset('B');
    ids.assetC = await asset('C', ids.mgr);
    ids.assetD = await asset('D');
  });

  afterAll(async () => {
    if (transferIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'asset_transfer' and form_id = any(${transferIds}::uuid[])`;
      const cases = await sql`delete from asset_transfers where id = any(${transferIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    await sql`delete from assets where id in (${ids.assetA}, ${ids.assetB}, ${ids.assetC}, ${ids.assetD})`;
    await sql`delete from budget_codes where id = ${ids.budget}`;
  });

  it('builds the chain from the parties and updates the register on final approval', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const created = await service.createAssetTransfer(actor(ids.applicant), input(ids.assetA));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    transferIds.push(created.transferId);

    const steps = await sql`select approver_employee_id, approver_role from approval_steps
      where form_type = 'asset_transfer' and form_id = ${created.transferId} order by step_order`;
    expect(steps.map((s) => s.approver_role)).toEqual(['original_custodian', 'new_custodian', 'original_custodian_manager']);

    for (const approver of [ids.alice, ids.bob]) {
      expect((await service.approveAssetTransferStep(actor(approver), created.transferId, await versionOf(created.transferId))).ok).toBe(true);
    }
    const [mid] = await sql`select custodian_employee_id from assets where id = ${ids.assetA}`;
    expect(mid.custodian_employee_id).toBe(ids.alice);

    expect((await service.approveAssetTransferStep(actor(ids.mgr), created.transferId, await versionOf(created.transferId))).ok).toBe(true);
    const [after] = await sql`select custodian_employee_id, location, status from assets where id = ${ids.assetA}`;
    expect(after).toMatchObject({ custodian_employee_id: ids.bob, location: '8F', status: 'in_custody' });
    const [form] = await sql`select status, applied_at from asset_transfers where id = ${created.transferId}`;
    expect(form.status).toBe('approved');
    expect(form.applied_at).not.toBeNull();
  });

  it('rejects an asset that is already on a pending transfer', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const first = await service.createAssetTransfer(actor(ids.applicant), input(ids.assetB));
    expect(first.ok).toBe(true);
    if (first.ok) transferIds.push(first.transferId);

    const second = await service.createAssetTransfer(actor(ids.applicant), input(ids.assetB));
    expect(second.ok).toBe(false);
  });

  it('ignores unit managers sent by the client and uses the department manager', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const created = await service.createAssetTransfer(
      actor(ids.applicant),
      input(ids.assetD, { originalManagerEmployeeId: ids.applicant, newManagerEmployeeId: ids.applicant })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    transferIds.push(created.transferId);
    const steps = await sql`select approver_employee_id from approval_steps
      where form_type = 'asset_transfer' and form_id = ${created.transferId} order by step_order`;
    expect(steps.map((s) => s.approver_employee_id)).toEqual([ids.alice, ids.bob, ids.mgr]);
    const [form] = await sql`select original_manager_employee_id, new_manager_employee_id from asset_transfers where id = ${created.transferId}`;
    expect(form).toMatchObject({ original_manager_employee_id: ids.mgr, new_manager_employee_id: ids.mgr });
    expect((await service.withdrawAssetTransfer(actor(ids.applicant), created.transferId)).ok).toBe(true);
  });

  it('never approves a register change without a signature from someone other than the applicant', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const created = await service.createAssetTransfer(
      actor(ids.mgr),
      input(ids.assetC, {
        transferTypes: ['scrap'],
        originalCustodianEmployeeId: ids.mgr,
        newCustodianEmployeeId: ids.mgr,
        items: [{ assetId: ids.assetC, reason: 'scrap', newCustodianEmployeeId: ids.mgr, newLocation: '管理部' }],
      })
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    transferIds.push(created.transferId);
    const [form] = await sql`select status from asset_transfers where id = ${created.transferId}`;
    expect(form.status).toBe('pending_approval');
    const steps = await sql`select s.approver_role, e.is_general_manager from approval_steps s join employees e on e.id = s.approver_employee_id
      where s.form_type = 'asset_transfer' and s.form_id = ${created.transferId} order by s.step_order`;
    expect(steps).toEqual([{ approver_role: 'general_manager', is_general_manager: true }]);
    const [asset] = await sql`select status from assets where id = ${ids.assetC}`;
    expect(asset.status).not.toBe('scrapped');
  });

  it('rejects an uninvolved 其他保管人 used to skip the general-manager escalation', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const result = await service.createAssetTransfer(actor(ids.applicant), input(ids.assetD, { otherCustodianEmployeeId: ids.mgr }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('其他保管人');
  });

  it('rejects a form whose 原保管人 is not the register custodian', async () => {
    const service = await import('@/lib/asset-transfers/service');
    const result = await service.createAssetTransfer(
      actor(ids.applicant),
      input(ids.assetA, { originalCustodianEmployeeId: ids.applicant, newCustodianEmployeeId: ids.alice, items: [
        { assetId: ids.assetA, reason: 'custodian_change', newCustodianEmployeeId: ids.alice, newLocation: '7F' },
      ] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('目前保管人');
  });

  it('refuses a register edit that moves an asset on a pending transfer', async () => {
    const { upsertAsset } = await import('@/lib/assets/service');
    const result = await upsertAsset(
      { id: ids.mgr, role: 'admin' },
      { tag: `${tag}-B`, name: '測試財產', quantity: 1, custodianEmployeeId: ids.mgr, location: '7F', status: null, remark: '' }
    );
    expect(result.ok).toBe(false);
  });
});
