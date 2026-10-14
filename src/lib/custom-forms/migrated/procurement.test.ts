import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { validateQuoteCount } from '@/lib/procurement/quote-requirement';
import { validatePurchaseRequestInput } from '@/lib/purchase-requests/validate';
import { parseDefinition } from '../definition';
import { allFields, parseFormSchema, PAYMENT_BATCH_KEY, sourceTargets, SOURCE_ROW_KEY } from '../schema';
import { validateSubmission, type TableValue } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { validateAcceptanceInput } from '@/lib/acceptances/validate';
import { validateExpenseRequestInput } from '@/lib/expense-requests/validate';
import { computeDefaultExpectedPaymentDate, computePaymentBatchDate } from '@/lib/procurement/payment-batch';
import { applyPaymentSchedule, paymentBatchOf } from '../payment';
import {
  ACCEPTANCE_FORM,
  ACCEPTANCE_KEY,
  PAYMENT_TERMS,
  PROCUREMENT_FORMS,
  PROCUREMENT_PAYMENT_FORM,
  PURCHASE_ORDER_FORM,
  PURCHASE_ORDER_KEY,
  PURCHASE_REQUEST_FORM,
  PURCHASE_REQUEST_KEY,
  STANDALONE_LIMIT_MESSAGE,
  STANDALONE_PAYMENT_FORM,
} from './procurement';
import type { MigratedForm } from './types';

// Parity checklist for batch 5: the procurement forms accept and reject what
// the hard-coded services did (budget-owner sameness, source documents and
// one-per-case are checked against the database, see
// tests/integration/legacy-procurement), and resolve the same chain as
// buildChain.

const TODAY = '2026-10-14';
const BUDGET = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';
const SOURCE = '55555555-5555-4555-8555-555555555555';

function definition(form: MigratedForm) {
  const r = parseDefinition(form.schema, form.flow);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r;
}

type Line = { description?: string; quantity?: unknown; estimatedAmount?: unknown };
const line = (p: Line = {}) => ({ budgetCodeId: BUDGET, description: '筆電', quantity: 2, estimatedAmount: '30000', ...p });

/** What the old service accepted (prepare + validatePurchaseRequestInput, owner checks aside). */
function oldRequest(lines: ReturnType<typeof line>[], days: number | null): boolean {
  if (lines.length === 0 || lines.length > 100) return false;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) return false;
  for (const l of lines) {
    if (typeof l.description !== 'string' || l.description.length > 500) return false;
    if (!Number.isSafeInteger(l.quantity) || (l.quantity as number) > 1_000_000) return false;
    if (!/^\d+(\.\d{1,2})?$/.test(String(l.estimatedAmount))) return false;
  }
  return validatePurchaseRequestInput(
    lines.map((l) => ({
      budgetCodeId: l.budgetCodeId,
      budgetOwnerEmployeeId: 'BO',
      itemCategory: '設備',
      description: l.description,
      quantity: l.quantity as number,
      estimatedAmount: Number(l.estimatedAmount),
    }))
  ).ok;
}

describe('batch 5a definitions', () => {
  it('parse and replace 請購單 / 採購單', () => {
    expect(MIGRATION_BATCHES[5].forms).toEqual(PROCUREMENT_FORMS);
    expect(PROCUREMENT_FORMS.map((f) => f.legacyFormType)).toEqual([
      'purchase_request',
      'purchase_order',
      'acceptance',
      'expense_request',
      'standalone_expense_request',
    ]);
    for (const f of PROCUREMENT_FORMS) definition(f);
  });

  it('採購單 continues an approved 請購單 and carries its rows read-only', () => {
    const { schema } = definition(PURCHASE_ORDER_FORM);
    const source = allFields(schema).find((f) => f.type === 'source');
    expect(source?.type === 'source' && source.sources.map((r) => r.form)).toEqual([PURCHASE_REQUEST_KEY]);
    expect([...(sourceTargets(schema).get('items') ?? [])].sort()).toEqual(['budgetCodeId', 'description', 'quantity']);
    const terms = allFields(schema).find((f) => f.id === 'paymentTerms');
    expect(terms?.type === 'select' && terms.options.map((o) => o.value)).toEqual([...PAYMENT_TERMS]);
  });
});

