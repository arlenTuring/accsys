import {
  MAX_EXPENSE_CLAIM_LINES,
  NO_REMITTANCE,
  PAYEE_TYPES,
  PAYMENT_METHODS,
  type PayeeType,
  type PaymentMethod,
} from '@/lib/expense-claims/constants';
import { EDITIONS, type ExpenseEdition } from '@/lib/expense-claims/editions';
import { addCents, centsToNumber, MoneyError, toCents, type Cents } from '@/lib/money';
import { TRAVEL_CURRENCIES, type TravelCurrency } from '@/lib/travel-expenses/constants';
import { convertToTwdCents, isIsoDate, parseRateMicros, rateOutOfBounds } from '@/lib/travel-expenses/validate';

// Shared by the form (live totals) and the server (authoritative values).

export type ExpenseClaimItemInput = {
  category: string;
  description: string;
  currency: string;
  exchangeRate: string;
  amount: string;
};
export type ExpenseClaimInput = {
  departmentId: string;
  budgetCodeId: string;
  items: ExpenseClaimItemInput[];
  remark: string;
  payeeType: string;
  payeeSupplierId: string;
  expectedPaymentDate: string;
  paymentMethod: string;
  remittanceInfo: string;
};

export type NormalizedExpenseClaimItem = {
  category: string;
  description: string;
  currency: TravelCurrency;
  exchangeRate: string;
  amount: Cents;
  twdAmount: Cents;
};
export type NormalizedExpenseClaim = {
  departmentId: string;
  budgetCodeId: string;
  items: NormalizedExpenseClaimItem[];
  remark: string | null;
  payeeType: PayeeType;
  payeeSupplierId: string | null;
  expectedPaymentDate: string;
  paymentMethod: PaymentMethod;
  remittanceInfo: string;
  total: Cents;
};

export type ParseResult = { ok: true; value: NormalizedExpenseClaim } | { ok: false; error: string };

const CURRENCY_CODES = new Set<string>(TRAVEL_CURRENCIES.map((c) => c.code));

class Invalid extends Error {}
const invalid = (message: string): never => {
  throw new Invalid(message);
};

function text(value: unknown, label: string, max: number, required = true): string {
  if (value !== undefined && value !== null && typeof value !== 'string') invalid(`${label}格式不正確`);
  const v = ((value as string | null | undefined) ?? '').trim();
  if (required && v === '') invalid(`請填寫${label}`);
  if (v.length > max) invalid(`${label}不可超過 ${max} 字`);
  return v;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) invalid(message);
  return value as T;
}

/** NT$ for one row, or null while the row is incomplete (used for the live 小計). */
export function rowTwdCents(row: Pick<ExpenseClaimItemInput, 'currency' | 'exchangeRate' | 'amount'>): Cents | null {
  let amount: Cents;
  try {
    amount = toCents(typeof row.amount === 'string' ? row.amount.trim() : row.amount);
  } catch {
    return null;
  }
  if (amount <= 0) return null;
  const rate = parseRateMicros(row.currency === 'TWD' ? '1' : row.exchangeRate);
  if (rate === null) return null;
  try {
    return convertToTwdCents(amount, rate);
  } catch {
    return null;
  }
}

function item(edition: ExpenseEdition, raw: ExpenseClaimItemInput, n: number): NormalizedExpenseClaimItem {
  const { categories, categoryMaxCents } = EDITIONS[edition];
  const at = `請款內容第 ${n} 列`;
  if (!raw || typeof raw !== 'object') invalid(`${at}格式不正確`);
  if (!categories.includes(raw.category)) invalid(`${at}的項目不正確`);
  if (!CURRENCY_CODES.has(raw.currency)) invalid(`${at}的幣別不正確`);

  let amount: Cents;
  try {
    amount = toCents(typeof raw.amount === 'string' ? raw.amount.trim() : raw.amount);
  } catch (err) {
    return invalid(`${at}的金額：${(err as MoneyError).message}`);
  }
  if (amount <= 0) invalid(`${at}的金額必須大於 0`);

  const rateText = raw.currency === 'TWD' ? '1' : typeof raw.exchangeRate === 'string' ? raw.exchangeRate.trim() : '';
  const rate = parseRateMicros(rateText);
  if (rate === null) invalid(`${at}的匯率必須是大於 0 的數字（最多 6 位小數）`);
  const outOfBounds = rateOutOfBounds(raw.currency, rate!);
  if (outOfBounds) invalid(`${at}的${outOfBounds}`);
  let twdAmount: Cents;
  try {
    twdAmount = convertToTwdCents(amount, rate!);
  } catch {
    return invalid(`${at}換算後金額超出上限`);
  }
  if (twdAmount <= 0) invalid(`${at}換算新臺幣後金額必須大於 0`);
  const max = categoryMaxCents[raw.category];
  if (max !== undefined && twdAmount > max) {
    invalid(`${at}的「${raw.category}」單筆不可超過新臺幣 ${centsToNumber(max as Cents).toLocaleString()} 元，超過請走請購流程`);
  }

  return {
    category: raw.category,
    description: text(raw.description, `${at}的內容或說明`, 500),
    currency: raw.currency as TravelCurrency,
    exchangeRate: rateText,
    amount,
    twdAmount,
  };
}

/** `today` (Asia/Taipei) bounds the expected payment date. */
export function parseExpenseClaimInput(edition: ExpenseEdition, input: ExpenseClaimInput, today: string): ParseResult {
  try {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    if (!Array.isArray(input.items) || input.items.length === 0) invalid('請款內容至少需要一列');
    if (input.items.length > MAX_EXPENSE_CLAIM_LINES) invalid(`請款內容不可超過 ${MAX_EXPENSE_CLAIM_LINES} 列`);
    const items = input.items.map((r, idx) => item(edition, r, idx + 1));

    let total: Cents;
    try {
      total = addCents(...items.map((i) => i.twdAmount));
    } catch {
      return { ok: false, error: '總金額超出上限' };
    }

    const payeeType = oneOf(input.payeeType, PAYEE_TYPES, '請選擇付款對象');
    const payeeSupplierId = payeeType === 'supplier' ? text(input.payeeSupplierId, '付款廠商', 100, false) : null;
    if (payeeType === 'supplier' && !payeeSupplierId) invalid('請選擇付款廠商');

    if (!isIsoDate(input.expectedPaymentDate)) invalid('請填寫正確的期望付款日');
    if (input.expectedPaymentDate < today) invalid('期望付款日不可早於今天');

    const paymentMethod = oneOf(input.paymentMethod, PAYMENT_METHODS, '請選擇付款方式');
    const remittanceInfo = text(input.remittanceInfo, '匯款資訊', 500);
    if (paymentMethod === 'transfer' && remittanceInfo === NO_REMITTANCE) {
      invalid('付款方式為匯款時，請填入「銀行名稱+銀行戶名+銀行帳號」');
    }

    return {
      ok: true,
      value: {
        departmentId: typeof input.departmentId === 'string' ? input.departmentId : '',
        budgetCodeId: typeof input.budgetCodeId === 'string' ? input.budgetCodeId : '',
        items,
        remark: text(input.remark, '備註', 1000, false) || null,
        payeeType,
        payeeSupplierId,
        expectedPaymentDate: input.expectedPaymentDate,
        paymentMethod,
        remittanceInfo,
        total,
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}
