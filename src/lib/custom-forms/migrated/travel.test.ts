import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain } from '@/lib/approval/chain';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { OrgSnapshot } from '@/lib/approval/flow/types';
import { centsToDecimal } from '@/lib/money';
import { parseTravelExpenseInput, type TravelCostItemInput, type TravelExpenseInput } from '@/lib/travel-expenses/validate';
import { parseDefinition } from '../definition';
import type { TableValue } from '../validate';
import { validateSubmission } from '../validate';
import { MIGRATION_BATCHES } from '.';
import { TRAVEL_EXPENSE_FORM } from './travel';

// Parity checklist for batch 2: the designer definition accepts and rejects
// the same submissions as parseTravelExpenseInput, converts foreign amounts
// to the same NT$ cents, and resolves the same chain as buildChain.

const TODAY = '2026-10-13';
const BUDGET = '33333333-3333-4333-8333-333333333333';

function definition() {
  const r = parseDefinition(TRAVEL_EXPENSE_FORM.schema, TRAVEL_EXPENSE_FORM.flow);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r;
}

const cost = (patch: Partial<TravelCostItemInput> = {}): TravelCostItemInput => ({
  expenseDate: '2026-10-05',
  category: '交通費',
  fromStation: '台北',
  toStation: '左營',
  mileage: '',
  summary: '高鐵',
  currency: 'TWD',
  amount: '1490',
  exchangeRate: '',
  ...patch,
});
const report = (tripDate = '2026-10-05', patch: Record<string, string> = {}) => ({ tripDate, location: '高雄', itinerary: '場域測試', timeSlot: '09:00-18:00', ...patch });

type Patch = { costs?: Partial<TravelCostItemInput>[]; reports?: Record<string, string>[]; header?: Partial<TravelExpenseInput> };

function oldInput(p: Patch = {}): TravelExpenseInput {
  return {
    budgetCodeId: BUDGET,
    advanceAmount: '',
    tripStartDate: '2026-10-05',
    tripEndDate: '2026-10-06',
    purpose: '高雄自駕車場域測試',
    tripOrderNo: 'BT-001',
    companions: '無',
    reportItems: (p.reports ?? [report()]) as TravelExpenseInput['reportItems'],
    costItems: (p.costs ?? [{}]).map((c) => cost(c)),
    ...p.header,
  };
}

/** Same submission as the designer form sends it. */
function newInput(p: Patch = {}): Record<string, unknown> {
  const o = oldInput(p);
  return {
    budgetCodeId: o.budgetCodeId,
    advanceAmount: o.advanceAmount,
    tripStartDate: o.tripStartDate,
    tripEndDate: o.tripEndDate,
    purpose: o.purpose,
    tripOrderNo: o.tripOrderNo,
    companions: o.companions,
    reportItems: { rows: o.reportItems, total: null },
    costItems: { rows: o.costItems, total: null },
  };
}

describe('batch 2 definition', () => {
  it('parses, is not a 代為申請 form and replaces travel_expense', () => {
    const r = definition();
    expect(r.schema.onBehalf).toBeUndefined();
    expect(TRAVEL_EXPENSE_FORM.legacyFormType).toBe('travel_expense');
    expect(MIGRATION_BATCHES[2].forms).toEqual([TRAVEL_EXPENSE_FORM]);
  });
});

