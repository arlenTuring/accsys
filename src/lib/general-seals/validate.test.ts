import { describe, expect, it } from 'vitest';
import { parseGeneralSealInput, type GeneralSealInput } from './validate';

const TODAY = '2026-10-13';

const quotation: GeneralSealInput = {
  applicantEmployeeId: '11111111-1111-1111-1111-111111111111',
  departmentId: '22222222-2222-2222-2222-222222222222',
  urgency: 'normal',
  expectedCompletionDate: '2026-10-15',
  remark: '無',
  documentType: 'quotation',
  documentDescription: '宏達電 光達模組報價單 1 份（2 頁）',
  seals: ['invoice_seal', 'perforation'],
  lendSeal: 'no',
  lendSealNote: '無',
};

const parse = (patch: Partial<GeneralSealInput>) => parseGeneralSealInput({ ...quotation, ...patch }, TODAY);
const errorOf = (patch: Partial<GeneralSealInput>) => {
  const r = parse(patch);
  return r.ok ? null : r.error;
};

describe('parseGeneralSealInput', () => {
  it('accepts a complete quotation and orders the seals as on the form', () => {
    const r = parse({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seals).toEqual(['perforation', 'invoice_seal']);
    expect(r.value.lendSeal).toBe(false);
  });

  it('accepts the customs seal, which the contract form does not offer', () => {
    expect(parse({ documentType: 'customs', seals: ['customs_seal'] }).ok).toBe(true);
  });

  it('requires a known document type and a description', () => {
    expect(errorOf({ documentType: 'contract' })).toMatch(/文件類別/);
    expect(errorOf({ documentDescription: '  ' })).toMatch(/文件說明/);
    expect(errorOf({ documentDescription: 'x'.repeat(1001) })).toMatch(/不可超過 1000 字/);
  });

  it('needs at least one known seal', () => {
    expect(errorOf({ seals: [] })).toMatch(/至少勾選一種/);
    expect(errorOf({ seals: ['company_chop'] })).toMatch(/不正確/);
  });

  it('shares the timing rules with the contract form', () => {
    expect(errorOf({ expectedCompletionDate: '2026-10-14' })).toMatch(/一般件需 2~3 天/);
    expect(errorOf({ urgency: 'urgent', expectedCompletionDate: TODAY, remark: '無' })).toMatch(/急件請在備註/);
    expect(parse({ urgency: 'urgent', expectedCompletionDate: TODAY, remark: '今日 15:00 前，銀行收件截止' }).ok).toBe(true);
  });

  it('shares the lending rules with the contract form', () => {
    expect(errorOf({ lendSeal: 'yes', lendSealNote: '無' })).toMatch(/出借原因/);
    expect(parse({ lendSeal: 'yes', lendSealNote: '借銀行印鑑章至銀行辦理，當日歸還' }).ok).toBe(true);
  });
});
