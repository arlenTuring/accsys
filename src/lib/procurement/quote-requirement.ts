export type ValidationResult = { ok: true } | { ok: false; error: string };

export function requiredQuoteCount(totalAmount: number): number {
  if (totalAmount >= 100000) return 3;
  if (totalAmount >= 30000) return 2;
  return 1;
}

export function validateQuoteCount(input: {
  totalAmount: number;
  quoteCount: number;
  reason: string | null;
}): ValidationResult {
  const required = requiredQuoteCount(input.totalAmount);
  if (input.quoteCount >= required) {
    return { ok: true };
  }
  if (input.reason && input.reason.trim() !== '') {
    return { ok: true };
  }
  return { ok: false, error: '報價單家數未達門檻，需填寫「未檢附其他報價單原因」' };
}
