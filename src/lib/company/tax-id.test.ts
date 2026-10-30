import { describe, expect, it } from 'vitest';
import { compareBuyerTaxId, isValidTaiwanTaxId, normalizeTaxId } from './tax-id';

describe('isValidTaiwanTaxId', () => {
  it('accepts known-valid checksum examples', () => {
    // Commonly cited valid numbers (checksum only — not existence proof).
    expect(isValidTaiwanTaxId('04595257')).toBe(true);
    expect(isValidTaiwanTaxId('10458574')).toBe(true);
  });

  it('rejects wrong length and bad checksum', () => {
    expect(isValidTaiwanTaxId('123')).toBe(false);
    expect(isValidTaiwanTaxId('12345678')).toBe(false);
    expect(isValidTaiwanTaxId('abcdefgh')).toBe(false);
  });

  it('normalizes non-digits', () => {
    expect(normalizeTaxId('0459-5257')).toBe('04595257');
  });
});

describe('compareBuyerTaxId', () => {
  it('never treats missing company as match', () => {
    const r = compareBuyerTaxId({
      companyTaxId: null,
      companyConfigured: false,
      extractedBuyerTaxId: '04595257',
      confidence: 'high',
      documentKind: 'invoice',
      analysisOk: true,
      analysisDone: true,
    });
    expect(r.status).toBe('company_unset');
  });

  it('distinguishes mismatch from not_found', () => {
    expect(
      compareBuyerTaxId({
        companyTaxId: '04595257',
        companyConfigured: true,
        extractedBuyerTaxId: '10458574',
        confidence: 'high',
        documentKind: 'invoice',
        analysisOk: true,
        analysisDone: true,
      }).status
    ).toBe('mismatch');
    expect(
      compareBuyerTaxId({
        companyTaxId: '04595257',
        companyConfigured: true,
        extractedBuyerTaxId: null,
        confidence: 'medium',
        documentKind: 'invoice',
        analysisOk: true,
        analysisDone: true,
      }).status
    ).toBe('not_found');
  });

  it('marks non-invoice separately', () => {
    expect(
      compareBuyerTaxId({
        companyTaxId: '04595257',
        companyConfigured: true,
        extractedBuyerTaxId: null,
        confidence: 'high',
        documentKind: 'other',
        analysisOk: true,
        analysisDone: true,
      }).status
    ).toBe('not_invoice');
  });
});
