import { describe, expect, it } from 'vitest';
import { parseFormSchema } from '@/lib/custom-forms/schema';
import { BUSINESS_TRIP_FORM } from '@/lib/custom-forms/migrated/business-trip';
import { dateRange, factsFromData, factsLine } from './form-facts';

const schema = parseFormSchema(BUSINESS_TRIP_FORM.schema);

describe('factsFromData', () => {
  it('reads the fields that identify a business trip', () => {
    if (!schema.ok) throw new Error('schema');
    const f = factsFromData('business-trip', schema.schema, {
      purpose: '客戶訪談',
      location: '台中',
      tripStartAt: '2026-11-12T09:00',
      tripEndAt: '2026-11-12T18:00',
    });
    expect(f).toEqual({ what: '客戶訪談', where: '台中', when: '2026-11-12 09:00 ～ 2026-11-12 18:00' });
  });

  it('leaves out what is not there instead of guessing', () => {
    if (!schema.ok) throw new Error('schema');
    expect(factsFromData('business-trip', schema.schema, {})).toEqual({ what: null, where: null, when: null });
    expect(factsLine({ what: null, where: null, when: null, amount: null })).toBe('');
  });
});

describe('dateRange', () => {
  it('shows one date once', () => {
    expect(dateRange(['2026-10-14', '2026-10-14'])).toBe('2026-10-14');
    expect(dateRange(['2026-10-14', null])).toBe('2026-10-14');
    expect(dateRange([null])).toBeNull();
  });
});

describe('factsLine', () => {
  it('keeps the amount exact', () => {
    expect(factsLine({ what: '高鐵', where: null, when: '2026-10-14', amount: 1234567.5 })).toBe('高鐵 · 2026-10-14 · NT$ 1,234,567.5');
  });
});
