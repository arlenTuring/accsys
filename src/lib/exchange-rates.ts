import { MAX_CENTS, MoneyError, type Cents } from '@/lib/money';

/** Amounts in other currencies are converted to this one (rate fixed at 1). */
export const BASE_CURRENCY = 'TWD';

/**
 * Plausible NT$ per unit, deliberately wide (about ±50% around 2024–2026
 * levels). The client types the rate and the NT$ amount decides the chairman
 * threshold and per-line caps, so an absurd rate (USD at 1) must not pass.
 * Adjust here if a currency moves outside its band.
 */
export const RATE_BOUNDS = {
  USD: { min: '20', max: '50' },
  JPY: { min: '0.1', max: '0.4' },
  EUR: { min: '22', max: '55' },
  CNY: { min: '3', max: '7' },
  HKD: { min: '2.5', max: '6.5' },
  KRW: { min: '0.012', max: '0.045' },
  SGD: { min: '15', max: '38' },
  GBP: { min: '27', max: '65' },
} as const satisfies Record<string, { min: string; max: string }>;

const RATE = /^(\d{1,6})(?:\.(\d{1,6}))?$/;
const MICROS = BigInt(1_000_000);

/** Exchange rate as an exact integer of millionths, or null when it is not a positive decimal with ≤ 6 places. */
export function parseRateMicros(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(RATE);
  if (!m) return null;
  const micros = BigInt(m[1]) * MICROS + BigInt((m[2] ?? '').padEnd(6, '0'));
  return micros > BigInt(0) ? micros : null;
}

/** Error message when a foreign rate is outside RATE_BOUNDS, or null when it is plausible (or the currency has no band). */
export function rateOutOfBounds(currency: string, rateMicros: bigint): string | null {
  const bounds = (RATE_BOUNDS as Record<string, { min: string; max: string }>)[currency];
  if (!bounds) return null;
  if (rateMicros >= parseRateMicros(bounds.min)! && rateMicros <= parseRateMicros(bounds.max)!) return null;
  return `匯率不在合理範圍（1 ${currency} 約新臺幣 ${bounds.min}–${bounds.max} 元），請確認是否填錯`;
}

/** NT$ cents = original cents × rate, rounded half up to the cent (exact integer arithmetic). */
export function convertToTwdCents(amount: Cents, rateMicros: bigint): Cents {
  const rounded = (BigInt(amount) * rateMicros + MICROS / BigInt(2)) / MICROS;
  if (rounded > BigInt(MAX_CENTS)) throw new MoneyError('金額超出上限');
  return Number(rounded) as Cents;
}
