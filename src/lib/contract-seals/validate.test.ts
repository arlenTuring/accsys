import { describe, expect, it } from 'vitest';
import { addDays, parseContractSealInput, type ContractSealInput } from './validate';

const TODAY = '2026-10-13';

const contract: ContractSealInput = {
  applicantEmployeeId: '11111111-1111-1111-1111-111111111111',
  departmentId: '22222222-2222-2222-2222-222222222222',
  urgency: 'normal',
  expectedCompletionDate: '2026-10-16',
  remark: '無',
  documentType: 'contract',
  seals: ['contract_seal', 'perforation'],
  periodStart: '2026-11-01',
  periodEnd: '2027-10-31',
  totalAmount: '250000',
  counterparty: '宏達電',
  subject: '自駕車軟體授權',
  ndaChecks: ['not_applicable'],
  mouChecks: ['not_applicable'],
  legalReviewConfirmed: true,
  lendSeal: 'no',
  lendSealNote: '無',
};

const nda: ContractSealInput = {
  ...contract,
  documentType: 'nda',
  totalAmount: '0',
  ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'],
  legalReviewConfirmed: false,
};

const parse = (patch: Partial<ContractSealInput>, base = contract) => parseContractSealInput({ ...base, ...patch }, TODAY);
const errorOf = (patch: Partial<ContractSealInput>, base = contract) => {
  const r = parse(patch, base);
  return r.ok ? null : r.error;
};

describe('parseContractSealInput', () => {
  it('accepts a complete contract request and orders the seals as on the form', () => {
    const r = parse({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seals).toEqual(['perforation', 'contract_seal']);
    expect(r.value.totalAmount).toBe(25_000_000);
    expect(r.value.lendSeal).toBe(false);
    expect(r.value.legalReviewConfirmed).toBe(true);
  });

  it('accepts an NDA that meets all three items, without legal counsel', () => {
    const r = parse({}, nda);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.legalReviewConfirmed).toBe(false);
  });

  it('requires every NDA item for an NDA', () => {
    expect(errorOf({ ndaChecks: ['mutual', 'ip_retained'] }, nda)).toMatch(/須完全符合 3 項/);
    expect(errorOf({ ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed', 'not_applicable'] }, nda)).toMatch(
      /須完全符合/
    );
  });

  it('requires "非屬NDA" (and nothing else) when the document is not an NDA', () => {
    expect(errorOf({ ndaChecks: ['mutual'] })).toMatch(/非屬保密協議/);
    expect(errorOf({ ndaChecks: [] })).toMatch(/非屬保密協議/);
  });

  it('applies the same rule to MOU with two items', () => {
    const mou = { ...nda, documentType: 'mou', ndaChecks: ['not_applicable'], mouChecks: ['non_binding', 'amount_range'] };
    expect(parse({}, mou).ok).toBe(true);
    expect(errorOf({ mouChecks: ['non_binding'] }, mou)).toMatch(/須完全符合 2 項/);
    expect(errorOf({ mouChecks: ['non_binding'] })).toMatch(/非屬合作備忘錄/);
  });

  it('rejects unknown checklist codes', () => {
    expect(errorOf({ ndaChecks: ['mutual', 'evil'] }, nda)).toMatch(/不正確的選項/);
  });

  it('requires legal counsel confirmation for contracts, agreements and LOIs', () => {
    for (const documentType of ['contract', 'agreement', 'loi']) {
      expect(errorOf({ documentType, legalReviewConfirmed: false })).toMatch(/法律顧問/);
    }
  });

  it('needs at least one known seal', () => {
    expect(errorOf({ seals: [] })).toMatch(/至少勾選一種/);
    expect(errorOf({ seals: ['company_chop'] })).toMatch(/不正確/);
  });

  it('gives 一般件 at least two days and never accepts a past date', () => {
    expect(errorOf({ expectedCompletionDate: '2026-10-14' })).toMatch(/一般件需 2~3 天/);
    expect(parse({ expectedCompletionDate: addDays(TODAY, 2) }).ok).toBe(true);
    expect(errorOf({ expectedCompletionDate: '2026-10-12', urgency: 'urgent', remark: '客戶明早簽約' })).toMatch(
      /不可早於申請日期/
    );
  });

  it('makes 急件 explain the deadline and reason', () => {
    expect(errorOf({ urgency: 'urgent', expectedCompletionDate: TODAY, remark: '無' })).toMatch(/急件請在備註/);
    expect(parse({ urgency: 'urgent', expectedCompletionDate: TODAY, remark: '今日 17:00 前，客戶明早簽約' }).ok).toBe(true);
  });

  it('checks the contract period and total', () => {
    expect(errorOf({ periodEnd: '2026-10-01' })).toMatch(/結束日不可早於起始日/);
    expect(errorOf({ totalAmount: '-1' })).toMatch(/總價/);
    expect(errorOf({ totalAmount: 'abc' })).toMatch(/總價/);
    const blank = parse({ totalAmount: '' });
    expect(blank.ok && blank.value.totalAmount).toBe(0);
  });

  it('asks for a reason when a seal is lent out', () => {
    expect(errorOf({ lendSeal: 'yes', lendSealNote: '無' })).toMatch(/出借原因/);
    expect(parse({ lendSeal: 'yes', lendSealNote: '借合約章至客戶處用印，10/20 歸還' }).ok).toBe(true);
    expect(errorOf({ lendSeal: 'maybe' })).toMatch(/是否出借印鑑/);
  });

  it('requires the text fields', () => {
    expect(errorOf({ counterparty: '  ' })).toMatch(/客戶\/廠商名稱/);
    expect(errorOf({ subject: '' })).toMatch(/標的/);
    expect(errorOf({ remark: '' })).toMatch(/備註/);
  });
});
