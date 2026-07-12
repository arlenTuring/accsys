import { validateQuoteCount, type ValidationResult } from '@/lib/procurement/quote-requirement';

export type { ValidationResult };

export function validatePurchaseOrderInput(input: {
  items: { unitPrice: number }[];
  totalAmount: number;
  quoteCount: number;
  quoteCountReason: string | null;
}): ValidationResult {
  if (input.items.length === 0) {
    return { ok: false, error: '採購單至少需要一個明細項次' };
  }
  for (let i = 0; i < input.items.length; i += 1) {
    if (input.items[i].unitPrice <= 0) {
      return { ok: false, error: `第 ${i + 1} 項的單價必須大於 0` };
    }
  }
  return validateQuoteCount({
    totalAmount: input.totalAmount,
    quoteCount: input.quoteCount,
    reason: input.quoteCountReason,
  });
}
