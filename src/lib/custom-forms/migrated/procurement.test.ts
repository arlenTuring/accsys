import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { validateQuoteCount } from '@/lib/procurement/quote-requirement';
import { validatePurchaseRequestInput } from '@/lib/purchase-requests/validate';
import { parseDefinition } from '../definition';
import { allFields, sourceTargets, SOURCE_ROW_KEY } from '../schema';
import { validateSubmission, type TableValue } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { PAYMENT_TERMS, PROCUREMENT_FORMS, PURCHASE_ORDER_FORM, PURCHASE_REQUEST_FORM, PURCHASE_REQUEST_KEY } from './procurement';
import type { MigratedForm } from './types';

// Parity checklist for batch 5a: 請購單 / 採購單 accept and reject what the
// hard-coded services did (budget-owner sameness and the source request are
// checked against the database, see tests/integration/legacy-procurement),
// and resolve the same chain as buildChain.

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
    expect(PROCUREMENT_FORMS.map((f) => f.legacyFormType)).toEqual(['purchase_request', 'purchase_order']);
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

describe('批次 5a approval chain matches buildChain', () => {
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
                  fields: { 'items.budgetCodeId': [BUDGET, BUDGET], items: amount.toFixed(2) },
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
