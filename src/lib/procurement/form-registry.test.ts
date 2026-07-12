import { describe, expect, it } from 'vitest';
import { FORM_LABELS, FORM_ROUTE_PREFIX, FORM_TABLE, FORM_TYPES } from './form-registry';

describe('form-registry', () => {
  it('lists exactly the four known form types', () => {
    expect(FORM_TYPES).toEqual([
      'purchase_request',
      'purchase_order',
      'acceptance',
      'expense_request',
    ]);
  });

  it('has a route prefix for every form type', () => {
    for (const type of FORM_TYPES) {
      expect(FORM_ROUTE_PREFIX[type]).toMatch(/^\//);
    }
  });

  it('has a Traditional Chinese label for every form type', () => {
    expect(FORM_LABELS.purchase_request).toBe('請購單');
    expect(FORM_LABELS.purchase_order).toBe('採購單');
    expect(FORM_LABELS.acceptance).toBe('驗收單');
    expect(FORM_LABELS.expense_request).toBe('費用申請單');
  });

  it('has a table name for every form type', () => {
    expect(FORM_TABLE.purchase_request).toBe('purchase_requests');
    expect(FORM_TABLE.purchase_order).toBe('purchase_orders');
    expect(FORM_TABLE.acceptance).toBe('acceptances');
    expect(FORM_TABLE.expense_request).toBe('expense_requests');
  });
});
