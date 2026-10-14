import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { EDITIONS, EXPENSE_EDITIONS, type ExpenseEdition } from '@/lib/expense-claims/editions';
import { parseExpenseClaimInput, type ExpenseClaimInput, type ExpenseClaimItemInput } from '@/lib/expense-claims/validate';
import { centsToDecimal } from '@/lib/money';
import { parseDefinition } from '../definition';
import { allFields } from '../schema';
import { validateSubmission, type TableValue } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { EXPENSE_CLAIM_FORMS } from './expense-claims';

// Parity checklist for batch 3: each designer definition accepts and rejects
// the same submissions as parseExpenseClaimInput for its edition, converts
// to the same NT$ cents, and resolves the same chain as buildChain.

const TODAY = '2026-10-13';
const BUDGET = '33333333-3333-4333-8333-333333333333';
const SUPPLIER = '44444444-4444-4444-8444-444444444444';

const formOf = (edition: ExpenseEdition) => EXPENSE_CLAIM_FORMS.find((f) => f.legacyFormType === EDITIONS[edition].formType)!;

function definition(edition: ExpenseEdition) {
  const f = formOf(edition);
  const r = parseDefinition(f.schema, f.flow);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r;
}

type Patch = { items?: Partial<ExpenseClaimItemInput>[]; header?: Partial<ExpenseClaimInput> };

function oldInput(edition: ExpenseEdition, p: Patch = {}): ExpenseClaimInput {
  const first = EDITIONS[edition].categories[0];
  return {
    departmentId: '',
    budgetCodeId: BUDGET,
    items: (p.items ?? [{}]).map((i) => ({ category: first, description: '測試用品', currency: 'TWD', exchangeRate: '', amount: '1200', ...i })),
    remark: '',
    payeeType: 'supplier',
    payeeSupplierId: SUPPLIER,
    expectedPaymentDate: '2026-10-25',
    paymentMethod: 'transfer',
    remittanceInfo: '台灣銀行 信義分行 王小明 012345678901',
    ...p.header,
  };
}

/** Same submission as the designer form sends it. */
function newInput(edition: ExpenseEdition, p: Patch = {}): Record<string, unknown> {
  const o = oldInput(edition, p);
  return {
    budgetCodeId: o.budgetCodeId,
    items: { rows: o.items, total: null },
    remark: o.remark,
    payeeType: o.payeeType,
    payeeSupplierId: o.payeeSupplierId,
    expectedPaymentDate: o.expectedPaymentDate,
    paymentMethod: o.paymentMethod,
    remittanceInfo: o.remittanceInfo,
  };
}

describe('batch 3 definitions', () => {
  it('parse, replace the four editions and carry each edition’s scope, categories, default payee', () => {
    expect(MIGRATION_BATCHES[3].forms).toEqual(EXPENSE_CLAIM_FORMS);
    expect(EXPENSE_CLAIM_FORMS.map((f) => f.legacyFormType).sort()).toEqual(EXPENSE_EDITIONS.map((e) => EDITIONS[e].formType).sort());
    expect(new Set(EXPENSE_CLAIM_FORMS.map((f) => f.numberPrefix)).size).toBe(4);
    for (const edition of EXPENSE_EDITIONS) {
      const { schema } = definition(edition);
      const fields = Object.fromEntries(allFields(schema).map((f) => [f.id, f]));
      const budget = fields.budgetCodeId;
      expect(budget.type === 'budget_code' && budget.budgetScope).toBe(EDITIONS[edition].budgetScope);
      const items = fields.items;
      if (items.type !== 'table') throw new Error('items should be a table');
      expect(items.columns.find((c) => c.id === 'category')?.options?.map((o) => o.value)).toEqual([...EDITIONS[edition].categories]);
      const payee = fields.payeeType;
      expect(payee.type === 'select' && payee.default).toBe(EDITIONS[edition].defaultPayee);
      const remittance = fields.remittanceInfo;
      expect(remittance.type === 'textarea' && remittance.sensitive).toBe(true);
    }
  });
});

