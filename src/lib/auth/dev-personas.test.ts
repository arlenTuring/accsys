import { describe, expect, it } from 'vitest';
import { isDevLoginAllowed, isLoopbackHostHeader } from '@/lib/auth/dev-personas';

const LOCAL = 'http://localhost:3001';

describe('isDevLoginAllowed', () => {
  it('allows only a development server with the explicit opt-in flag on a loopback origin', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'true', APP_ORIGIN: LOCAL })).toBe(true);
    expect(
      isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'true', APP_ORIGIN: 'http://127.0.0.1:3000' })
    ).toBe(true);
  });

  it('refuses production even when the flag is set', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'production', NEXT_PUBLIC_DEV_LOGIN: 'true', APP_ORIGIN: LOCAL })).toBe(false);
  });

  it('refuses test or unset NODE_ENV even when the flag is set', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'test', NEXT_PUBLIC_DEV_LOGIN: 'true', APP_ORIGIN: LOCAL })).toBe(false);
    expect(isDevLoginAllowed({ NEXT_PUBLIC_DEV_LOGIN: 'true', APP_ORIGIN: LOCAL })).toBe(false);
  });

  it('refuses a development server without the flag', () => {
    expect(isDevLoginAllowed({ NODE_ENV: 'development', APP_ORIGIN: LOCAL })).toBe(false);
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'false', APP_ORIGIN: LOCAL })).toBe(false);
    expect(isDevLoginAllowed({ NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'TRUE', APP_ORIGIN: LOCAL })).toBe(false);
  });

  it('refuses a development server reachable under a shared hostname', () => {
    const dev = { NODE_ENV: 'development', NEXT_PUBLIC_DEV_LOGIN: 'true' };
    expect(isDevLoginAllowed({ ...dev, APP_ORIGIN: 'https://accsys.turing-drive.com' })).toBe(false);
    expect(isDevLoginAllowed({ ...dev, APP_ORIGIN: 'http://192.168.1.20:3000' })).toBe(false);
    expect(isDevLoginAllowed({ ...dev, APP_ORIGIN: 'http://localhost.evil.example' })).toBe(false);
    expect(isDevLoginAllowed({ ...dev, APP_ORIGIN: 'not a url' })).toBe(false);
    expect(isDevLoginAllowed(dev)).toBe(false);
  });
});

describe('isLoopbackHostHeader', () => {
  it('accepts loopback Host headers with or without a port', () => {
    expect(isLoopbackHostHeader('localhost:3001')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1')).toBe(true);
    expect(isLoopbackHostHeader('[::1]:3001')).toBe(true);
  });

  it('refuses LAN addresses, rebinding names and missing or malformed hosts', () => {
    expect(isLoopbackHostHeader('192.168.1.20:3001')).toBe(false);
    expect(isLoopbackHostHeader('localhost.evil.example')).toBe(false);
    expect(isLoopbackHostHeader('rebind.attacker.test:3001')).toBe(false);
    expect(isLoopbackHostHeader('localhost@evil.example')).toBe(false);
    expect(isLoopbackHostHeader('')).toBe(false);
    expect(isLoopbackHostHeader(null)).toBe(false);
  });
});
