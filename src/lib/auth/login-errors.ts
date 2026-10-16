export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: '登入失敗，請再試一次。',
  auth_cancelled: '已取消 Google 登入。',
  auth_unavailable: '登入服務暫時無法使用，請稍後再試或聯絡系統管理員。',
  login_expired: '登入逾時或連結已使用過，請重新登入。',
  rate_limited: '登入嘗試過於頻繁，請稍後再試。',
  domain_not_allowed: '此帳號網域不在允許範圍內，請使用公司 Google 帳號登入。',
  email_unverified: '此 Google 帳號的電子郵件尚未驗證，無法登入。',
  not_registered: '找不到您的員工資料，請聯絡系統管理員將您加入員工名單。',
  pending_approval: '您的 Google 帳號尚未與員工資料綁定，已送出申請，請等待系統管理員在「帳號與權限」核准。',
  identity_conflict: '此電子郵件已綁定其他 Google 帳號，無法自動登入。已通知系統管理員確認。',
  link_rejected: '此 Google 帳號的綁定申請未獲核准，請聯絡系統管理員。',
  access_disabled: '您的帳號已停用，請聯絡系統管理員。',
  identity_revoked: '此 Google 帳號的綁定已被撤銷，請聯絡系統管理員。',
  google_not_configured: '尚未設定 Google OAuth（GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET），請聯絡系統管理員補上憑證。',
};

export function getLoginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES[code] ?? null;
}