describe('請購單: old service vs designer definition', () => {
  const { schema } = definition(PURCHASE_REQUEST_FORM);
  const cases: { name: string; lines: ReturnType<typeof line>[]; days?: number | null; ok: boolean }[] = [
    { name: 'accepts a complete form', lines: [line()], ok: true },
    { name: 'needed-within days are optional', lines: [line()], days: null, ok: true },
    { name: 'needed within 0 days', lines: [line()], days: 0, ok: true },
    { name: 'needed within 3650 days', lines: [line()], days: 3650, ok: true },
    { name: 'needed within 3651 days', lines: [line()], days: 3651, ok: false },
    { name: 'negative days', lines: [line()], days: -1, ok: false },
    { name: 'fractional days', lines: [line()], days: 1.5, ok: false },
    { name: 'at least one line', lines: [], ok: false },
    { name: '100 lines', lines: Array.from({ length: 100 }, () => line()), ok: true },
    { name: '101 lines', lines: Array.from({ length: 101 }, () => line()), ok: false },
    { name: 'blank description', lines: [line({ description: '  ' })], ok: false },
    { name: 'description of 500 characters', lines: [line({ description: 'x'.repeat(500) })], ok: true },
    { name: 'description over 500 characters', lines: [line({ description: 'x'.repeat(501) })], ok: false },
    { name: 'quantity 0', lines: [line({ quantity: 0 })], ok: false },
    { name: 'fractional quantity', lines: [line({ quantity: 1.5 })], ok: false },
    { name: 'quantity 1,000,000', lines: [line({ quantity: 1_000_000 })], ok: true },
    { name: 'quantity over 1,000,000', lines: [line({ quantity: 1_000_001 })], ok: false },
    { name: 'estimate 0', lines: [line({ estimatedAmount: '0' })], ok: false },
    { name: 'estimate 0.01', lines: [line({ estimatedAmount: '0.01' })], ok: true },
    { name: 'estimate with 3 decimals', lines: [line({ estimatedAmount: '1.234' })], ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const days = c.days === undefined ? 30 : c.days;
      expect(oldRequest(c.lines, days)).toBe(c.ok);
      const after = validateSubmission(schema, { neededWithinDays: days ?? '', items: { rows: c.lines, total: null } }, TODAY);
      expect({ ok: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ ok: c.ok });
      if (after.ok) {
        const total = c.lines.reduce((s, l) => s + Math.round(Number(l.estimatedAmount) * 100), 0);
        expect(after.value.promoted.totalAmount).toBe((total / 100).toFixed(2));
        expect(after.value.refs.sameOwner.map((g) => ({ label: g.label, ids: [...new Set(g.ids)] }))).toEqual([{ label: '請購明細', ids: [BUDGET] }]);
      }
    });
  }
});

describe('採購單: unit prices and the quote rule match the old service', () => {
  const { schema } = definition(PURCHASE_ORDER_FORM);
  const input = (unitPrice: string, quantity: number, quoteCount: number | string, reason: string, p: Record<string, unknown> = {}) => ({
    purchaseRequestId: SOURCE,
    items: { rows: [{ budgetCodeId: BUDGET, description: '筆電', quantity, unitPrice, [SOURCE_ROW_KEY]: 0 }], total: null },
    supplierId: SUPPLIER,
    paymentMethod: '匯款',
    paymentTerms: '貨到付款',
    expectedDeliveryDays: 14,
    quoteCount,
    quoteCountReason: reason,
    ...p,
  });

  it('every total, quote count and reason', () => {
    let cases = 0;
    for (const total of [1000, 29_999.99, 30_000, 99_999.99, 100_000, 250_000])
      for (const quoteCount of [0, 1, 2, 3, 4])
        for (const reason of ['', '  ', '僅一家代理商']) {
          const old = validateQuoteCount({ totalAmount: total, quoteCount, reason });
          const after = validateSubmission(schema, input(total.toFixed(2), 1, quoteCount, reason), TODAY);
          expect({ total, quoteCount, reason, ok: after.ok }).toEqual({ total, quoteCount, reason, ok: old.ok });
          if (after.ok) expect(after.value.promoted.totalAmount).toBe(total.toFixed(2));
          cases += 1;
        }
    expect(cases).toBe(90);
  });

  const cases: { name: string; p: Record<string, unknown>; price?: string; ok: boolean }[] = [
    { name: 'accepts a complete form', p: {}, ok: true },
    { name: 'unit price 0', p: {}, price: '0', ok: false },
    { name: 'unit price 0.01', p: {}, price: '0.01', ok: true },
    { name: 'supplier is required', p: { supplierId: '' }, ok: false },
    { name: 'payment method is required', p: { paymentMethod: ' ' }, ok: false },
    { name: 'payment method over 100 characters', p: { paymentMethod: 'x'.repeat(101) }, ok: false },
    { name: 'unknown payment terms', p: { paymentTerms: '分期' }, ok: false },
    { name: 'delivery days optional', p: { expectedDeliveryDays: '' }, ok: true },
    { name: 'delivery days over 3650', p: { expectedDeliveryDays: 3651 }, ok: false },
    { name: 'quote count over 100', p: { quoteCount: 101 }, ok: false },
    { name: 'quote count is required', p: { quoteCount: '' }, ok: false },
    { name: 'reason over 1000 characters', p: { quoteCountReason: 'x'.repeat(1001) }, ok: false },
    { name: 'source request is required', p: { purchaseRequestId: '' }, ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const after = validateSubmission(schema, input(c.price ?? '1000', 3, 1, '', c.p), TODAY);
      expect({ ok: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ ok: c.ok });
      if (after.ok) {
        const row = (after.value.data.items as TableValue).rows[0];
        expect(row.totalPrice).toBe((Number(c.price ?? '1000') * 3).toFixed(2));
        expect(row[SOURCE_ROW_KEY]).toBe(0);
      }
    });
  }
});

