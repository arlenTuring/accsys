import { describe, expect, it } from 'vitest';
import { getLoginErrorMessage } from './login-errors';

describe('getLoginErrorMessage', () => {
  it('maps auth_failed to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('auth_failed')).toBe('登入失敗，請再試一次。');
  });

  it('maps domain_not_allowed to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('domain_not_allowed')).toBe(
      '此帳號網域不在允許範圍內，請使用公司 Google 帳號登入。'
    );
  });

  it('maps not_registered to a Traditional Chinese message', () => {
    expect(getLoginErrorMessage('not_registered')).toBe(
      '找不到您的員工資料，請聯絡系統管理員將您加入員工名單。'
    );
  });

  it('returns null for an unknown code', () => {
    expect(getLoginErrorMessage('something_else')).toBeNull();
  });

  it('returns null for null', () => {
    expect(getLoginErrorMessage(null)).toBeNull();
  });
});
