import { describe, expect, it } from 'vitest';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { parseFormSchema, type FormSchema } from '@/lib/custom-forms/schema';
import { BUSINESS_TRIP_FORM } from '@/lib/custom-forms/migrated/business-trip';
import { TRAVEL_EXPENSE_FORM } from '@/lib/custom-forms/migrated/travel';
import { draftStatus, normalizeDateTime, planFill, resolveReference, ROW_ID_KEY } from './draft-fill';

const TODAY = '2026-10-30';

function schemaOf(raw: unknown): FormSchema {
  const r = parseFormSchema(raw);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r.schema;
}

const trip = schemaOf(BUSINESS_TRIP_FORM.schema);
const travel = schemaOf(TRAVEL_EXPENSE_FORM.schema);

const picker: PickerOptions = {
  employees: [
    { id: '20000000-0000-0000-0000-000000000002', label: '測試主管（測試研發部）' },
    { id: '20000000-0000-0000-0000-0000000000b1', label: '測試員工乙（測試研發部）' },
  ],
  departments: [],
  budgetCodes: [],
  projects: [
    { id: '30000000-0000-0000-0000-00000000000a', label: 'T-PRJ-A 測試專案 A' },
    { id: '30000000-0000-0000-0000-00000000000b', label: 'T-PRJ-B 測試專案 B' },
  ],
  suppliers: [],
  assets: [],
  sources: [],
};

describe('normalizeDateTime', () => {
  it('keeps Taipei wall time and drops zero seconds', () => {
    expect(normalizeDateTime('2026-11-04T09:00:00')).toBe('2026-11-04T09:00');
    expect(normalizeDateTime('2026/11/4 9:00')).toBe('2026-11-04T09:00');
  });
  it('converts explicit offsets to Taipei time', () => {
    expect(normalizeDateTime('2026-11-04T01:00:00Z')).toBe('2026-11-04T09:00');
    expect(normalizeDateTime('2026-11-04T09:00+08:00')).toBe('2026-11-04T09:00');
  });
  it('rejects non-zero seconds and garbage', () => {
    expect(normalizeDateTime('2026-11-04T09:00:30')).toBeNull();
    expect(normalizeDateTime('下週三')).toBeNull();
  });
});

describe('resolveReference', () => {
  it('resolves an exact name or code, otherwise returns candidates', () => {
    expect(resolveReference('測試專案 A', picker.projects)).toEqual({ ok: true, value: '30000000-0000-0000-0000-00000000000a' });
    expect(resolveReference('t-prj-b', picker.projects)).toEqual({ ok: true, value: '30000000-0000-0000-0000-00000000000b' });
    const vague = resolveReference('測試專案', picker.projects);
    expect(vague.ok).toBe(false);
    if (!vague.ok) {
      expect(vague.code).toBe('ambiguous');
      expect(vague.candidates).toHaveLength(2);
    }
    expect(resolveReference('不存在', picker.projects)).toMatchObject({ ok: false, code: 'not_found' });
    // A project literally named 測試專案 does not win while 測試專案 A／B also match.
    const withExact = [{ id: '30000000-0000-0000-0000-000000000001', label: 'T-PRJ 測試專案' }, ...picker.projects];
    expect(resolveReference('測試專案', withExact)).toMatchObject({ ok: false, code: 'ambiguous' });
    expect(resolveReference('T-PRJ', withExact)).toMatchObject({ ok: false, code: 'ambiguous' });
    expect(resolveReference('測試專案 A', withExact)).toEqual({ ok: true, value: '30000000-0000-0000-0000-00000000000a' });
  });
});

