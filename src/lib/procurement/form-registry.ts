/** The four forms of the procurement chain (one case_number ties them together). */
export type ProcurementFormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request';
export type SealFormType = 'contract_seal_request' | 'general_seal_request' | 'invoice_seal_request';
export type ExpenseClaimFormType = 'department_expense' | 'project_expense' | 'revenue_expense' | 'minor_expense';
/** `custom`: any form built in the form designer (rows in form_submissions). */
export type FormType = ProcurementFormType | 'travel_expense' | ExpenseClaimFormType | SealFormType | 'asset_transfer' | 'custom';

export const PROCUREMENT_FORM_TYPES: readonly ProcurementFormType[] = [
  'purchase_request',
  'purchase_order',
  'acceptance',
  'expense_request',
];

/** Every approvable form type (authorization, attachments, approval steps). */
export const FORM_TYPES: readonly FormType[] = [
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
];

/**
 * `${prefix}/${id}` is the detail page. Designer forms live under /f/<key>;
 * /f/_/<id> redirects to the submission's own key.
 */
export const FORM_ROUTE_PREFIX: Record<FormType, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
  travel_expense: '/travel-expenses',
  department_expense: '/expense-claims/department',
  project_expense: '/expense-claims/project',
  revenue_expense: '/expense-claims/revenue',
  minor_expense: '/expense-claims/minor',
  contract_seal_request: '/seal-requests/contracts',
  general_seal_request: '/seal-requests/general',
  invoice_seal_request: '/seal-requests/invoices',
  asset_transfer: '/asset-transfers',
  custom: '/f/_',
};

export const FORM_LABELS: Record<FormType, string> = {
  purchase_request: '請購單',
  purchase_order: '採購單',
  acceptance: '驗收單',
  expense_request: '費用申請單',
  travel_expense: '出差報告暨旅費報支單',
  department_expense: '費用申請單(部門版)',
  project_expense: '費用申請單(產品專案版)',
  revenue_expense: '費用申請單(營收專案版)',
  minor_expense: '費用申請單(部門版_單筆一萬元以下)',
  contract_seal_request: '用印申請單(合約類)',
  general_seal_request: '用印申請單(非合約類)',
  invoice_seal_request: '用印申請單(開立發票/Invoice)',
  asset_transfer: '資產異動申請單',
  custom: '申請單',
};

export const FORM_TABLE: Record<FormType, string> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
  acceptance: 'acceptances',
  expense_request: 'expense_requests',
  travel_expense: 'travel_expenses',
  department_expense: 'department_expenses',
  project_expense: 'project_expenses',
  revenue_expense: 'revenue_expenses',
  minor_expense: 'minor_expenses',
  contract_seal_request: 'contract_seal_requests',
  general_seal_request: 'general_seal_requests',
  invoice_seal_request: 'invoice_seal_requests',
  asset_transfer: 'asset_transfers',
  custom: 'form_submissions',
};
