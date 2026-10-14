import { RATE_BOUNDS as SHARED_RATE_BOUNDS } from '@/lib/exchange-rates';

export const TRAVEL_COST_CATEGORIES = ['交通費', '住宿費', '膳雜費', '其他'] as const;
export type TravelCostCategory = (typeof TRAVEL_COST_CATEGORIES)[number];

export const TRAVEL_CURRENCIES = [
  { code: 'TWD', label: '新臺幣' },
  { code: 'USD', label: '美元' },
  { code: 'JPY', label: '日圓' },
  { code: 'EUR', label: '歐元' },
  { code: 'CNY', label: '人民幣' },
  { code: 'HKD', label: '港幣' },
  { code: 'KRW', label: '韓元' },
  { code: 'SGD', label: '新加坡幣' },
  { code: 'GBP', label: '英鎊' },
] as const;
export type TravelCurrency = (typeof TRAVEL_CURRENCIES)[number]['code'];

export const RATE_BOUNDS: Record<Exclude<TravelCurrency, 'TWD'>, { min: string; max: string }> = SHARED_RATE_BOUNDS;

export const CURRENCY_LABELS: Record<string, string> = Object.fromEntries(
  TRAVEL_CURRENCIES.map((c) => [c.code, c.label])
);

export const MAX_TRAVEL_LINES = 50;
