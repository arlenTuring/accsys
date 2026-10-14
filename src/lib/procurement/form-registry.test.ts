import { describe, expect, it } from 'vitest';
import { FORM_LABELS, FORM_ROUTE_PREFIX, FORM_TABLE, FORM_TYPES, PROCUREMENT_FORM_TYPES } from './form-registry';

describe('form-registry', () => {
  it('lists exactly the four procurement-chain form types', () => {
    expect(PROCUREMENT_FORM_TYPES).toEqual([
      'purchase_request',
      'purchase_order',
      'acceptance',
      'expense_request',
    ]);
  });

  it('lists every approvable form type, non-procurement forms after the chain', () => {
    expect(FORM_TYPES).toEqual([
      ...PROCUREMENT_FORM_TYPES,
      'travel_expense',
      'department_expense',
      'project_expense',
      'revenue_expense',
      'minor_expense',
      'contract_seal_request',
      'general_seal_request',
      'invoice_seal_request',
      'asset_transfer',
      'custom',
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
    expect(FORM_LABELS.travel_expense).toBe('出差報告暨旅費報支單');
    expect(FORM_LABELS.department_expense).toBe('費用申請單(部門版)');
    expect(FORM_LABELS.project_expense).toBe('費用申請單(產品專案版)');
    expect(FORM_LABELS.revenue_expense).toBe('費用申請單(營收專案版)');
    expect(FORM_LABELS.minor_expense).toBe('費用申請單(部門版_單筆一萬元以下)');
    expect(FORM_LABELS.contract_seal_request).toBe('用印申請單(合約類)');
    expect(FORM_LABELS.general_seal_request).toBe('用印申請單(非合約類)');
    expect(FORM_LABELS.invoice_seal_request).toBe('用印申請單(開立發票/Invoice)');
    expect(FORM_LABELS.asset_transfer).toBe('資產異動申請單');
  });

  it('has a table name for every form type', () => {
    expect(FORM_TABLE.purchase_request).toBe('purchase_requests');
    expect(FORM_TABLE.purchase_order).toBe('purchase_orders');
    expect(FORM_TABLE.acceptance).toBe('acceptances');
    expect(FORM_TABLE.expense_request).toBe('expense_requests');
    expect(FORM_TABLE.travel_expense).toBe('travel_expenses');
    expect(FORM_TABLE.department_expense).toBe('department_expenses');
    expect(FORM_TABLE.project_expense).toBe('project_expenses');
    expect(FORM_TABLE.revenue_expense).toBe('revenue_expenses');
    expect(FORM_TABLE.minor_expense).toBe('minor_expenses');
    expect(FORM_TABLE.contract_seal_request).toBe('contract_seal_requests');
    expect(FORM_TABLE.general_seal_request).toBe('general_seal_requests');
    expect(FORM_TABLE.invoice_seal_request).toBe('invoice_seal_requests');
    expect(FORM_TABLE.asset_transfer).toBe('asset_transfers');
    expect(FORM_TABLE.custom).toBe('form_submissions');
  });
});