describe('驗收單: carried PO rows and pass / fail', () => {
  const { schema } = definition(ACCEPTANCE_FORM);
  const row = (p: Record<string, unknown> = {}) => ({
    budgetCodeId: BUDGET,
    description: '筆電',
    quantity: 2,
    amount: '60000.00',
    passFail: 'pass',
    [SOURCE_ROW_KEY]: 0,
    ...p,
  });
  const input = (rows: Record<string, unknown>[], p: Record<string, unknown> = {}) => ({
    purchaseOrderId: SOURCE,
    contractorSupplierId: SUPPLIER,
    acceptanceDate: '2026-10-01',
    items: { rows, total: null },
    ...p,
  });

  it('continues an approved 採購單; mapped columns come from it, 財產編號 is left to finance', () => {
    const source = allFields(schema).find((f) => f.type === 'source');
    expect(source?.type === 'source' && source.sources.map((r) => r.form)).toEqual([PURCHASE_ORDER_KEY]);
    expect([...(sourceTargets(schema).get('items') ?? [])].sort()).toEqual(['amount', 'budgetCodeId', 'description', 'quantity']);
    const items = allFields(schema).find((f) => f.id === 'items');
    expect(items?.type === 'table' && items.columns.find((c) => c.id === 'propertyTag')?.financeFill).toBe(true);
  });

  // Old: checkHeader (supplier, ISO date), resultsFor (pass / fail per line) and validateAcceptanceInput (at least one line).
  const cases: { name: string; rows: Record<string, unknown>[]; p?: Record<string, unknown>; ok: boolean }[] = [
    { name: 'accepts a complete form', rows: [row()], ok: true },
    { name: 'failed lines are kept', rows: [row(), row({ passFail: 'fail', [SOURCE_ROW_KEY]: 1 })], ok: true },
    { name: 'every line failed is still an acceptance', rows: [row({ passFail: 'fail' })], ok: true },
    { name: 'unknown result', rows: [row({ passFail: 'maybe' })], ok: false },
    { name: 'result is required', rows: [row({ passFail: '' })], ok: false },
    { name: 'no lines', rows: [], ok: false },
    { name: 'supplier is required', rows: [row()], p: { contractorSupplierId: '' }, ok: false },
    { name: 'acceptance date is required', rows: [row()], p: { acceptanceDate: '' }, ok: false },
    { name: 'acceptance date must be a date', rows: [row()], p: { acceptanceDate: '2026-02-30' }, ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      if (c.rows.length === 0) expect(validateAcceptanceInput({ items: [] }).ok).toBe(false);
      const after = validateSubmission(schema, input(c.rows, c.p), TODAY);
      expect({ ok: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ ok: c.ok });
      if (after.ok) {
        expect(after.value.promoted.totalAmount).toBe((60000 * c.rows.length).toFixed(2));
        expect((after.value.data.items as TableValue).rows.every((r) => r.propertyTag === null)).toBe(true);
      }
    });
  }

  it('ignores a 財產編號 typed by the applicant', () => {
    const after = validateSubmission(schema, input([row({ propertyTag: 'PT-001' })]), TODAY);
    expect(after.ok && (after.value.data.items as TableValue).rows[0].propertyTag).toBeNull();
  });
});

