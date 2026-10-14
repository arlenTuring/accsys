import { convertToTwdCents, parseRateMicros, rateOutOfBounds } from '@/lib/exchange-rates';
import { addCents, MoneyError, toCents, type Cents } from '@/lib/money';
import {
  MAX_TRAVEL_LINES,
  TRAVEL_COST_CATEGORIES,
  TRAVEL_CURRENCIES,
  type TravelCostCategory,
  type TravelCurrency,
} from '@/lib/travel-expenses/constants';

// Shared by the form (live totals) and the server (authoritative values).

export type TravelReportItemInput = { tripDate: string; location: string; itinerary: string; timeSlot: string };
export type TravelCostItemInput = {
  expenseDate: string;
  category: string;
  fromStation: string;
  toStation: string;
  mileage: string;
  summary: string;
  currency: string;
  amount: string;
  exchangeRate: string;
};
export type TravelExpenseInput = {
  budgetCodeId: string;
  advanceAmount: string;
  tripStartDate: string;
  tripEndDate: string;
  purpose: string;
  tripOrderNo: string;
  companions: string;
  reportItems: TravelReportItemInput[];
  costItems: TravelCostItemInput[];
};

export type NormalizedCostItem = {
  expenseDate: string;
  category: TravelCostCategory;
  fromStation: string | null;
  toStation: string | null;
  mileage: string | null;
  summary: string;
  currency: TravelCurrency;
  amount: Cents;
  exchangeRate: string;
  twdAmount: Cents;
};
export type NormalizedTravelExpense = {
  budgetCodeId: string;
  advanceAmount: Cents;
  tripStartDate: string;
  tripEndDate: string;
  purpose: string;
  tripOrderNo: string;
  companions: string;
  reportItems: TravelReportItemInput[];
  costItems: NormalizedCostItem[];
  total: Cents;
};

export type ParseResult = { ok: true; value: NormalizedTravelExpense } | { ok: false; error: string };

export { convertToTwdCents, parseRateMicros, rateOutOfBounds };

const MILEAGE = /^\d{1,9}(?:\.\d)?$/;
const CURRENCY_CODES = new Set<string>(TRAVEL_CURRENCIES.map((c) => c.code));
const CATEGORIES = new Set<string>(TRAVEL_COST_CATEGORIES);

class Invalid extends Error {}
const invalid = (message: string): never => {
  throw new Invalid(message);
};

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (value !== undefined && value !== null && typeof value !== 'string') invalid(`${label}格式不正確`);
  const v = ((value as string | null | undefined) ?? '').trim();
  if (required && v === '') invalid(`請填寫${label}`);
  if (v.length > max) invalid(`${label}不可超過 ${max} 字`);
  return v;
}

function date(value: unknown, label: string): string {
  if (!isIsoDate(value)) invalid(`請填寫正確的${label}`);
  return value as string;
}

function money(value: unknown, label: string): Cents {
  try {
    return toCents(value);
  } catch (err) {
    return invalid(`${label}：${(err as MoneyError).message}`);
  }
}

function lines<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label}至少需要一列`);
  if ((value as unknown[]).length > MAX_TRAVEL_LINES) invalid(`${label}不可超過 ${MAX_TRAVEL_LINES} 列`);
  return value as T[];
}

function costItem(raw: TravelCostItemInput, n: number): NormalizedCostItem {
  const at = `旅費結算第 ${n} 列`;
  if (!raw || typeof raw !== 'object') invalid(`${at}格式不正確`);
  const category = raw.category;
  if (!CATEGORIES.has(category)) invalid(`${at}的類別不正確`);
  const currency = raw.currency;
  if (!CURRENCY_CODES.has(currency)) invalid(`${at}的幣別不正確`);

  const amount = money(typeof raw.amount === 'string' ? raw.amount.trim() : raw.amount, `${at}的金額`);
  if (amount <= 0) invalid(`${at}的金額必須大於 0`);

  const rateText = currency === 'TWD' ? '1' : typeof raw.exchangeRate === 'string' ? raw.exchangeRate.trim() : '';
  const rate = parseRateMicros(rateText);
  if (rate === null) invalid(`${at}的匯率必須是大於 0 的數字（最多 6 位小數）`);
  const outOfBounds = rateOutOfBounds(currency, rate!);
  if (outOfBounds) invalid(`${at}的${outOfBounds}`);
  let twdAmount: Cents;
  try {
    twdAmount = convertToTwdCents(amount, rate!);
  } catch {
    return invalid(`${at}換算後金額超出上限`);
  }
  if (twdAmount <= 0) invalid(`${at}換算新臺幣後金額必須大於 0`);

  const mileageText = text(raw.mileage, `${at}的里程`, 20, false);
  if (mileageText !== '' && mileageText !== '0' && !MILEAGE.test(mileageText)) {
    invalid(`${at}的里程格式不正確（最多一位小數）`);
  }

  return {
    expenseDate: date(raw.expenseDate, `${at}日期`),
    category: category as TravelCostCategory,
    fromStation: text(raw.fromStation, `${at}起站`, 100, false) || null,
    toStation: text(raw.toStation, `${at}迄站`, 100, false) || null,
    mileage: mileageText === '' || Number(mileageText) === 0 ? null : mileageText,
    summary: text(raw.summary, `${at}摘要`, 500),
    currency: currency as TravelCurrency,
    amount,
    exchangeRate: currency === 'TWD' ? '1' : rateText,
    twdAmount: twdAmount!,
  };
}

export function parseTravelExpenseInput(input: TravelExpenseInput): ParseResult {
  try {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    const tripStartDate = date(input.tripStartDate, '出差起始日');
    const tripEndDate = date(input.tripEndDate, '出差結束日');
    if (tripEndDate < tripStartDate) invalid('出差結束日不可早於起始日');

    const advanceText = typeof input.advanceAmount === 'string' ? input.advanceAmount.trim() : input.advanceAmount;
    const advanceAmount = advanceText === '' || advanceText == null ? (0 as Cents) : money(advanceText, '預支金額');
    if (advanceAmount < 0) invalid('預支金額不可為負數');

    const reportItems = lines<TravelReportItemInput>(input.reportItems, '出差報告').map((r, idx) => {
      const at = `出差報告第 ${idx + 1} 列`;
      if (!r || typeof r !== 'object') invalid(`${at}格式不正確`);
      const tripDate = date(r.tripDate, `${at}日期`);
      if (tripDate < tripStartDate || tripDate > tripEndDate) invalid(`${at}的日期不在出差期間內`);
      return {
        tripDate,
        location: text(r.location, `${at}出差地`, 200),
        itinerary: text(r.itinerary, `${at}行程說明`, 1000),
        timeSlot: text(r.timeSlot, `${at}出差時間區段`, 100),
      };
    });
    const costItems = lines<TravelCostItemInput>(input.costItems, '出差旅費結算').map((c, idx) => costItem(c, idx + 1));

    let total: Cents;
    try {
      total = addCents(...costItems.map((c) => c.twdAmount));
    } catch {
      return { ok: false, error: '合計金額超出上限' };
    }

    return {
      ok: true,
      value: {
        budgetCodeId: typeof input.budgetCodeId === 'string' ? input.budgetCodeId : '',
        advanceAmount,
        tripStartDate,
        tripEndDate,
        purpose: text(input.purpose, '出差事由', 1000),
        tripOrderNo: text(input.tripOrderNo, '本人核准之公出差旅單編號', 100),
        companions: text(input.companions, '同行者名字及核准之公出差旅單編號（沒有請填「無」）', 1000),
        reportItems,
        costItems,
        total,
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message };
    throw err;
  }
}