for (const edition of EXPENSE_EDITIONS) {
  const config = EDITIONS[edition];
  const capped = Object.keys(config.categoryMaxCents)[0];
  const uncapped = config.categories.find((c) => config.categoryMaxCents[c] === undefined);

  describe(`${config.label}: old parser vs designer definition`, () => {
    const { schema } = definition(edition);
    const cases: { name: string; p: Patch; ok: boolean }[] = [
      { name: 'accepts a complete form', p: {}, ok: true },
      { name: 'paid to the applicant (supplier ignored)', p: { header: { payeeType: 'applicant', payeeSupplierId: '' } }, ok: true },
      { name: 'supplier payee needs a supplier', p: { header: { payeeSupplierId: '' } }, ok: false },
      { name: 'unknown payee type', p: { header: { payeeType: 'friend' } }, ok: false },
      { name: 'payment date today', p: { header: { expectedPaymentDate: TODAY } }, ok: true },
      { name: 'payment date in the past', p: { header: { expectedPaymentDate: '2026-10-12' } }, ok: false },
      { name: 'payment date missing', p: { header: { expectedPaymentDate: '' } }, ok: false },
      { name: 'unknown payment method', p: { header: { paymentMethod: 'barter' } }, ok: false },
      { name: 'transfer with 無', p: { header: { remittanceInfo: '無' } }, ok: false },
      { name: 'transfer with padded 無', p: { header: { remittanceInfo: ' 無 ' } }, ok: false },
      { name: 'cash with 無', p: { header: { paymentMethod: 'cash', remittanceInfo: '無' } }, ok: true },
      { name: 'check with 無', p: { header: { paymentMethod: 'check', remittanceInfo: '無' } }, ok: true },
      { name: 'remittance info is required', p: { header: { paymentMethod: 'cash', remittanceInfo: ' ' } }, ok: false },
      { name: 'remittance info of 500 characters', p: { header: { remittanceInfo: 'x'.repeat(500) } }, ok: true },
      { name: 'remittance info over 500 characters', p: { header: { remittanceInfo: 'x'.repeat(501) } }, ok: false },
      { name: 'remark of 1000 characters', p: { header: { remark: 'x'.repeat(1000) } }, ok: true },
      { name: 'remark over 1000 characters', p: { header: { remark: 'x'.repeat(1001) } }, ok: false },
      { name: 'at least one row', p: { items: [] }, ok: false },
      { name: '50 rows', p: { items: Array.from({ length: 50 }, () => ({})) }, ok: true },
      { name: '51 rows', p: { items: Array.from({ length: 51 }, () => ({})) }, ok: false },
      { name: 'unknown category', p: { items: [{ category: '娛樂費' }] }, ok: false },
      { name: 'unknown currency', p: { items: [{ currency: 'BTC' }] }, ok: false },
      { name: 'description is required', p: { items: [{ description: ' ' }] }, ok: false },
      { name: 'description over 500 characters', p: { items: [{ description: 'x'.repeat(501) }] }, ok: false },
      { name: 'amount 0', p: { items: [{ amount: '0' }] }, ok: false },
      { name: 'amount with 3 decimals', p: { items: [{ amount: '1.234' }] }, ok: false },
      { name: 'TWD rate is 1 whatever was sent', p: { items: [{ exchangeRate: '5' }] }, ok: true },
      { name: 'USD with a plausible rate', p: { items: [{ currency: 'USD', amount: '30', exchangeRate: '32.15' }] }, ok: true },
      { name: 'USD at 1 is implausible', p: { items: [{ currency: 'USD', amount: '30', exchangeRate: '1' }] }, ok: false },
      { name: 'foreign currency needs a rate', p: { items: [{ currency: 'JPY', exchangeRate: '' }] }, ok: false },
      { name: 'tiny KRW amount converts to NT$ 0', p: { items: [{ currency: 'KRW', amount: '0.01', exchangeRate: '0.012' }] }, ok: false },
    ];
    if (capped) {
      cases.push(
        { name: 'capped category at NT$ 10,000', p: { items: [{ category: capped, amount: '10000' }] }, ok: true },
        { name: 'capped category over NT$ 10,000', p: { items: [{ category: capped, amount: '10000.01' }] }, ok: false },
        { name: 'capped category over the cap after conversion', p: { items: [{ category: capped, currency: 'USD', amount: '300', exchangeRate: '33.34' }] }, ok: false },
        { name: 'capped category under the cap after conversion', p: { items: [{ category: capped, currency: 'USD', amount: '300', exchangeRate: '33.33' }] }, ok: true }
      );
    }
    if (uncapped) cases.push({ name: 'other categories have no cap', p: { items: [{ category: uncapped, amount: '250000' }] }, ok: true });

    for (const c of cases) {
      it(c.name, () => {
        const before = parseExpenseClaimInput(edition, oldInput(edition, c.p), TODAY);
        const after = validateSubmission(schema, newInput(edition, c.p), TODAY);
        expect({ old: before.ok, error: before.ok ? undefined : before.error }).toMatchObject({ old: c.ok });
        expect({ next: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ next: c.ok });
        if (before.ok && after.ok) {
          expect(after.value.promoted.totalAmount).toBe(centsToDecimal(before.value.total));
          expect(after.value.promoted.budgetCodeId).toBe(BUDGET);
          const rows = (after.value.data.items as TableValue).rows;
          expect(rows.map((r) => r.twdAmount)).toEqual(before.value.items.map((i) => centsToDecimal(i.twdAmount)));
          expect(after.value.data.payeeSupplierId ?? null).toBe(before.value.payeeSupplierId);
        }
      });
    }
  });
}

describe('批次 3 approval chain matches buildChain', () => {
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

  for (const edition of EXPENSE_EDITIONS) {
    it(`${EDITIONS[edition].label}: every applicant, manager, budget owner and amount`, () => {
      const r = definition(edition);
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
                  formKey: formOf(edition).key,
                  today: TODAY,
                  fields: { budgetCodeId: BUDGET, items: amount.toFixed(2) },
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
