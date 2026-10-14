import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ACCEPTANCE_FORM,
  PROCUREMENT_PAYMENT_FORM,
  PURCHASE_ORDER_FORM,
  PURCHASE_REQUEST_FORM,
  STANDALONE_PAYMENT_FORM,
} from '@/lib/custom-forms/migrated/procurement';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/notifications/notify', () => ({ notifyAndEmail: async () => ({ ok: true }) }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

type SourceRuleJson = { form: string; unlessCaseHas?: string };
const sourcesOf = (f: MigratedForm) => (f.schema.sections[0] as { fields: { sources: SourceRuleJson[] }[] }).fields[0].sources;

// Batch 5b switch-over: 驗收單, 費用申請單(採購付款) and 費用申請單(免走採購)
// as designer forms. The 驗收單 continues an approved 採購單; the payment
// continues an approved 驗收單 (passed lines) or, before any approved
// acceptance, a prepaid 採購單. Finance fills 財產編號 after approval. Keys
// are tagged per run and the legacy links cleared afterwards.
describe('batch 5b: acceptance / payment / standalone payment on the designer runtime', () => {
  let sql: Sql;
  const tag = `lq${Date.now()}`;
  const ids = {} as Record<'dept' | 'mgr' | 'owner' | 'applicant' | 'finance' | 'budget' | 'orphanBudget' | 'supplier' | 'gm', string>;
  const submissionIds: string[] = [];
  const keyOf = { pr: `${tag}-pr`, po: `${tag}-po`, ac: `${tag}-ac`, pp: `${tag}-pp`, se: `${tag}-se` };
  const pr: MigratedForm = { ...clone(PURCHASE_REQUEST_FORM), key: keyOf.pr, numberPrefix: 'QA' };
  const po: MigratedForm = (() => {
    const f = { ...clone(PURCHASE_ORDER_FORM), key: keyOf.po, numberPrefix: 'QB' };
    sourcesOf(f)[0].form = keyOf.pr;
    return f;
  })();
  const ac: MigratedForm = (() => {
    const f = { ...clone(ACCEPTANCE_FORM), key: keyOf.ac, numberPrefix: 'QC' };
    sourcesOf(f)[0].form = keyOf.po;
    return f;
  })();
  const pp: MigratedForm = (() => {
    const f = { ...clone(PROCUREMENT_PAYMENT_FORM), key: keyOf.pp, numberPrefix: 'QD' };
    const [fromAcceptance, fromOrder] = sourcesOf(f);
    fromAcceptance.form = keyOf.ac;
    fromOrder.form = keyOf.po;
    fromOrder.unlessCaseHas = keyOf.ac;
    return f;
  })();
  const se: MigratedForm = { ...clone(STANDALONE_PAYMENT_FORM), key: keyOf.se, numberPrefix: 'QE' };

  const create = async (applicant: string, key: string, d: Record<string, unknown>) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission({ id: applicant }, key, { data: d, idempotencyKey: crypto.randomUUID(), fileCount: 0 });
    if (r.ok) submissionIds.push(r.submissionId);
    return r;
  };
  const must = <T extends { ok: boolean; error?: string }>(r: T) => {
    if (!r.ok) throw new Error(r.error);
    return r as Extract<T, { ok: true }>;
  };
  const version = async (id: string) => Number((await sql`select version from form_submissions where id = ${id}`)[0].version);
  const approvers = async (id: string) =>
    (
      await sql`select approver_employee_id from approval_steps
        where form_type = 'custom' and form_id = ${id} and status = 'pending' order by step_order`
    ).map((s) => s.approver_employee_id);
  const approveAll = async (id: string) => {
    const service = await import('@/lib/custom-forms/service');
    for (const approver of await approvers(id)) must(await service.approveSubmissionStep({ id: approver }, id, await version(id)));
    expect((await sql`select status from form_submissions where id = ${id}`)[0].status).toBe('approved');
  };
  const dataOf = async (id: string) => (await sql`select data from form_submissions where id = ${id}`)[0].data as Record<string, unknown>;
  const rowsOf = async (id: string) => ((await dataOf(id)).items as { rows: Record<string, unknown>[] }).rows;

  /** An approved 請購單 and 採購單 (two lines: 50,000 + 1,000) on a new case. */
  const approvedOrder = async (paymentTerms: string) => {
    const request = must(
      await create(ids.applicant, pr.key, {
        neededWithinDays: 30,
        items: {
          rows: [
            { budgetCodeId: ids.budget, description: '筆電', quantity: 2, estimatedAmount: '50000' },
            { budgetCodeId: ids.budget, description: '滑鼠', quantity: 1, estimatedAmount: '1000' },
          ],
        },
      })
    );
    await approveAll(request.submissionId);
    const order = must(
      await create(ids.applicant, po.key, {
        purchaseRequestId: request.submissionId,
        items: { rows: [{ _src: 0, unitPrice: '25000' }, { _src: 1, unitPrice: '1000' }] },
        supplierId: ids.supplier,
        paymentMethod: '匯款',
        paymentTerms,
        expectedDeliveryDays: 14,
        quoteCount: 3,
        quoteCountReason: '',
      })
    );
    await approveAll(order.submissionId);
    return order.submissionId;
  };
  const acceptanceData = (orderId: string, results: string[]) => ({
    purchaseOrderId: orderId,
    contractorSupplierId: ids.supplier,
    acceptanceDate: '2026-10-01',
    items: { rows: results.map((passFail, i) => ({ _src: i, passFail })) },
  });
  const paymentData = (sourceId: string, rows: Record<string, unknown>[], p: Record<string, unknown> = {}) => ({
    sourceId,
    items: { rows },
    payeeType: 'supplier',
    payeeSupplierId: ids.supplier,
    paymentMethod: '匯款',
    invoiceMonth: '2026-09',
    expectedPaymentDate: '',
    ...p,
  });

  beforeAll(async () => {
    sql = await loadSql();
    await sql`update form_definitions set legacy_form_type = null
      where legacy_form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'standalone_expense_request')`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string, role = 'staff') =>
      (
        await sql`insert into employees (employee_code, name, department_id, role)
          values (${`${tag}-${name}`}, ${name}, ${deptId}, ${role}) returning id`
      )[0].id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '驗收付款轉換測試部', ${ids.mgr}) returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.owner = await employee('owner', ids.dept);
    ids.applicant = await employee('applicant', ids.dept);
    ids.finance = await employee('finance', ids.dept, 'finance');
    const code = async (suffix: string, owner: string | null) =>
      (
        await sql`insert into budget_codes (code, department_id, category, fiscal_year, annual_budget_amount, owner_employee_id)
          values (${`${tag}-${suffix}`}, ${ids.dept}, '設備', '115', 1000000, ${owner}) returning id`
      )[0].id as string;
    ids.budget = await code('A', ids.owner);
    ids.orphanBudget = await code('B', null);
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
    await sql`delete from budget_codes where id = any(${[ids.budget, ids.orphanBudget]}::uuid[])`;
  });

  it('publishes in chain order and closes the old acceptance / payment create paths', async () => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { publishDefinition } = await import('@/lib/custom-forms/publish');
    const { replacementFor } = await import('@/lib/custom-forms/legacy');
    const publish = (form: MigratedForm) =>
      runInTransaction('test.publish', async (tx) => ({ ok: true as const, ...(await publishDefinition(tx, { ...form, actorId: ids.mgr })) }));

    expect(await publish(pp)).toMatchObject({ ok: false, error: expect.stringContaining('不存在或尚未發佈') });
    for (const f of [pr, po, ac, pp, se]) expect(await publish(f)).toMatchObject({ ok: true });
    expect(await replacementFor('acceptance')).toBe(ac.key);
    expect(await replacementFor('expense_request')).toBe(pp.key);
    expect(await replacementFor('standalone_expense_request')).toBe(se.key);

    const legacyAcceptance = await import('@/lib/acceptances/service');
    const legacyPayment = await import('@/lib/expense-requests/service');
    const actor = { id: ids.applicant, departmentId: ids.dept };
    expect(
      await legacyAcceptance.createAcceptance(actor, {
        idempotencyKey: crypto.randomUUID(),
        purchaseOrderId: crypto.randomUUID(),
        contractorSupplierId: ids.supplier,
        acceptanceDate: '2026-10-01',
        items: [],
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
    const payee = {
      payeeType: 'supplier' as const,
      payeeSupplierId: ids.supplier,
      paymentMethod: '匯款',
      bankName: null,
      bankAccount: null,
      accountName: null,
      invoiceMonth: null,
      expectedPaymentDate: null,
    };
    expect(
      await legacyPayment.createExpenseRequest(actor, {
        ...payee,
        idempotencyKey: crypto.randomUUID(),
        purchaseOrderId: crypto.randomUUID(),
        includedSourceItemIds: [],
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
    expect(
      await legacyPayment.createStandaloneExpenseRequest(actor, {
        ...payee,
        idempotencyKey: crypto.randomUUID(),
        budgetCodeId: ids.budget,
        items: [{ description: '舊版', amount: '100' }],
      })
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('採購單 → 驗收單 → 採購付款 on one case, with passed lines only and the payment batch fixed', async () => {
    const orderId = await approvedOrder('貨到付款');

    // Not prepaid and not yet accepted: no payment from the order.
    expect(await create(ids.applicant, pp.key, paymentData(orderId, [{ _src: 0 }]))).toMatchObject({
      ok: false,
      code: 'validation',
      error: expect.stringContaining('不符合'),
    });

    // Acceptance copies the order lines (amount = line total); the applicant cannot fill 財產編號.
    const acceptance = must(
      await create(ids.applicant, ac.key, {
        ...acceptanceData(orderId, ['pass', 'fail']),
        items: { rows: [{ _src: 0, passFail: 'pass', amount: '1', propertyTag: 'X-1' }, { _src: 1, passFail: 'fail' }] },
      })
    );
    expect((await rowsOf(acceptance.submissionId)).map((r) => [r.description, r.quantity, r.amount, r.passFail, r.propertyTag])).toEqual([
      ['筆電', 2, '50000.00', 'pass', null],
      ['滑鼠', 1, '1000.00', 'fail', null],
    ]);
    const [stored] = await sql`select a.procurement_case_id, a.total_amount, a.procurement_case_id = o.procurement_case_id as same_case, c.case_type
      from form_submissions a join form_submissions o on o.id = ${orderId} join procurement_cases c on c.id = a.procurement_case_id
      where a.id = ${acceptance.submissionId}`;
    expect(stored).toMatchObject({ total_amount: '51000.00', same_case: true, case_type: 'standard' });
    expect(await approvers(acceptance.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);
    expect(await create(ids.applicant, ac.key, acceptanceData(orderId, ['pass', 'pass']))).toMatchObject({ ok: false, code: 'conflict' });

    // Payment before the acceptance is approved: the acceptance is not a source yet.
    expect(await create(ids.applicant, pp.key, paymentData(acceptance.submissionId, [{ _src: 0 }]))).toMatchObject({ ok: false, code: 'conflict' });
    await approveAll(acceptance.submissionId);

    // Failed lines cannot be paid; carried amounts come from the acceptance and added rows are dropped.
    expect(await create(ids.applicant, pp.key, paymentData(acceptance.submissionId, [{ _src: 0 }, { _src: 1 }]))).toMatchObject({
      ok: false,
      code: 'validation',
      error: expect.stringContaining('不屬於來源'),
    });
    const payment = must(
      await create(
        ids.applicant,
        pp.key,
        paymentData(acceptance.submissionId, [{ _src: 0, amount: '99999' }, { budgetCodeId: ids.budget, description: '偷加', amount: '5' }])
      )
    );
    const data = await dataOf(payment.submissionId);
    expect((data.items as { rows: Record<string, unknown>[] }).rows.map((r) => [r.description, r.amount])).toEqual([['筆電', '50000.00']]);
    expect(data.expectedPaymentDate).toBe('2026-10-25');
    expect(data._paymentBatch).toMatchObject({ batchDate: '2026-10-25' });
    expect((await sql`select total_amount from form_submissions where id = ${payment.submissionId}`)[0].total_amount).toBe('50000.00');

    // The case overview / finance tracking slots see all four designer forms.
    const { designerProcurementForms } = await import('@/lib/procurement/designer-forms');
    const slots = (await designerProcurementForms([stored.procurement_case_id])).map((f) => f.slot);
    expect(slots.sort()).toEqual(['acceptance', 'expense_request', 'purchase_order', 'purchase_request']);
  });

  it('a prepaid 採購單 can be paid before acceptance (rows may be dropped, not added)', async () => {
    const orderId = await approvedOrder('預付款');
    expect(await create(ids.applicant, pp.key, paymentData(orderId, []))).toMatchObject({ ok: false, code: 'validation' });
    const payment = must(await create(ids.applicant, pp.key, paymentData(orderId, [{ _src: 1 }], { payeeType: 'employee', payeeSupplierId: '', bankAccount: '012-345678' })));
    const data = await dataOf(payment.submissionId);
    expect((data.items as { rows: Record<string, unknown>[] }).rows.map((r) => [r.description, r.amount])).toEqual([['滑鼠', '1000.00']]);
    expect(data.payeeSupplierId).toBeUndefined();
    expect(data._paymentBatch).toMatchObject({ batchDate: '2026-10-30' });
    // One payment per case.
    expect(await create(ids.applicant, pp.key, paymentData(orderId, [{ _src: 0 }]))).toMatchObject({ ok: false, code: 'conflict' });

    // Once a prepaid order's case has an approved acceptance, the payment must come from the acceptance.
    const accepted = await approvedOrder('預付款');
    const acceptance = must(await create(ids.applicant, ac.key, acceptanceData(accepted, ['pass', 'pass'])));
    await approveAll(acceptance.submissionId);
    expect(await create(ids.applicant, pp.key, paymentData(accepted, [{ _src: 0 }]))).toMatchObject({
      ok: false,
      code: 'conflict',
      error: expect.stringContaining('已有核准的後續單據'),
    });
    expect(await create(ids.applicant, pp.key, paymentData(acceptance.submissionId, [{ _src: 0 }, { _src: 1 }]))).toMatchObject({ ok: true });
  });

  it('財產編號: finance / admin only, after approval, audited', async () => {
    const service = await import('@/lib/custom-forms/service');
    const orderId = await approvedOrder('貨到付款');
    const acceptance = must(await create(ids.applicant, ac.key, acceptanceData(orderId, ['pass', 'pass'])));
    const cell = (value: string, p: Partial<{ table: string; row: number; column: string }> = {}) => ({
      table: 'items',
      row: 0,
      column: 'propertyTag',
      value,
      ...p,
    });

    expect(await service.setFinanceCell({ id: ids.finance }, acceptance.submissionId, cell('PT-1'))).toMatchObject({ ok: false, code: 'conflict' });
    await approveAll(acceptance.submissionId);
    expect(await service.setFinanceCell({ id: ids.applicant }, acceptance.submissionId, cell('PT-1'))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await service.setFinanceCell({ id: ids.finance }, acceptance.submissionId, cell('PT-1', { column: 'description' }))).toMatchObject({
      ok: false,
      code: 'validation',
    });
    expect(await service.setFinanceCell({ id: ids.finance }, acceptance.submissionId, cell('PT-1', { row: 5 }))).toMatchObject({ ok: false, code: 'validation' });
    expect(await service.setFinanceCell({ id: ids.finance }, acceptance.submissionId, cell('x'.repeat(101)))).toMatchObject({ ok: false, code: 'validation' });

    expect(await service.setFinanceCell({ id: ids.finance }, acceptance.submissionId, cell('  PT-1  ', { row: 1 }))).toMatchObject({ ok: true });
    expect((await rowsOf(acceptance.submissionId)).map((r) => r.propertyTag)).toEqual([null, 'PT-1']);
    const [audit] = await sql`select details from audit_events where entity_id = ${acceptance.submissionId} and action = 'custom.finance_filled'`;
    expect(audit.details).toMatchObject({ table: 'items', row: 1, column: 'propertyTag', before: null, after: 'PT-1' });
  });

  it('免走採購: its own standalone case, under NT$10,000, budget code with an owner', async () => {
    const data = (amounts: string[], p: Record<string, unknown> = {}) => ({
      budgetCodeId: ids.budget,
      items: { rows: amounts.map((amount) => ({ description: '文具', amount })) },
      payeeType: 'supplier',
      payeeSupplierId: ids.supplier,
      paymentMethod: '匯款',
      ...p,
    });
    expect(await create(ids.applicant, se.key, data(['5000', '5000']))).toMatchObject({ ok: false, code: 'validation', error: expect.stringContaining('須低於') });
    expect(await create(ids.applicant, se.key, data(['500'], { budgetCodeId: ids.orphanBudget }))).toMatchObject({ ok: false });
    expect(await create(ids.applicant, se.key, data(['500'], { payeeType: 'employee' }))).toMatchObject({ ok: false, code: 'validation' });
    const ok = must(await create(ids.applicant, se.key, data(['5000', '4999.99'])));
    const [row] = await sql`select s.total_amount, s.budget_code_id, c.case_type from form_submissions s
      join procurement_cases c on c.id = s.procurement_case_id where s.id = ${ok.submissionId}`;
    expect(row).toMatchObject({ total_amount: '9999.99', budget_code_id: ids.budget, case_type: 'standalone_expense' });
    expect(await approvers(ok.submissionId)).toEqual([ids.mgr, ids.owner, ids.gm]);
  });
});