describe('費用申請單(採購付款): sources and payee rules match the old service', () => {
  const { schema } = definition(PROCUREMENT_PAYMENT_FORM);
  const input = (p: Record<string, unknown> = {}, rows = [{ budgetCodeId: BUDGET, description: '筆電', amount: '60000.00', [SOURCE_ROW_KEY]: 0 }]) => ({
    sourceId: SOURCE,
    items: { rows, total: null },
    payeeType: 'supplier',
    payeeSupplierId: SUPPLIER,
    bankName: '',
    bankAccount: '',
    accountName: '',
    paymentMethod: '匯款',
    invoiceMonth: '',
    expectedPaymentDate: '',
    ...p,
  });

  it('takes passed lines of an approved 驗收單, or a prepaid 採購單 before acceptance', () => {
    const source = allFields(schema).find((f) => f.type === 'source');
    if (source?.type !== 'source') throw new Error('no source field');
    const [acceptance, order] = source.sources;
    expect(acceptance.form).toBe(ACCEPTANCE_KEY);
    expect(acceptance.rows).toMatchObject({ filter: { column: 'passFail', value: 'pass' }, mode: 'subset' });
    expect(order.form).toBe(PURCHASE_ORDER_KEY);
    expect(order.when).toEqual({ field: 'paymentTerms', op: 'eq', value: '預付款' });
    expect(order.unlessCaseHas).toBe(ACCEPTANCE_KEY);
    expect(order.rows?.columns).toContainEqual({ to: 'amount', from: 'totalPrice' });
    expect(schema.payment).toEqual({ payeeType: 'payeeType', invoiceMonth: 'invoiceMonth', expectedPaymentDate: 'expectedPaymentDate' });
  });

  const cases: { name: string; p: Record<string, unknown>; rows?: Record<string, unknown>[]; ok: boolean }[] = [
    { name: 'supplier payee', p: {}, ok: true },
    { name: 'supplier payee needs a supplier', p: { payeeSupplierId: '' }, ok: false },
    { name: 'employee payee with a bank account', p: { payeeType: 'employee', payeeSupplierId: '', bankAccount: '012-3456 789' }, ok: true },
    { name: 'employee payee needs a bank account', p: { payeeType: 'employee', payeeSupplierId: '' }, ok: false },
    { name: 'bank account with letters', p: { payeeType: 'employee', bankAccount: 'ABC12345' }, ok: false },
    { name: 'bank account of 3 digits', p: { payeeType: 'employee', bankAccount: '123' }, ok: false },
    { name: 'bank account of 30 digits', p: { payeeType: 'employee', bankAccount: '1'.repeat(30) }, ok: true },
    { name: 'bank name over 100 characters', p: { payeeType: 'employee', bankAccount: '12345678', bankName: 'x'.repeat(101) }, ok: false },
    { name: 'unknown payee type', p: { payeeType: 'other' }, ok: false },
    { name: 'payment method is required', p: { paymentMethod: '' }, ok: false },
    { name: 'invoice month', p: { invoiceMonth: '2026-07' }, ok: true },
    { name: 'invoice month 13', p: { invoiceMonth: '2026-13' }, ok: false },
    { name: 'invoice month as a date', p: { invoiceMonth: '2026-07-01' }, ok: false },
    { name: 'expected payment date must be a date', p: { expectedPaymentDate: '2026-02-30' }, ok: false },
    { name: 'at least one line', p: {}, rows: [], ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const after = validateSubmission(schema, c.rows ? input(c.p, c.rows as never) : input(c.p), TODAY);
      expect({ ok: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ ok: c.ok });
      const merged = { ...input(c.p), ...(c.rows ? { items: { rows: c.rows } } : {}) } as Record<string, unknown>;
      const old = validateExpenseRequestInput({
        payeeType: merged.payeeType as 'employee' | 'supplier',
        payeeSupplierId: (merged.payeeSupplierId as string) || null,
        bankAccount: (merged.bankAccount as string) || null,
        includedItemCount: (merged.items as { rows: unknown[] }).rows.length,
      });
      if (!old.ok) expect(after.ok).toBe(false);
    });
  }

  it('masks the bank account for other viewers', () => {
    const bank = allFields(schema).find((f) => f.id === 'bankAccount');
    expect(bank?.type === 'text' && bank.sensitive).toBe(true);
  });
});

