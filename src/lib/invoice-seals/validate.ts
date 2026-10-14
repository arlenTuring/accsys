import {
  INVOICE_CURRENCIES,
  INVOICE_SEALS,
  INVOICE_TYPES,
  MAX_INVOICE_LINES,
  type InvoiceCurrency,
  type InvoiceSeal,
  type InvoiceType,
} from '@/lib/invoice-seals/constants';
import { addCents, MoneyError, multiplyCents, toCents, type Cents } from '@/lib/money';
import { collect, invalid, oneOf, text, uuidOrBlank } from '@/lib/seal-requests/validate';

// Shared by the form (instant feedback) and the server (authoritative check).

export type InvoiceItemInput = { itemName: string; quantity: string; currency: string; unitPrice: string };

export type InvoiceSealInput = {
  applicantEmployeeId: string;
  departmentId: string;
  invoiceType: string;
  seal: string;
  customerName: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  items: InvoiceItemInput[];
  totalAmount: string;
};

export type NormalizedInvoiceItem = {
  itemName: string;
  quantity: number;
  currency: InvoiceCurrency;
  unitPrice: Cents;
  amount: Cents;
};

export type NormalizedInvoiceSeal = {
  applicantEmployeeId: string;
  departmentId: string;
  invoiceType: InvoiceType;
  seal: InvoiceSeal;
  customerName: string;
  customerTaxId: string;
  customerAddress: string;
  customerPhone: string;
  currency: InvoiceCurrency;
  items: NormalizedInvoiceItem[];
  untaxedTotal: Cents;
  totalAmount: Cents;
};

export type ParseResult = { ok: true; value: NormalizedInvoiceSeal } | { ok: false; error: string };

/** Turns a MoneyError (bad format, overflow) into a form error naming the field. */
function money<T>(label: string, compute: () => T): T {
  try {
    return compute();
  } catch (err) {
    if (err instanceof MoneyError) invalid(`${label}：${err.message}`);
    throw err;
  }
}

const cents = (value: unknown, label: string): Cents =>
  money(label, () => toCents(typeof value === 'string' ? value.replaceAll(',', '') : value));

/** 數量 is a whole number of units. */
function quantity(value: unknown, label: string): number {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,9}$/.test(v) || Number(v) <= 0) invalid(`${label}數量請填正整數`);
  return Number(v);
}

/** 未稅金額 shown in the table while typing; null until the row is complete. */
export function lineAmount(item: Pick<InvoiceItemInput, 'quantity' | 'unitPrice'>): Cents | null {
  const parsed = collect(() => multiplyCents(cents(item.unitPrice, '未稅單價'), quantity(item.quantity, '')));
  return parsed.ok ? parsed.value : null;
}

function parseItems(value: unknown): NormalizedInvoiceItem[] {
  if (!Array.isArray(value) || value.length === 0) invalid('請至少填寫一筆開立資訊');
  const rows = value as unknown[];
  if (rows.length > MAX_INVOICE_LINES) invalid(`開立資訊最多 ${MAX_INVOICE_LINES} 筆`);
  return rows.map((row, i) => {
    const label = `第 ${i + 1} 筆`;
    if (!row || typeof row !== 'object') invalid(`${label}開立資訊格式不正確`);
    const r = row as Record<string, unknown>;
    const itemName = text(r.itemName, `${label}品名`, 200);
    const qty = quantity(r.quantity, label);
    const currency = oneOf(r.currency, INVOICE_CURRENCIES, `請選擇${label}的幣別`);
    const unitPrice = cents(r.unitPrice, `${label}未稅單價`);
    if (unitPrice <= 0) invalid(`${label}未稅單價需大於 0`);
    const amount = money(`${label}未稅金額`, () => multiplyCents(unitPrice, qty));
    return { itemName, quantity: qty, currency, unitPrice, amount };
  });
}

export function parseInvoiceSealInput(input: InvoiceSealInput): ParseResult {
  return collect(() => {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    const invoiceType = oneOf(input.invoiceType, INVOICE_TYPES, '請選擇發票形式');
    const seal = oneOf(input.seal, INVOICE_SEALS, '請選擇印鑑名稱');
    const customerName = text(input.customerName, '客戶名稱', 200);
    const customerTaxId = text(input.customerTaxId, '客戶統編（個人或國外客戶請填 0）', 8);
    if (customerTaxId !== '0' && !/^\d{8}$/.test(customerTaxId)) invalid('客戶統編為 8 位數字；個人或國外客戶請填 0');
    if (invoiceType === 'triplicate' && customerTaxId === '0') invalid('三聯式發票需填寫客戶的 8 位數統編');
    const customerAddress = text(input.customerAddress, '客戶地址', 300);
    const customerPhone = text(input.customerPhone, '客戶電話', 50);

    const items = parseItems(input.items);
    const currency = items[0].currency;
    if (items.some((it) => it.currency !== currency)) invalid('同一張發票的品項幣別需一致');
    const untaxedTotal = money('未稅金額合計', () => addCents(...items.map((it) => it.amount)));
    const totalAmount = cents(input.totalAmount, '含稅總計');
    if (totalAmount < untaxedTotal) invalid('含稅總計不可小於未稅金額合計');

    return {
      applicantEmployeeId: uuidOrBlank(input.applicantEmployeeId),
      departmentId: uuidOrBlank(input.departmentId),
      invoiceType,
      seal,
      customerName,
      customerTaxId,
      customerAddress,
      customerPhone,
      currency,
      items,
      untaxedTotal,
      totalAmount,
    };
  });
}
