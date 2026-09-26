/**
 * Money is handled as integer cents in code and as numeric(14,2) strings at
 * the database boundary. No floating-point sums; client totals are never
 * trusted.
 */

export type Cents = number & { readonly __brand: 'cents' };

/** numeric(14,2): at most 12 integer digits. */
export const MAX_CENTS = 99_999_999_999_999 as Cents;

export class MoneyError extends Error {}

/** Parses a user/DB amount (number or decimal string) into cents; rejects >2 decimals, NaN, overflow. */
export function toCents(value: unknown): Cents {
  let cents: number;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(-?)(\d{1,12})(?:\.(\d{1,2}))?$/);
    if (!m) throw new MoneyError('金額格式不正確（最多兩位小數）');
    cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
    if (m[1] === '-') cents = -cents;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const scaled = value * 100;
    cents = Math.round(scaled);
    if (Math.abs(scaled - cents) > 1e-6) throw new MoneyError('金額最多兩位小數');
  } else {
    throw new MoneyError('金額格式不正確');
  }
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS) throw new MoneyError('金額超出上限');
  return cents as Cents;
}

export function addCents(...values: Cents[]): Cents {
  const total = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total) || Math.abs(total) > MAX_CENTS) throw new MoneyError('金額超出上限');
  return total as Cents;
}

export function multiplyCents(unit: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new MoneyError('數量必須為正整數');
  const total = unit * quantity;
  if (!Number.isSafeInteger(total) || total > MAX_CENTS) throw new MoneyError('金額超出上限');
  return total as Cents;
}

/** numeric literal for PostgreSQL, e.g. 123456 -> "1234.56". */
export function centsToDecimal(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** For display and existing number-typed DTOs (exact for 2-decimal values). */
export function centsToNumber(cents: Cents): number {
  return cents / 100;
}
