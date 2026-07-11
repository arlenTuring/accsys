import { describe, expect, it } from 'vitest';
import { computeDefaultExpectedPaymentDate, computePaymentBatchDate } from './payment-batch';

describe('computeDefaultExpectedPaymentDate', () => {
  it('returns the 25th of the month after the invoice month', () => {
    expect(computeDefaultExpectedPaymentDate('2026-07')).toBe('2026-08-25');
  });

  it('rolls over the year at December', () => {
    expect(computeDefaultExpectedPaymentDate('2026-12')).toBe('2027-01-25');
  });
});

describe('computePaymentBatchDate', () => {
  it('picks the 25th for a supplier payee when the desired date is before the 25th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-10',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
  });

  it('rolls a supplier payee to next month when the desired date is after the 25th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-26',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-08-25');
  });

  it('picks the 15th for an employee payee when the desired date is on or before the 15th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-05',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-15');
  });

  it('picks the 30th for an employee payee when the desired date is between the 16th and 30th', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-20',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-30');
  });

  it('rolls an employee payee to next month\'s 15th when past the second batch day', () => {
    const result = computePaymentBatchDate({
      payeeType: 'employee',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-31',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-08-15');
  });

  it('falls back to invoiceMonth-based default when expectedPaymentDate is blank', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: null,
      invoiceMonth: '2026-07',
    });
    expect(result.batchDate).toBe('2026-08-25');
  });

  it('flags isPastNormalDeadline when fewer than 5 business days remain', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-22',
      expectedPaymentDate: '2026-07-24',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
    expect(result.isPastNormalDeadline).toBe(true);
  });

  it('flags isUrgent when fewer than 2 business days remain', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-24',
      expectedPaymentDate: '2026-07-24',
      invoiceMonth: null,
    });
    expect(result.batchDate).toBe('2026-07-25');
    expect(result.isUrgent).toBe(true);
  });

  it('does not flag anything when submitted comfortably ahead', () => {
    const result = computePaymentBatchDate({
      payeeType: 'supplier',
      referenceDate: '2026-07-01',
      expectedPaymentDate: '2026-07-10',
      invoiceMonth: null,
    });
    expect(result.isPastNormalDeadline).toBe(false);
    expect(result.isUrgent).toBe(false);
  });
});
