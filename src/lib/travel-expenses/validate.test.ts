import { describe, expect, it } from 'vitest';
import type { Cents } from '@/lib/money';
import {
  convertToTwdCents,
  isIsoDate,
  parseRateMicros,
  parseTravelExpenseInput,
  type TravelCostItemInput,
  type TravelExpenseInput,
} from './validate';

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

const base = (patch: Partial<TravelExpenseInput> = {}): TravelExpenseInput => ({
  budgetCodeId: '00000000-0000-0000-0000-000000000003',
  advanceAmount: '',
  tripStartDate: '2026-10-05',
  tripEndDate: '2026-10-06',
  purpose: '高雄自駕車場域測試',
  tripOrderNo: 'BT-001',
  companions: '無',
  reportItems: [{ tripDate: '2026-10-05', location: '高雄', itinerary: '場域測試', timeSlot: '09:00-18:00' }],
  costItems: [cost()],
  ...patch,
});

describe('isIsoDate', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026/02/28')).toBe(false);
  });
});

describe('exchange rates', () => {
  it('parses up to six decimals exactly', () => {
    expect(parseRateMicros('32.15')).toBe(BigInt(32_150_000));
    expect(parseRateMicros('0.2134')).toBe(BigInt(213_400));
    expect(parseRateMicros('0')).toBeNull();
    expect(parseRateMicros('1.1234567')).toBeNull();
    expect(parseRateMicros('-1')).toBeNull();
  });

  it('converts to NT$ cents with half-up rounding', () => {
    expect(convertToTwdCents(10_000 as Cents, BigInt(32_150_000))).toBe(321_500);
    // 123.45 JPY x 0.2134 = 26.34423 -> 26.34
    expect(convertToTwdCents(12_345 as Cents, BigInt(213_400))).toBe(2_634);
    // 0.05 x 0.5 = 0.025 -> 0.03
    expect(convertToTwdCents(5 as Cents, BigInt(500_000))).toBe(3);
  });
});

describe('parseTravelExpenseInput', () => {
  it('normalizes a valid form and totals the NT$ amounts', () => {
    const result = parseTravelExpenseInput(
      base({
        advanceAmount: '3000',
        costItems: [cost(), cost({ category: '住宿費', currency: 'USD', amount: '100', exchangeRate: '32.15', summary: '飯店' })],
      })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.advanceAmount).toBe(300_000);
    expect(result.value.costItems[0].exchangeRate).toBe('1');
    expect(result.value.costItems[1].twdAmount).toBe(321_500);
    expect(result.value.total).toBe(149_000 + 321_500);
  });

  it('forces the TWD rate to 1 whatever the client sent', () => {
    const result = parseTravelExpenseInput(base({ costItems: [cost({ exchangeRate: '5' })] }));
    expect(result.ok && result.value.costItems[0].twdAmount).toBe(149_000);
  });

  it('rejects implausible foreign exchange rates (the NT$ amount drives the approval chain)', () => {
    const usd = (exchangeRate: string) => cost({ currency: 'USD', amount: '5000', exchangeRate });
    expect(parseTravelExpenseInput(base({ costItems: [usd('1')] }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('匯率不在合理範圍'),
    });
    expect(parseTravelExpenseInput(base({ costItems: [usd('0.000001')] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [usd('500')] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [usd('20')] })).ok).toBe(true);
    expect(parseTravelExpenseInput(base({ costItems: [usd('50')] })).ok).toBe(true);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ currency: 'JPY', exchangeRate: '0.21' })] })).ok).toBe(true);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ currency: 'JPY', exchangeRate: '1' })] })).ok).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    const result = parseTravelExpenseInput(base({ tripStartDate: '2026-10-06', tripEndDate: '2026-10-05' }));
    expect(result).toEqual({ ok: false, error: '出差結束日不可早於起始日' });
  });

  it('rejects report rows outside the trip period', () => {
    const result = parseTravelExpenseInput(
      base({ reportItems: [{ tripDate: '2026-10-09', location: '高雄', itinerary: 'x', timeSlot: '全天' }] })
    );
    expect(result).toEqual({ ok: false, error: '出差報告第 1 列的日期不在出差期間內' });
  });

  it('requires companions (or 無) and at least one row in each table', () => {
    expect(parseTravelExpenseInput(base({ companions: ' ' })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ reportItems: [] }))).toEqual({ ok: false, error: '出差報告至少需要一列' });
    expect(parseTravelExpenseInput(base({ costItems: [] }))).toEqual({ ok: false, error: '出差旅費結算至少需要一列' });
  });

  it('rejects unknown categories, currencies, bad amounts and missing foreign rates', () => {
    expect(parseTravelExpenseInput(base({ costItems: [cost({ category: '娛樂費' })] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ currency: 'BTC' })] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ amount: '0' })] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ amount: '1.234' })] })).ok).toBe(false);
    expect(parseTravelExpenseInput(base({ costItems: [cost({ currency: 'JPY', exchangeRate: '' })] })).ok).toBe(false);
  });

  it('treats a 0 mileage as empty', () => {
    const result = parseTravelExpenseInput(base({ costItems: [cost({ mileage: '0' })] }));
    expect(result.ok && result.value.costItems[0].mileage).toBeNull();
  });
});
