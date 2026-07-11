import { describe, expect, it } from 'vitest';
import { checkPaymentTermsConsistency, PAYMENT_TERMS_DAYS } from './payment-terms';

describe('PAYMENT_TERMS_DAYS', () => {
  it('maps known payment terms to day counts and 其他 to null', () => {
    expect(PAYMENT_TERMS_DAYS['月結30天']).toBe(30);
    expect(PAYMENT_TERMS_DAYS['貨到付款']).toBe(0);
    expect(PAYMENT_TERMS_DAYS['其他']).toBeNull();
  });
});

describe('checkPaymentTermsConsistency', () => {
  it('is consistent when no expected payment date is given yet', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: null,
      })
    ).toEqual({ consistent: true, suggestedDate: '2026-07-31' });
  });

  it('is consistent when the expected date matches the suggested date', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-07-31',
      }).consistent
    ).toBe(true);
  });

  it('is inconsistent when the expected date is far from the suggested date', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '月結30天',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-09-01',
      }).consistent
    ).toBe(false);
  });

  it('is always consistent for 其他 (no known day count to compare)', () => {
    expect(
      checkPaymentTermsConsistency({
        paymentTerms: '其他',
        orderApprovedDate: '2026-07-01',
        expectedPaymentDate: '2026-09-01',
      })
    ).toEqual({ consistent: true, suggestedDate: null });
  });
});
