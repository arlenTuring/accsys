import { computeDefaultExpectedPaymentDate, computePaymentBatchDate } from '@/lib/procurement/payment-batch';
import { PAYMENT_BATCH_KEY, type PaymentLink } from './schema';
import type { SubmissionData } from './validate';

export type PaymentBatch = { batchDate: string; isPastNormalDeadline: boolean; isUrgent: boolean };

/**
 * Fills a blank 預計付款日 from 發票月份 and stores the payment batch, both
 * computed against `today` (Taipei) like the legacy 費用申請單.
 */
export function applyPaymentSchedule(link: PaymentLink, data: SubmissionData, today: string): SubmissionData {
  const payee = data[link.payeeType];
  if (payee !== 'employee' && payee !== 'supplier') return data;
  const month = link.invoiceMonth ? data[link.invoiceMonth] : null;
  const invoiceMonth = typeof month === 'string' && month !== '' ? month : null;
  const out: SubmissionData = { ...data };
  if (link.expectedPaymentDate && (out[link.expectedPaymentDate] === null || out[link.expectedPaymentDate] === undefined) && invoiceMonth) {
    out[link.expectedPaymentDate] = computeDefaultExpectedPaymentDate(invoiceMonth);
  }
  const expected = link.expectedPaymentDate ? out[link.expectedPaymentDate] : null;
  out[PAYMENT_BATCH_KEY] = computePaymentBatchDate({
    payeeType: payee,
    referenceDate: today,
    expectedPaymentDate: typeof expected === 'string' ? expected : null,
    invoiceMonth,
  });
  return out;
}

/** The stored 期望付款日 (after the blank-date fill), or null. */
export function expectedPaymentDateOf(link: PaymentLink, data: Record<string, unknown>): string | null {
  const v = link.expectedPaymentDate ? data[link.expectedPaymentDate] : null;
  return typeof v === 'string' && v !== '' ? v : null;
}

export function paymentBatchOf(data: Record<string, unknown>): PaymentBatch | null {
  const v = data[PAYMENT_BATCH_KEY];
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  return typeof b.batchDate === 'string' ? { batchDate: b.batchDate, isPastNormalDeadline: b.isPastNormalDeadline === true, isUrgent: b.isUrgent === true } : null;
}