describe('出差報告暨旅費報支單: old parser vs designer definition', () => {
  const { schema } = definition();
  const cases: { name: string; p: Patch; ok: boolean }[] = [
    { name: 'accepts a complete form', p: {}, ok: true },
    { name: 'foreign currency with a plausible rate', p: { costs: [{}, { category: '住宿費', currency: 'USD', amount: '100', exchangeRate: '32.15', summary: '飯店' }] }, ok: true },
    { name: 'TWD rate is 1 whatever was sent', p: { costs: [{ exchangeRate: '5' }] }, ok: true },
    { name: 'USD at 1 is implausible', p: { costs: [{ currency: 'USD', amount: '5000', exchangeRate: '1' }] }, ok: false },
    { name: 'USD at 0.000001', p: { costs: [{ currency: 'USD', amount: '5000', exchangeRate: '0.000001' }] }, ok: false },
    { name: 'USD at 500', p: { costs: [{ currency: 'USD', amount: '5000', exchangeRate: '500' }] }, ok: false },
    { name: 'USD at the lower bound 20', p: { costs: [{ currency: 'USD', amount: '5000', exchangeRate: '20' }] }, ok: true },
    { name: 'USD at the upper bound 50', p: { costs: [{ currency: 'USD', amount: '5000', exchangeRate: '50' }] }, ok: true },
    { name: 'JPY at 0.21', p: { costs: [{ currency: 'JPY', exchangeRate: '0.21' }] }, ok: true },
    { name: 'JPY at 1', p: { costs: [{ currency: 'JPY', exchangeRate: '1' }] }, ok: false },
    { name: 'foreign currency needs a rate', p: { costs: [{ currency: 'JPY', exchangeRate: '' }] }, ok: false },
    { name: 'rate with 7 decimals', p: { costs: [{ currency: 'USD', exchangeRate: '32.1234567' }] }, ok: false },
    { name: 'tiny KRW amount converts to NT$ 0', p: { costs: [{ currency: 'KRW', amount: '0.01', exchangeRate: '0.012' }] }, ok: false },
    { name: 'end date before start date', p: { header: { tripStartDate: '2026-10-06', tripEndDate: '2026-10-05' }, reports: [report('2026-10-06')] }, ok: false },
    { name: 'report row after the trip', p: { reports: [report('2026-10-09')] }, ok: false },
    { name: 'report row before the trip', p: { reports: [report('2026-10-04')] }, ok: false },
    { name: 'report rows on the first and last day', p: { reports: [report('2026-10-05'), report('2026-10-06')] }, ok: true },
    { name: 'companions are required (or 無)', p: { header: { companions: ' ' } }, ok: false },
    { name: 'purpose is required', p: { header: { purpose: '' } }, ok: false },
    { name: 'trip order number is required', p: { header: { tripOrderNo: '' } }, ok: false },
    { name: 'at least one report row', p: { reports: [] }, ok: false },
    { name: 'at least one cost row', p: { costs: [] }, ok: false },
    { name: 'unknown category', p: { costs: [{ category: '娛樂費' }] }, ok: false },
    { name: 'unknown currency', p: { costs: [{ currency: 'BTC' }] }, ok: false },
    { name: 'amount 0', p: { costs: [{ amount: '0' }] }, ok: false },
    { name: 'amount with 3 decimals', p: { costs: [{ amount: '1.234' }] }, ok: false },
    { name: 'summary is required', p: { costs: [{ summary: '' }] }, ok: false },
    { name: 'mileage 0', p: { costs: [{ mileage: '0' }] }, ok: true },
    { name: 'mileage with one decimal', p: { costs: [{ mileage: '12.5' }] }, ok: true },
    { name: 'mileage with two decimals', p: { costs: [{ mileage: '12.55' }] }, ok: false },
    { name: 'negative mileage', p: { costs: [{ mileage: '-1' }] }, ok: false },
    { name: 'advance amount', p: { header: { advanceAmount: '3000' } }, ok: true },
    { name: 'negative advance amount', p: { header: { advanceAmount: '-1' } }, ok: false },
    { name: 'itinerary of 1000 characters', p: { reports: [report('2026-10-05', { itinerary: 'x'.repeat(1000) })] }, ok: true },
    { name: 'itinerary over 1000 characters', p: { reports: [report('2026-10-05', { itinerary: 'x'.repeat(1001) })] }, ok: false },
    { name: 'location over 200 characters', p: { reports: [report('2026-10-05', { location: 'x'.repeat(201) })] }, ok: false },
    { name: 'stations over 100 characters', p: { costs: [{ fromStation: 'x'.repeat(101) }] }, ok: false },
    { name: '50 cost rows', p: { costs: Array.from({ length: 50 }, () => ({})) }, ok: true },
    { name: '51 cost rows', p: { costs: Array.from({ length: 51 }, () => ({})) }, ok: false },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const before = parseTravelExpenseInput(oldInput(c.p));
      const after = validateSubmission(schema, newInput(c.p), TODAY);
      expect({ old: before.ok, error: before.ok ? undefined : before.error }).toMatchObject({ old: c.ok });
      expect({ next: after.ok, errors: after.ok ? undefined : after.errors }).toMatchObject({ next: c.ok });
      if (before.ok && after.ok) {
        expect(after.value.promoted.totalAmount).toBe(centsToDecimal(before.value.total));
        expect(after.value.promoted.budgetCodeId).toBe(BUDGET);
      }
    });
  }

  it('converts every amount to the same NT$ cents (half-up, exact)', () => {
    const rates: Record<string, string[]> = {
      USD: ['20', '32.155555', '49.999999'],
      JPY: ['0.1', '0.213456', '0.4'],
      KRW: ['0.012', '0.023457', '0.045'],
      EUR: ['35.123'],
    };
    const amounts = ['0.05', '1', '123.45', '777.77', '99999.99'];
    const costs: Partial<TravelCostItemInput>[] = [];
    for (const [currency, list] of Object.entries(rates))
      for (const exchangeRate of list) for (const amount of amounts) costs.push({ currency, exchangeRate, amount });
    const usable = costs.filter((c) => parseTravelExpenseInput(oldInput({ costs: [c] })).ok);
    expect(usable.length).toBeGreaterThan(40);
    for (let i = 0; i < usable.length; i += 25) {
      const chunk = usable.slice(i, i + 25);
      const before = parseTravelExpenseInput(oldInput({ costs: chunk }));
      const after = validateSubmission(schema, newInput({ costs: chunk }), TODAY);
      if (!before.ok || !after.ok) throw new Error('both should accept');
      const rows = (after.value.data.costItems as TableValue).rows;
      expect(rows.map((r) => r.twdAmount)).toEqual(before.value.costItems.map((c) => centsToDecimal(c.twdAmount)));
      expect(after.value.promoted.totalAmount).toBe(centsToDecimal(before.value.total));
    }
  });

  it('stores rate 1 on NT$ rows and skips untouched rows that only hold defaults', () => {
    const data = newInput({ costs: [{ exchangeRate: '5' }] });
    (data.costItems as TableValue).rows.push({ category: '交通費', currency: 'TWD' });
    const after = validateSubmission(schema, data, TODAY);
    if (!after.ok) throw new Error(JSON.stringify(after.errors));
    const rows = (after.value.data.costItems as TableValue).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ exchangeRate: 1, twdAmount: '1490.00' });
  });

  it('reports the out-of-band rate on its cell', () => {
    const after = validateSubmission(schema, newInput({ costs: [{ currency: 'USD', amount: '10', exchangeRate: '1' }] }), TODAY);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.errors['costItems.0.exchangeRate']).toContain('匯率不在合理範圍（1 USD 約新臺幣 20–50 元）');
  });
});

describe('批次 2 approval chain matches buildChain', () => {
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

  it('for every applicant, manager, budget owner and amount', () => {
    const r = definition();
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
                formKey: TRAVEL_EXPENSE_FORM.key,
                today: TODAY,
                fields: { budgetCodeId: BUDGET, costItems: amount.toFixed(2) },
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
});
