import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PURCHASE_ORDER_FORM, PURCHASE_REQUEST_FORM } from '@/lib/custom-forms/migrated/procurement';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Batch 5a switch-over: 請購單 and 採購單 as designer forms. The 採購單
// continues the applicant's own approved 請購單 through a 關聯單據 field: it
// joins the request's case, its rows come from the request (the server
// rewrites them), and a case holds one 採購單 even after a withdrawal. Keys
// are tagged per run and the legacy links cleared afterwards.
describe('batch 5a: purchase request / order moved to the designer runtime', () => {
  let sql: Sql;
  const tag = `lp${Date.now()}`;
  const ids = {} as Record<'dept' | 'mgr' | 'owner' | 'otherOwner' | 'applicant' | 'other' | 'budget' | 'budget2' | 'foreignBudget' | 'orphanBudget' | 'supplier' | 'gm', string>;
  const submissionIds: string[] = [];
  const pr: MigratedForm = { ...clone(PURCHASE_REQUEST_FORM), key: `${tag}-pr`, numberPrefix: 'TR' };
  const po: MigratedForm = (() => {
    const f = { ...clone(PURCHASE_ORDER_FORM), key: `${tag}-po`, numberPrefix: 'TP' };
    const source = (f.schema.sections[0] as { fields: { sources: { form: string }[] }[] }).fields[0];
    source.sources[0].form = pr.key;
    return f;
  })();

  const requestData = (lines: { budgetCodeId?: string; description?: string; quantity?: number; estimatedAmount?: string }[]) => ({
    neededWithinDays: 30,
    items: { rows: lines.map((l) => ({ budgetCodeId: ids.budget, description: '筆電', quantity: 2, estimatedAmount: '30000', ...l })) },
  });
  const orderData = (sourceId: string, rows: Record<string, unknown>[], o: Record<string, unknown> = {}) => ({
    purchaseRequestId: sourceId,
    items: { rows },
    supplierId: ids.supplier,
    paymentMethod: '匯款',
    paymentTerms: '貨到付款',
    expectedDeliveryDays: 14,
    quoteCount: 2,
    quoteCountReason: '',
    ...o,
  });
  const create = async (applicant: string, key: string, d: Record<string, unknown>) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission({ id: applicant }, key, { data: d, idempotencyKey: crypto.randomUUID(), fileCount: 0 });
    if (r.ok) submissionIds.push(r.submissionId);
    return r;
  };
  const version = async (id: string) => Number((await sql`select version from form_submissions where id = ${id}`)[0].version);
  const approvers = async (id: string) =>
    (
      await sql`select approver_employee_id from approval_steps
        where form_type = 'custom' and form_id = ${id} and status = 'pending' order by step_order`
    ).map((s) => s.approver_employee_id);
  const approveAll = async (id: string) => {
    const service = await import('@/lib/custom-forms/service');
    for (const approver of await approvers(id)) {
      const r = await service.approveSubmissionStep({ id: approver }, id, await version(id));
      if (!r.ok) throw new Error(r.error);
    }
    expect((await sql`select status from form_submissions where id = ${id}`)[0].status).toBe('approved');
  };
  const rowsOf = async (id: string) => (await sql`select data from form_submissions where id = ${id}`)[0].data.items.rows as Record<string, unknown>[];

  beforeAll(async () => {
    sql = await loadSql();
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type in ('purchase_request', 'purchase_order')`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '採購轉換測試部', ${ids.mgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.owner = await employee('owner', ids.dept);
    ids.otherOwner = await employee('otherOwner', ids.dept);
    ids.applicant = await employee('applicant', ids.dept);
    ids.other = await employee('other', ids.dept);
    const code = async (suffix: string, owner: string | null) =>
      (
        await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
          values (${`${tag}-${suffix}`}, ${ids.dept}, '設備', '115', 1000000, ${owner}) returning id`
      )[0].id as string;
    ids.budget = await code('A', ids.owner);
    ids.budget2 = await code('B', ids.owner);
    ids.foreignBudget = await code('C', ids.otherOwner);
    ids.orphanBudget = await code('D', null);
    ids.supplier = (await sql`select id from suppliers order by name limit 1`)[0].id;
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
      await sql`update form_submissions set source_submission_id = null where id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${[...new Set(cases.map((c) => c.procurement_case_id))]}::uuid[])`;
    }
    await sql`delete from budget_codes where id = any(${[ids.budget, ids.budget2, ids.foreignBudget, ids.orphanBudget]}::uuid[])`;
  });

  it('the 採購單 cannot publish before its source; publishing retires both old create paths', async () => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    const { replacementFor } = await import('@/lib/custom-forms/legacy');
    const publish = (form: MigratedForm) =>
      runInTransaction('test.publish', async (tx) => ({ ok: true as const, ...(await publishDefinition(tx, { ...form, actorId: ids.mgr })) }));

    expect(await publish(po)).toMatchObject({ ok: false, error: expect.stringContaining('不存在或尚未發佈') });
    expect(await publish(pr)).toMatchObject({ ok: true });
    expect(await publish(po)).toMatchObject({ ok: true });
    expect(await replacementFor('purchase_request')).toBe(pr.key);
    expect(await replacementFor('purchase_order')).toBe(po.key);

    const legacyRequest = await import('@/lib/purchase-requests/service');
    const legacyOrder = await import('@/lib/purchase-orders/service');
    const actor = { id: ids.applicant, departmentId: ids.dept };
    expect(
      await legacyRequest.createPurchaseRequest(actor, {
        idempotencyKey: crypto.randomUUID(),
        neededWithinDays: 30,
        items: [{ budgetCodeId: ids.budget, description: '舊版', quantity: 1, estimatedAmount: '100' }],
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
    expect(
      await legacyOrder.createPurchaseOrder(actor, {
        idempotencyKey: crypto.randomUUID(),
        purchaseRequestId: crypto.randomUUID(),
        supplierId: ids.supplier,
        paymentMethod: '匯款',
        paymentTerms: '貨到付款',
        expectedDeliveryDays: 14,
        quoteCount: 1,
        quoteCountReason: null,
        items: [],
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('請購單 rows must share one budget owner, and the owner must be set', async () => {
    expect(await create(ids.applicant, pr.key, requestData([{}, { budgetCodeId: ids.foreignBudget }]))).toMatchObject({
      ok: false,
      code: 'validation',
      error: expect.stringContaining('同一位預算負責人'),
    });
    expect(await create(ids.applicant, pr.key, requestData([{ budgetCodeId: ids.orphanBudget }]))).toMatchObject({
      ok: false,
      code: 'validation',
      error: expect.stringContaining('沒有指定預算負責人'),
    });
  });

  it('請購單 → 採購單 on one case: rows come from the request, one order per case even after a withdrawal', async () => {
    const service = await import('@/lib/custom-forms/service');
    const { sourceOptions } = await import('@/lib/custom-forms/source');
    const { getDb } = await import('@/lib/db');
    const { parseDefinition } = await import('@/lib/custom-forms/definition');
    const poSchema = (() => {
      const r = parseDefinition(po.schema, po.flow);
      if (!r.ok) throw new Error(r.errors.join());
      return r.schema;
    })();
    const link = poSchema.sections[0].fields[0];
    if (link.type !== 'source') throw new Error('expected the source field first');
    const [{ id: poDefinitionId }] = await sql`select id from form_definitions where key = ${po.key}`;

    const request = await create(ids.applicant, pr.key, requestData([{}, { budgetCodeId: ids.budget2, description: '螢幕', quantity: 1, estimatedAmount: '8000' }]));
    if (!request.ok) throw new Error(request.error);
    expect(await approvers(request.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);

    // Not yet approved: no order.
    const early = await create(ids.applicant, po.key, orderData(request.submissionId, []));
    expect(early).toMatchObject({ ok: false, code: 'conflict', error: expect.stringContaining('尚未核准') });
    await approveAll(request.submissionId);

    // Someone else's request is not offered and cannot be used.
    expect(await sourceOptions(getDb(), { definitionId: poDefinitionId }, link, ids.other)).toEqual([]);
    expect(await create(ids.other, po.key, orderData(request.submissionId, []))).toMatchObject({ ok: false, code: 'not_found' });
    const offered = await sourceOptions(getDb(), { definitionId: poDefinitionId }, link, ids.applicant);
    expect(offered.map((o) => o.id)).toEqual([request.submissionId]);
    expect(offered[0].rows.map((r) => [r.description, r.quantity, r._src])).toEqual([
      ['筆電', 2, 0],
      ['螢幕', 1, 1],
    ]);

    // Tampered carried columns are rewritten from the request; a row that did not come from it is dropped.
    const order = await create(
      ids.applicant,
      po.key,
      orderData(request.submissionId, [
        { _src: 0, budgetCodeId: ids.foreignBudget, description: '改過的說明', quantity: 99, unitPrice: '25000' },
        { _src: 1, unitPrice: '1000' },
        { budgetCodeId: ids.budget, description: '偷加的一列', quantity: 1, unitPrice: '1' },
      ])
    );
    if (!order.ok) throw new Error(order.error);
    const rows = await rowsOf(order.submissionId);
    expect(rows.map((r) => [r.budgetCodeId, r.description, r.quantity, r.unitPrice, r.totalPrice])).toEqual([
      [ids.budget, '筆電', 2, '25000.00', '50000.00'],
      [ids.budget2, '螢幕', 1, '1000.00', '1000.00'],
    ]);
    const [stored] = await sql`select s.procurement_case_id, s.source_submission_id, s.filed_by_employee_id, s.total_amount, r.procurement_case_id as request_case
      from form_submissions s join form_submissions r on r.id = ${request.submissionId} where s.id = ${order.submissionId}`;
    expect(stored).toMatchObject({
      procurement_case_id: stored.request_case,
      source_submission_id: request.submissionId,
      filed_by_employee_id: ids.applicant,
      total_amount: '51000.00',
    });
    expect(await approvers(order.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);

    // Read / attach rights follow each submission's own filer, not whoever opened the shared case.
    const { canAttachToForm, canReadForm } = await import('@/lib/authz/forms');
    const outsider = { id: ids.other, role: 'employee' };
    await sql`update procurement_cases set created_by_employee_id = ${ids.other} where id = ${stored.procurement_case_id}`;
    try {
      expect(await canReadForm(outsider, 'custom', order.submissionId)).toBe(false);
      expect(await canAttachToForm(outsider, 'custom', order.submissionId)).toBe(false);
      expect(await canReadForm({ id: ids.applicant, role: 'employee' }, 'custom', order.submissionId)).toBe(true);
    } finally {
      await sql`update procurement_cases set created_by_employee_id = ${ids.applicant} where id = ${stored.procurement_case_id}`;
    }

    // Revising re-carries from the stored source as well.
    const revised = await service.reviseSubmission({ id: ids.applicant }, order.submissionId, 'update', {
      data: orderData(crypto.randomUUID(), [
        { _src: 0, description: '再改一次', unitPrice: '24000' },
        { _src: 1, unitPrice: '1000' },
      ]),
      expectedVersion: await version(order.submissionId),
      newFileCount: 0,
    });
    expect(revised).toMatchObject({ ok: true });
    expect((await rowsOf(order.submissionId)).map((r) => [r.description, r.totalPrice])).toEqual([
      ['筆電', '48000.00'],
      ['螢幕', '1000.00'],
    ]);

    // One order per case: a second one is refused, and still refused after the first is withdrawn.
    expect(await create(ids.applicant, po.key, orderData(request.submissionId, [{ _src: 0, unitPrice: '1' }, { _src: 1, unitPrice: '1' }], { quoteCount: 1 }))).toMatchObject({
      ok: false,
      code: 'conflict',
      error: expect.stringContaining('此案件已建立過'),
    });
    expect(await service.withdrawSubmission({ id: ids.applicant }, order.submissionId)).toMatchObject({ ok: true });
    expect(await create(ids.applicant, po.key, orderData(request.submissionId, [{ _src: 0, unitPrice: '1' }, { _src: 1, unitPrice: '1' }], { quoteCount: 1 }))).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    expect(await sourceOptions(getDb(), { definitionId: poDefinitionId }, link, ids.applicant)).toEqual([]);
  });

  it('採購單 quote rule: below the threshold the reason is required', async () => {
    const request = await create(ids.applicant, pr.key, requestData([{ quantity: 1, estimatedAmount: '40000' }]));
    if (!request.ok) throw new Error(request.error);
    await approveAll(request.submissionId);
    const rows = [{ _src: 0, unitPrice: '40000' }];
    expect(await create(ids.applicant, po.key, orderData(request.submissionId, rows, { quoteCount: 1 }))).toMatchObject({
      ok: false,
      code: 'validation',
    });
    const ok = await create(ids.applicant, po.key, orderData(request.submissionId, rows, { quoteCount: 1, quoteCountReason: '獨家代理' }));
    expect(ok).toMatchObject({ ok: true });
  });
});
