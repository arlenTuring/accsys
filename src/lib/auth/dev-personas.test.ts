import { describe, expect, it } from 'vitest';
import { isDevLoginAllowed } from '@/lib/auth/dev-personas';

describe('isDevLoginAllowed', () => {
  it('allows only a development server with the explicit opt-in flag', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'true' })).toBe(true);
  });

  it('refuses production even when the flag is set', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'production', NEXT_PUBLIC_DEV_LOGIN: 'true' })).toBe(false);
  });

  it('refuses test or unset NODE_ENV even when the flag is set', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'test', NEXT_PUBLIC_DEV_LOGIN: 'true' })).toBe(false);
    expect(isDevLoginAllowed({ NEXT_PUBLIC_DEV_LOGIN: 'true' })).toBe(false);
  });

  it('refuses a development server without the flag', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'false' })).toBe(false);
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'TRUE' })).toBe(false);
  });
});