describe('付款排程 matches the old preparePayment', () => {
  const link = { payeeType: 'payeeType', invoiceMonth: 'invoiceMonth', expectedPaymentDate: 'expectedPaymentDate' };
  it('every payee, invoice month, expected date and day of submission', () => {
    let cases = 0;
    for (const payeeType of ['employee', 'supplier'] as const)
      for (const invoiceMonth of [null, '2026-01', '2026-02', '2026-12'])
        for (const expected of [null, '2026-03-10', '2026-03-16', '2026-03-31', '2026-02-28'])
          for (const today of ['2026-01-05', '2026-03-12', '2026-03-24', '2026-12-31']) {
            const out = applyPaymentSchedule(link, { payeeType, invoiceMonth: invoiceMonth ?? '', expectedPaymentDate: expected }, today);
            const oldExpected = expected ?? (invoiceMonth ? computeDefaultExpectedPaymentDate(invoiceMonth) : null);
            expect(out.expectedPaymentDate).toBe(oldExpected);
            expect(paymentBatchOf(out)).toEqual(
              computePaymentBatchDate({ payeeType, referenceDate: today, expectedPaymentDate: oldExpected, invoiceMonth })
            );
            cases += 1;
          }
    expect(cases).toBe(2 * 4 * 5 * 4);
  });

  it('client input cannot set the batch', () => {
    const { schema } = definition(PROCUREMENT_PAYMENT_FORM);
    const after = validateSubmission(
      schema,
      { ...{ sourceId: SOURCE, payeeType: 'supplier', payeeSupplierId: SUPPLIER, paymentMethod: '匯款' }, [PAYMENT_BATCH_KEY]: { batchDate: '2000-01-01' }, items: { rows: [{ budgetCodeId: BUDGET, description: 'x', amount: '1', [SOURCE_ROW_KEY]: 0 }] } },
      TODAY
    );
    expect(after.ok && PAYMENT_BATCH_KEY in after.value.data).toBe(false);
  });
});

describe('費用申請單(免走採購): old standalone checks', () => {
  const { schema } = definition(STANDALONE_PAYMENT_FORM);
  const input = (amounts: string[], p: Record<string, unknown> = {}) => ({
    budgetCodeId: BUDGET,
    items: { rows: amounts.map((amount) => ({ description: '文具', amount })), total: null },
    payeeType: 'supplier',
    payeeSupplierId: SUPPLIER,
    paymentMethod: '匯款',
    ...p,
  });
  const cases: { name: string; amounts: string[]; p?: Record<string, unknown>; ok: boolean }[] = [
    { name: 'one line', amounts: ['500'], ok: true },
    { name: 'total 9,999.99', amounts: ['5000', '4999.99'], ok: true },
    { name: 'total 10,000 is rejected', amounts: ['5000', '5000'], ok: false },
    { name: 'total over 10,000', amounts: ['12000'], ok: false },
    { name: 'amount 0', amounts: ['0'], ok: false },
    { name: '50 lines', amounts: Array.from({ length: 50 }, () => '1'), ok: true },
    { name: '51 lines', amounts: Array.from({ length: 51 }, () => '1'), ok: false },
    { name: 'no lines', amounts: [], ok: false },
    { name: 'budget code is required', amounts: ['500'], p: { budgetCodeId: '' }, ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const after = validateSubmission(schema, input(c.amounts, c.p), TODAY);
      expect({ ok: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ ok: c.ok });
      if (after.ok) expect(after.value.promoted.budgetCodeId).toBe(BUDGET);
    });
  }
  it('explains the limit like the old form', () => {
    const after = validateSubmission(schema, input(['10000']), TODAY);
    expect(!after.ok && Object.values(after.errors).join('')).toContain(STANDALONE_LIMIT_MESSAGE);
  });
});

