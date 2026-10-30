import { describe, expect, it } from 'vitest';
import { extractInvoiceFromText } from './invoice-check';

describe('extractInvoiceFromText', () => {
  it('extracts buyer and seller without confusing them', () => {
    const r = extractInvoiceFromText('測試文件／不得報帳\n買方統編: 04595257\n賣方統編: 10458574');
    expect(r.buyerTaxId).toBe('04595257');
    expect(r.sellerTaxId).toBe('10458574');
    expect(r.documentKind).toBe('invoice');
  });

  it('does not invent buyer from seller-only docs', () => {
    const r = extractInvoiceFromText('SELLER_ONLY\n賣方統編: 10458574');
    expect(r.buyerTaxId).toBeNull();
    expect(r.sellerTaxId).toBe('10458574');
  });

  it('marks receipts', () => {
    const r = extractInvoiceFromText('RECEIPT 收據 NO_BUYER');
    expect(r.documentKind).toBe('receipt');
    expect(r.buyerTaxId).toBeNull();
  });
});
