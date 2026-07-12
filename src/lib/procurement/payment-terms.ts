export const PAYMENT_TERMS_DAYS: Record<string, number | null> = {
  預付款: 0,
  貨到付款: 0,
  月結30天: 30,
  月結45天: 45,
  月結60天: 60,
  其他: null,
};

const CONSISTENCY_TOLERANCE_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffInDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(da - db) / MS_PER_DAY;
}

export function checkPaymentTermsConsistency(input: {
  paymentTerms: string;
  orderApprovedDate: string;
  expectedPaymentDate: string | null;
}): { consistent: boolean; suggestedDate: string | null } {
  const days = PAYMENT_TERMS_DAYS[input.paymentTerms];
  if (days === null || days === undefined) {
    return { consistent: true, suggestedDate: null };
  }
  const suggestedDate = addDays(input.orderApprovedDate, days);
  if (input.expectedPaymentDate === null) {
    return { consistent: true, suggestedDate };
  }
  const consistent = diffInDays(suggestedDate, input.expectedPaymentDate) <= CONSISTENCY_TOLERANCE_DAYS;
  return { consistent, suggestedDate };
}