describe('planFill — business trip', () => {
  it('stores normalized values and the project id, reports the rest as missing', () => {
    const plan = planFill(
      trip,
      picker,
      {},
      {
        set: [
          { field: 'tripStartAt', value: '2026-11-04T09:00:00' },
          { field: 'tripEndAt', value: '2026-11-04T18:00' },
          { field: 'location', value: '台中' },
          { field: 'purpose', value: '設備驗收' },
          { field: 'projectId', value: '測試專案 A' },
        ],
      },
      TODAY
    );
    expect(plan.rejected).toEqual([]);
    expect(plan.data).toMatchObject({
      tripStartAt: '2026-11-04T09:00',
      tripEndAt: '2026-11-04T18:00',
      location: '台中',
      purpose: '設備驗收',
      projectId: '30000000-0000-0000-0000-00000000000a',
    });
    expect(draftStatus(trip, plan.data, TODAY)).toEqual({ missing: [], invalid: [], readyToSubmit: true });
  });

  it('rejects unknown fields, ambiguous references and rule violations without losing valid values', () => {
    const plan = planFill(
      trip,
      picker,
      { tripStartAt: '2026-11-04T09:00' },
      {
        set: [
          { field: 'destination', value: '台北' },
          { field: 'projectId', value: '測試專案' },
          { field: 'tripEndAt', value: '2026-11-04T08:00' },
          { field: 'location', value: '台中' },
        ],
      },
      TODAY
    );
    expect(plan.data.location).toBe('台中');
    expect(plan.data).not.toHaveProperty('destination');
    expect(plan.data.projectId).toBeUndefined();
    expect(plan.data.tripEndAt).toBeUndefined();
    expect(plan.rejected.map((r) => [r.field, r.code])).toEqual([
      ['destination', 'unknown_field'],
      ['projectId', 'ambiguous'],
      ['tripEndAt', 'invalid'],
    ]);
    expect(plan.rejected[1].candidates).toHaveLength(2);
    expect(plan.changed).toEqual(['location']);
  });

  it('changes only the named field', () => {
    const current = { tripStartAt: '2026-11-04T09:00', tripEndAt: '2026-11-04T18:00', location: '台中', purpose: '設備驗收' };
    const plan = planFill(trip, picker, current, { set: [{ field: 'tripEndAt', value: '2026-11-04T19:00' }] }, TODAY);
    expect(plan.changed).toEqual(['tripEndAt']);
    expect(plan.data).toEqual({ ...current, tripEndAt: '2026-11-04T19:00' });
  });
});

describe('planFill — expense rows', () => {
  const add = (summary: string, amount: string) => ({
    op: 'add' as const,
    table: 'costItems',
    cells: [
      { column: 'expenseDate', value: '2026-11-04' },
      { column: 'category', value: '交通費' },
      { column: 'summary', value: summary },
      { column: 'amount', value: amount },
    ],
  });

  it('adds, updates and deletes rows by stable id; the backend computes the total', () => {
    const p1 = planFill(travel, picker, {}, { rows: [add('交通費', '300'), add('停車費', '120 元')] }, TODAY);
    expect(p1.rejected).toEqual([]);
    const t1 = p1.data.costItems as { rows: Record<string, unknown>[]; total: unknown };
    expect(t1.rows).toHaveLength(2);
    expect(Number(t1.total)).toBe(420);
    const [transport, parking] = t1.rows;
    expect(typeof parking[ROW_ID_KEY]).toBe('string');

    const p2 = planFill(travel, picker, p1.data, { rows: [{ op: 'update', table: 'costItems', row_id: String(parking[ROW_ID_KEY]), cells: [{ column: 'amount', value: '150' }] }] }, TODAY);
    const t2 = p2.data.costItems as { rows: Record<string, unknown>[]; total: unknown };
    expect(Number(t2.total)).toBe(450);
    expect(t2.rows[0]).toEqual(transport);
    expect(t2.rows[1][ROW_ID_KEY]).toBe(parking[ROW_ID_KEY]);

    const p3 = planFill(travel, picker, p2.data, { rows: [{ op: 'delete', table: 'costItems', row_id: String(transport[ROW_ID_KEY]) }] }, TODAY);
    const t3 = p3.data.costItems as { rows: Record<string, unknown>[]; total: unknown };
    expect(t3.rows).toHaveLength(1);
    expect(t3.rows[0][ROW_ID_KEY]).toBe(parking[ROW_ID_KEY]);
    expect(Number(t3.total)).toBe(150);
  });

  it('rejects whole-table set and unknown row ids', () => {
    const plan = planFill(
      travel,
      picker,
      {},
      { set: [{ field: 'costItems', value: '[]' }], rows: [{ op: 'delete', table: 'costItems', row_id: 'nope' }] },
      TODAY
    );
    expect(plan.rejected.map((r) => r.code)).toEqual(['invalid', 'row_not_found']);
    expect(plan.changed).toEqual([]);
  });
});
