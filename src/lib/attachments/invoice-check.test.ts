import { describe, expect, it, vi } from 'vitest';
import { extractInvoiceFromText, runInvoiceCheckOnBytes } from './invoice-check';

vi.mock('@/lib/company/service', () => ({ getActiveCompanyProfile: async () => null }));

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

describe('runInvoiceCheckOnBytes', () => {
  it('does not send an Office file to the model, and says so', async () => {
    const vision = await import('@/lib/attachments/invoice-vision');
    const spy = vi.spyOn(vision, 'extractInvoiceWithVision');
    const r = await runInvoiceCheckOnBytes({
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(spy).not.toHaveBeenCalled();
    expect(r.overallStatus).toBe('analysis_failed');
    expect(r.summary).toContain('PDF 或照片');
  });
});
