import { describe, expect, it } from 'vitest';
import { lineAmount, parseInvoiceSealInput, type InvoiceSealInput } from './validate';

const domestic: InvoiceSealInput = {
  applicantEmployeeId: '11111111-1111-1111-1111-111111111111',
  departmentId: '22222222-2222-2222-2222-222222222222',
  invoiceType: 'triplicate',
  seal: 'invoice_seal',
  customerName: '宏達國際電子股份有限公司',
  customerTaxId: '04541302',
  customerAddress: '桃園市桃園區興華路 23 號',
  customerPhone: '03-375-3252',
  items: [
    { itemName: '光達模組 LX-200', quantity: '2', currency: 'TWD', unitPrice: '45,000' },
    { itemName: '安裝調校服務', quantity: '1', currency: 'TWD', unitPrice: '10000.50' },
  ],
  totalAmount: '105000.53',
};

const parse = (patch: Partial<InvoiceSealInput>) => parseInvoiceSealInput({ ...domestic, ...patch });
const errorOf = (patch: Partial<InvoiceSealInput>) => {
  const r = parse(patch);
  return r.ok ? null : r.error;
};

describe('parseInvoiceSealInput', () => {
  it('accepts a triplicate invoice and computes the line and untaxed totals in cents', () => {
    const r = parse({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((it) => it.amount)).toEqual([9_000_000, 1_000_050]);
    expect(r.value.untaxedTotal).toBe(10_000_050);
    expect(r.value.totalAmount).toBe(10_500_053);
    expect(r.value.currency).toBe('TWD');
  });

  it('needs a real tax ID for triplicate invoices, "0" for individuals and foreign customers', () => {
    expect(errorOf({ customerTaxId: '0' })).toMatch(/三聯式發票需填寫客戶的 8 位數統編/);
    expect(errorOf({ customerTaxId: '1234567' })).toMatch(/8 位數字/);
    expect(parse({ invoiceType: 'duplicate', customerTaxId: '0' }).ok).toBe(true);
  });

  it('accepts a foreign-currency export invoice without tax', () => {
    const items = [{ itemName: 'LiDAR module LX-200', quantity: '10', currency: 'USD', unitPrice: '1450' }];
    const r = parse({ invoiceType: 'export_invoice', customerTaxId: '0', items, totalAmount: '14500' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.currency).toBe('USD');
  });

  it('keeps one currency per invoice', () => {
    const items = [...domestic.items, { itemName: '運費', quantity: '1', currency: 'USD', unitPrice: '50' }];
    expect(errorOf({ items })).toMatch(/幣別需一致/);
  });

  it('checks every line', () => {
    const line = domestic.items[0];
    expect(errorOf({ items: [] })).toMatch(/至少填寫一筆/);
    expect(errorOf({ items: [{ ...line, itemName: ' ' }] })).toMatch(/第 1 筆品名/);
    expect(errorOf({ items: [{ ...line, quantity: '1.5' }] })).toMatch(/第 1 筆數量請填正整數/);
    expect(errorOf({ items: [{ ...line, quantity: '0' }] })).toMatch(/正整數/);
    expect(errorOf({ items: [{ ...line, unitPrice: '0' }] })).toMatch(/未稅單價需大於 0/);
    expect(errorOf({ items: [{ ...line, unitPrice: '1.234' }] })).toMatch(/兩位小數/);
    expect(errorOf({ items: [{ ...line, currency: 'BTC' }] })).toMatch(/幣別/);
  });

  it('does not allow a tax-included total below the untaxed total', () => {
    expect(errorOf({ totalAmount: '100000' })).toMatch(/含稅總計不可小於未稅金額合計/);
    expect(errorOf({ totalAmount: '' })).toMatch(/含稅總計/);
  });

  it('requires the customer details and a known invoice type and seal', () => {
    expect(errorOf({ customerName: '' })).toMatch(/客戶名稱/);
    expect(errorOf({ customerAddress: '' })).toMatch(/客戶地址/);
    expect(errorOf({ customerPhone: '' })).toMatch(/客戶電話/);
    expect(errorOf({ invoiceType: 'receipt' })).toMatch(/發票形式/);
    expect(errorOf({ seal: 'bank_seal' })).toMatch(/印鑑名稱/);
  });
});

describe('lineAmount', () => {
  it('is null until quantity and unit price are both valid', () => {
    expect(lineAmount({ quantity: '3', unitPrice: '19.99' })).toBe(5997);
    expect(lineAmount({ quantity: '', unitPrice: '100' })).toBeNull();
    expect(lineAmount({ quantity: '2', unitPrice: 'abc' })).toBeNull();
  });
});
