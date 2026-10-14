export const ACCOUNT_ERRORS: Record<string, string> = {
  forbidden: '只有系統管理員可以執行此操作。',
  reauth_required: '此操作需要近期登入，請重新登入後再試。',
  rate_limited: '操作過於頻繁，請稍後再試。',
  not_found: '找不到資料，請重新整理。',
  invalid_state: '狀態已變更，請重新整理後再試。',
  self_action: '不能對自己的帳號執行此操作。',
  employee_disabled: '此員工已停用，請先啟用。',
  employee_already_bound: '此員工已綁定其他 Google 帳號，請先撤銷原綁定。',
  duplicate_code: '員工編號已被使用。',
  duplicate_email: '此 Email 已屬於其他員工。',
  invalid_input: '輸入內容不正確。',
};
