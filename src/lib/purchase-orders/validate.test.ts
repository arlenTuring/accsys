import { describe, expect, it } from 'vitest';
import { validatePurchaseOrderInput } from './validate';

describe('validatePurchaseOrderInput', () => {
  it('accepts valid items meeting the quote-count requirement', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 32500 }, { unitPrice: 32500 }],
        totalAmount: 65000,
        quoteCount: 2,
        quoteCountReason: null,
      })
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    expect(
      validatePurchaseOrderInput({ items: [], totalAmount: 0, quoteCount: 1, quoteCountReason: null })
    ).toEqual({ ok: false, error: '採購單至少需要一個明細項次' });
  });

  it('rejects a non-positive unit price', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 0 }],
        totalAmount: 0,
        quoteCount: 1,
        quoteCountReason: null,
      })
    ).toEqual({ ok: false, error: '第 1 項的單價必須大於 0' });
  });

  it('rejects short quote count without a reason', () => {
    expect(
      validatePurchaseOrderInput({
        items: [{ unitPrice: 65000 }],
        totalAmount: 65000,
        quoteCount: 1,
        quoteCountReason: null,
      })
    ).toEqual({ ok: false, error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」' });
  });
});
