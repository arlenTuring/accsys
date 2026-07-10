import { describe, expect, it } from 'vitest';
import { isPublicPath } from './public-paths';

describe('isPublicPath', () => {
  it('treats the home page as public', () => {
    expect(isPublicPath('/')).toBe(true);
  });

  it('treats the login page as public', () => {
    expect(isPublicPath('/login')).toBe(true);
  });

  it('treats the auth callback as public', () => {
    expect(isPublicPath('/auth/callback')).toBe(true);
  });

  it('treats the dashboard as protected', () => {
    expect(isPublicPath('/dashboard')).toBe(false);
  });

  it('treats admin pages as protected', () => {
    expect(isPublicPath('/admin/master-data')).toBe(false);
  });
});
