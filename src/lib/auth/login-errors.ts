export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: '登入失敗，請再試一次。',
  domain_not_allowed: '此帳號網域不在允許範圍內，請使用公司 Google 帳號登入。',
  not_registered: '找不到您的員工資料，請聯絡系統管理員將您加入員工名單。',
  google_not_configured:
    '本機尚未設定 Google OAuth（GOOGLE_CLIENT_ID）。請改用下方「本機開發登入」，或請管理員補上憑證。',
};

export function getLoginErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES[code] ?? null;
}
