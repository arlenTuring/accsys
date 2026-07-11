import { describe, expect, it } from 'vitest';
import { requiredQuoteCount, validateQuoteCount } from './quote-requirement';

describe('requiredQuoteCount', () => {
  it('requires 1 quote under 30000', () => {
    expect(requiredQuoteCount(29999)).toBe(1);
  });

  it('requires 2 quotes from 30000 to 99999', () => {
    expect(requiredQuoteCount(30000)).toBe(2);
    expect(requiredQuoteCount(99999)).toBe(2);
  });

  it('requires 3 quotes at 100000 and above', () => {
    expect(requiredQuoteCount(100000)).toBe(3);
    expect(requiredQuoteCount(500000)).toBe(3);
  });
});

describe('validateQuoteCount', () => {
  it('passes when quoteCount meets the requirement', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 2, reason: null })).toEqual({
      ok: true,
    });
  });

  it('passes when short of the requirement but a reason is given', () => {
    expect(
      validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: '僅一家廠商承作此類材料' })
    ).toEqual({ ok: true });
  });

  it('rejects when short of the requirement and no reason is given', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: null })).toEqual({
      ok: false,
      error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」',
    });
  });

  it('rejects when the reason is blank', () => {
    expect(validateQuoteCount({ totalAmount: 50000, quoteCount: 1, reason: '   ' })).toEqual({
      ok: false,
      error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」',
    });
  });
});
