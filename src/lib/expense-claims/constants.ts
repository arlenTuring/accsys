export const PAYEE_TYPES = ['applicant', 'supplier'] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];
export const PAYEE_TYPE_LABELS: Record<string, string> = { applicant: '申請人', supplier: '外部廠商' };

export const PAYMENT_METHODS = ['transfer', 'cash', 'check'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<string, string> = { transfer: '匯款', cash: '現金', check: '支票' };

export const NO_REMITTANCE = '無';
export const MAX_EXPENSE_CLAIM_LINES = 50;

const BUFFER_WORKDAYS = 5;

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 收件截止日: `workdays` Mon–Fri before the pay date (public holidays are not known here). */
export function filingDeadline(payDate: string, workdays = BUFFER_WORKDAYS): string {
  const d = utc(payDate);
  let left = workdays;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return iso(d);
}

function dayOfMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(year, month, Math.min(day, last))));
}

/**
 * Next pay day that still leaves the 5-workday filing window:
 * employees are paid on the 15th and 30th (month end in February), suppliers on the 25th of the next month.
 */
export function suggestPaymentDate(today: string, payee: PayeeType): string {
  const t = utc(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const candidates =
    payee === 'supplier'
      ? [1, 2].map((k) => dayOfMonth(y, m + k, 25))
      : [0, 1, 2].flatMap((k) => [dayOfMonth(y, m + k, 15), dayOfMonth(y, m + k, 30)]);
  return candidates.find((c) => filingDeadline(c) >= today) ?? candidates.at(-1)!;
}
