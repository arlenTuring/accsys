export type FormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request';

export const FORM_TYPES: readonly FormType[] = [
  'purchase_request',
  'purchase_order',
  'acceptance',
  'expense_request',
];

export const FORM_ROUTE_PREFIX: Record<FormType, string> = {
  purchase_request: '/requests',
  purchase_order: '/purchase-orders',
  acceptance: '/acceptances',
  expense_request: '/expense-requests',
};

export const FORM_LABELS: Record<FormType, string> = {
  purchase_request: '請購單',
  purchase_order: '採購單',
  acceptance: '驗收單',
  expense_request: '費用申請單',
};

export const FORM_TABLE: Record<FormType, string> = {
  purchase_request: 'purchase_requests',
  purchase_order: 'purchase_orders',
  acceptance: 'acceptances',
  expense_request: 'expense_requests',
};