describe('batch 5b schema checks', () => {
  const base = (fields: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, sections: [{ id: 's', title: '', description: '', fields }], ...extra });
  const choice = (p: Record<string, unknown> = {}) => ({
    id: 'payee',
    type: 'select',
    label: '付款對象',
    required: true,
    options: [
      { value: 'supplier', label: '廠商' },
      { value: 'employee', label: '員工' },
    ],
    ...p,
  });
  const table = (cols: unknown[], p: Record<string, unknown> = {}) => ({ id: 't', type: 'table', label: '明細', columns: cols, ...p });

  it('財會填寫 only on text columns, never required or unique', () => {
    expect(parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'number', financeFill: true }])])).ok).toBe(false);
    expect(parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'text', financeFill: true, unique: true }])])).ok).toBe(false);
    const ok = parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'text', required: true, financeFill: true }])]));
    expect(ok.ok && ok.schema.sections[0].fields[0].type === 'table' && ok.schema.sections[0].fields[0].columns[0].required).toBe(false);
  });

  it('合計上限 needs a total column', () => {
    expect(parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'money' }], { maxTotal: { value: 10, message: 'x' } })])).ok).toBe(false);
    expect(parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'money' }], { totalColumn: 'a', maxTotal: { value: -1, message: 'x' } })])).ok).toBe(false);
    expect(parseFormSchema(base([table([{ id: 'a', label: 'A', type: 'money' }], { totalColumn: 'a', maxTotal: { value: 10, message: 'x' } })])).ok).toBe(true);
  });

  it('付款排程 needs a required employee / supplier choice and typed date fields', () => {
    const link = (p: Record<string, unknown> = {}) => ({ payment: { payeeType: 'payee', invoiceMonth: null, expectedPaymentDate: null, ...p } });
    expect(parseFormSchema(base([choice()], link())).ok).toBe(true);
    expect(parseFormSchema(base([choice({ required: false })], link())).ok).toBe(false);
    expect(parseFormSchema(base([choice({ options: [{ value: 'a', label: 'A' }, { value: 'supplier', label: 'S' }] })], link())).ok).toBe(false);
    expect(parseFormSchema(base([choice(), { id: 'm', type: 'text', label: '月', format: 'plain' }], link({ invoiceMonth: 'm' }))).ok).toBe(false);
    expect(parseFormSchema(base([choice(), { id: 'm', type: 'text', label: '月', format: 'year_month' }], link({ invoiceMonth: 'm' }))).ok).toBe(true);
    expect(parseFormSchema(base([choice(), { id: 'd', type: 'text', label: '日' }], link({ expectedPaymentDate: 'd' }))).ok).toBe(false);
    expect(parseFormSchema(base([choice()], link({ payeeType: 'missing' }))).ok).toBe(false);
  });
});

describe('批次 5 approval chain matches buildChain', () => {
  const people = ['P1', 'MGR', 'BO', 'GM', 'CH'];
  const amounts = [1, CHAIRMAN_THRESHOLD, CHAIRMAN_THRESHOLD + 0.01, 250000];

  function org(managerId: string, ownerId: string): OrgSnapshot {
    return {
      employees: new Map(people.map((id) => [id, { id, name: id, departmentId: 'D1', active: true }])),
      departments: new Map([['D1', { id: 'D1', name: '部門', parentId: null, managerId, levelCode: null, active: true }]]),
      levels: new Map(),
      jobRoles: new Map([
        ['general_manager', { name: '總經理', active: true }],
        ['chairman', { name: '董事長', active: true }],
      ]),
      jobRoleBindings: [
        { jobRole: 'general_manager', departmentId: null, employeeId: 'GM', isPrimary: true },
        { jobRole: 'chairman', departmentId: null, employeeId: 'CH', isPrimary: true },
      ],
      groups: new Map(),
      delegations: [],
      budgetOwners: new Map([[BUDGET, ownerId]]),
      assetCustodians: new Map(),
    };
  }

  for (const form of PROCUREMENT_FORMS) {
    it(`${form.name}: every applicant, manager, budget owner and amount`, () => {
      const r = definition(form);
      let cases = 0;
      for (const applicant of people)
        for (const manager of people)
          for (const owner of people)
            for (const amount of amounts) {
              const legacy = generateApprovalChain({
                applicantEmployeeId: applicant,
                departmentManagerEmployeeId: manager,
                budgetOwnerEmployeeId: owner,
                generalManagerEmployeeId: 'GM',
                chairmanEmployeeId: amount > CHAIRMAN_THRESHOLD ? 'CH' : applicant,
                totalAmount: amount,
              });
              const resolved = resolveFlow(
                r.flow,
                {
                  applicantEmployeeId: applicant,
                  filerEmployeeId: applicant,
                  departmentId: 'D1',
                  formKey: form.key,
                  today: TODAY,
                  fields: { 'items.budgetCodeId': [BUDGET, BUDGET], budgetCodeId: BUDGET, items: amount.toFixed(2) },
                },
                org(manager, owner)
              );
              expect(resolved.ok).toBe(true);
              if (!resolved.ok) return;
              const pending = resolved.steps.filter((s) => s.status === 'pending').map((s) => [s.approverEmployeeId, s.blockId]);
              expect(pending).toEqual(legacy.map((s) => [s.approverEmployeeId, s.approverRole === 'department_manager' ? 'dept_manager' : s.approverRole]));
              cases += 1;
            }
      expect(cases).toBe(people.length ** 3 * amounts.length);
    });
  }
});
