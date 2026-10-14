import { describe, expect, it } from 'vitest';
import { filingDeadline, suggestPaymentDate } from './constants';
import { parseExpenseClaimInput, type ExpenseClaimInput } from './validate';

const TODAY = '2026-10-13';
const MATERIAL = '材料 (單筆新臺幣10,000元以下)';

const base = (patch: Partial<ExpenseClaimInput> = {}): ExpenseClaimInput => ({
  departmentId: 'd',
  budgetCodeId: 'b',
  items: [{ category: '職工福利', description: '10月部門聚餐', currency: 'TWD', exchangeRate: '', amount: '3200' }],
  remark: '',
  payeeType: 'applicant',
  payeeSupplierId: '',
  expectedPaymentDate: '2026-10-30',
  paymentMethod: 'transfer',
  remittanceInfo: '台灣銀行 林小明 012345678901',
  ...patch,
});
const parse = (patch: Partial<ExpenseClaimInput> = {}) => parseExpenseClaimInput('department', base(patch), TODAY);

describe('parseExpenseClaimInput', () => {
  it('normalizes a valid form and totals the NT$ subtotals', () => {
    const r = parse({
      items: [
        { category: '職工福利', description: '聚餐', currency: 'TWD', exchangeRate: '', amount: '3200' },
        { category: '訓練費', description: '線上課程', currency: 'USD', exchangeRate: '32.5', amount: '19.99' },
      ],
      remark: '  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items[0]).toMatchObject({ exchangeRate: '1', amount: 320000, twdAmount: 320000 });
    expect(r.value.items[1]).toMatchObject({ exchangeRate: '32.5', amount: 1999, twdAmount: 64968 });
    expect(r.value.total).toBe(384968);
    expect(r.value.remark).toBeNull();
    expect(r.value.payeeSupplierId).toBeNull();
  });

  it('rejects unknown categories, currencies and missing rates', () => {
    const row = base().items[0];
    expect(parse({ items: [{ ...row, category: '其他' }] })).toMatchObject({ ok: false, error: '請款內容第 1 列的項目不正確' });
    expect(parse({ items: [{ ...row, currency: 'XYZ' }] }).ok).toBe(false);
    expect(parse({ items: [{ ...row, currency: 'USD', exchangeRate: '' }] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('匯率'),
    });
    // A crafted request may send a number or object instead of text.
    for (const exchangeRate of [32.5, { x: 1 }, null]) {
      expect(parse({ items: [{ ...row, currency: 'USD', exchangeRate } as unknown as typeof row] })).toMatchObject({
        ok: false,
        error: expect.stringContaining('匯率'),
      });
    }
  });

  it('requires at least one line and a positive amount', () => {
    expect(parse({ items: [] })).toMatchObject({ ok: false, error: '請款內容至少需要一列' });
    expect(parse({ items: [{ ...base().items[0], amount: '0' }] }).ok).toBe(false);
  });

  it('requires a supplier when paying a supplier', () => {
    expect(parse({ payeeType: 'supplier' })).toMatchObject({ ok: false, error: '請選擇付款廠商' });
    const r = parse({ payeeType: 'supplier', payeeSupplierId: 's1' });
    expect(r.ok && r.value.payeeSupplierId).toBe('s1');
  });

  it('accepts 無 as remittance info only when not paying by transfer', () => {
    expect(parse({ remittanceInfo: '無' }).ok).toBe(false);
    expect(parse({ paymentMethod: 'cash', remittanceInfo: '無' }).ok).toBe(true);
    expect(parse({ paymentMethod: 'cash', remittanceInfo: '' }).ok).toBe(false);
  });

  it('rejects a payment date in the past', () => {
    expect(parse({ expectedPaymentDate: '2026-10-12' })).toMatchObject({ ok: false, error: '期望付款日不可早於今天' });
    expect(parse({ expectedPaymentDate: '2026-02-30' }).ok).toBe(false);
  });

  it('uses the 項目 list of the edition', () => {
    const row = { category: MATERIAL, description: '感測器支架', currency: 'TWD', exchangeRate: '', amount: '8000' };
    expect(parseExpenseClaimInput('project', base({ items: [row] }), TODAY).ok).toBe(true);
    expect(parseExpenseClaimInput('department', base({ items: [row] }), TODAY).ok).toBe(false);
    expect(parseExpenseClaimInput('project', base(), TODAY).ok).toBe(true);
  });

  it('caps 材料 at NT$10,000 per line, after conversion', () => {
    const row = { category: MATERIAL, description: '感測器', currency: 'TWD', exchangeRate: '', amount: '10000' };
    expect(parseExpenseClaimInput('project', base({ items: [row] }), TODAY).ok).toBe(true);
    expect(parseExpenseClaimInput('project', base({ items: [{ ...row, amount: '10000.01' }] }), TODAY)).toMatchObject({
      ok: false,
      error: expect.stringContaining('單筆不可超過新臺幣 10,000 元'),
    });
    const usd = { ...row, currency: 'USD', exchangeRate: '32', amount: '320' };
    expect(parseExpenseClaimInput('project', base({ items: [usd] }), TODAY).ok).toBe(false);
    // An implausible rate cannot shrink the NT$ amount under the cap.
    expect(parseExpenseClaimInput('project', base({ items: [{ ...usd, exchangeRate: '1' }] }), TODAY)).toMatchObject({
      ok: false,
      error: expect.stringContaining('匯率不在合理範圍'),
    });
  });

  it('caps 設備 at NT$10,000 per line in the 營收專案版 only', () => {
    const equipment = { category: '設備 (單筆新臺幣10,000元以下)', description: '展場螢幕', currency: 'TWD', exchangeRate: '', amount: '10000' };
    expect(parseExpenseClaimInput('revenue', base({ items: [equipment] }), TODAY).ok).toBe(true);
    expect(parseExpenseClaimInput('revenue', base({ items: [{ ...equipment, amount: '10001' }] }), TODAY)).toMatchObject({
      ok: false,
      error: expect.stringContaining('單筆不可超過新臺幣 10,000 元'),
    });
    expect(parseExpenseClaimInput('project', base({ items: [equipment] }), TODAY).ok).toBe(false);
    const material = { ...equipment, category: '材料', amount: '50000' };
    expect(parseExpenseClaimInput('revenue', base({ items: [material] }), TODAY).ok).toBe(true);
  });

  it('caps every line at NT$10,000 in the 部門版_單筆一萬元以下, while the total may exceed it', () => {
    const row = { category: '其他費用 (單筆新臺幣10,000元以下)', description: '展示架', currency: 'TWD', exchangeRate: '', amount: '10000' };
    const two = parseExpenseClaimInput('minor', base({ items: [row, { ...row, category: '設備 (單筆新臺幣10,000元以下)' }] }), TODAY);
    expect(two.ok && two.value.total).toBe(2_000_000);
    for (const category of ['其他費用 (單筆新臺幣10,000元以下)', '設備 (單筆新臺幣10,000元以下)']) {
      expect(parseExpenseClaimInput('minor', base({ items: [{ ...row, category, amount: '10000.01' }] }), TODAY)).toMatchObject({
        ok: false,
        error: expect.stringContaining('單筆不可超過新臺幣 10,000 元'),
      });
    }
    expect(parseExpenseClaimInput('minor', base(), TODAY)).toMatchObject({ ok: false, error: '請款內容第 1 列的項目不正確' });
  });
});

describe('payment dates', () => {
  it('puts the filing deadline 5 workdays before the pay date', () => {
    expect(filingDeadline('2026-10-30')).toBe('2026-10-23');
    expect(filingDeadline('2026-10-15')).toBe('2026-10-08');
  });

  it('suggests the next employee pay day (15th / 30th) that is still open for filing', () => {
    expect(suggestPaymentDate('2026-10-01', 'applicant')).toBe('2026-10-15');
    expect(suggestPaymentDate('2026-10-13', 'applicant')).toBe('2026-10-30');
    expect(suggestPaymentDate('2026-10-26', 'applicant')).toBe('2026-11-15');
    expect(suggestPaymentDate('2027-02-10', 'applicant')).toBe('2027-02-28');
  });

  it('suggests the 25th of next month for suppliers', () => {
    expect(suggestPaymentDate('2026-10-13', 'supplier')).toBe('2026-11-25');
    expect(suggestPaymentDate('2026-11-30', 'supplier')).toBe('2026-12-25');
  });
});
