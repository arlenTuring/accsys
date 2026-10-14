import { describe, expect, it } from 'vitest';
import { AuthConfigError, loadAuthConfig, sessionCookieNames } from './config';

const base = {
  APP_ORIGIN: 'https://accsys.example.com',
  AUTH_MODE: 'manual',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  ALLOWED_GOOGLE_DOMAINS: 'example.com',
  SESSION_SECRET: 'x'.repeat(32),
  NODE_ENV: 'production',
};

describe('loadAuthConfig', () => {
  it('builds a fixed redirect URI and __Host- cookies for an https origin', () => {
    const cfg = loadAuthConfig(base);
    expect(cfg.redirectUri).toBe('https://accsys.example.com/auth/callback');
    expect(cfg.sessionCookieName).toBe('__Host-accsys_sid');
    expect(cfg.secureCookies).toBe(true);
    expect(cfg.sessionTtlMs).toBe(8 * 3600_000);
  });

  it.each([
    ['missing APP_ORIGIN', { APP_ORIGIN: '' }],
    ['plain http on a real host', { APP_ORIGIN: 'http://accsys.example.com' }],
    ['http localhost in production', { APP_ORIGIN: 'http://localhost:3000' }],
    ['origin with a path', { APP_ORIGIN: 'https://accsys.example.com/app' }],
    ['missing AUTH_MODE', { AUTH_MODE: '' }],
    ['directory mode before P6', { AUTH_MODE: 'directory' }],
    ['unknown mode', { AUTH_MODE: 'open' }],
    ['missing domains', { ALLOWED_GOOGLE_DOMAINS: '' }],
    ['bad domain', { ALLOWED_GOOGLE_DOMAINS: 'example.com, *' }],
    ['short session secret', { SESSION_SECRET: 'short' }],
    ['session longer than 12h', { SESSION_TTL_HOURS: '24' }],
  ])('refuses %s instead of falling back', (_label, patch) => {
    expect(() => loadAuthConfig({ ...base, ...patch })).toThrow(AuthConfigError);
  });

  it('allows http://localhost only outside production', () => {
    const cfg = loadAuthConfig({ ...base, APP_ORIGIN: 'http://localhost:3001', NODE_ENV: 'development' });
    expect(cfg.secureCookies).toBe(false);
    expect(cfg.sessionCookieName).toBe('accsys_sid');
  });

  it('accepts the legacy single-domain variable and normalizes case', () => {
    const env: Record<string, string | undefined> = { ...base, ALLOWED_GOOGLE_DOMAINS: undefined };
    expect(loadAuthConfig({ ...env, ALLOWED_GOOGLE_DOMAIN: 'Example.COM' }).allowedDomains).toEqual(['example.com']);
  });

  it('leaves Google credentials empty (not defaulted) when they are not configured', () => {
    const cfg = loadAuthConfig({ ...base, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' });
    expect(cfg.clientId).toBeNull();
    expect(cfg.clientSecret).toBeNull();
  });
});

describe('sessionCookieNames', () => {
  it('accepts only the __Host- cookie over https (a plain cookie could be planted by a sibling subdomain)', () => {
    expect(sessionCookieNames({ APP_ORIGIN: 'https://accsys.example.com' })).toEqual(['__Host-accsys_sid']);
  });

  it('also reads the plain cookie for http://localhost development', () => {
    expect(sessionCookieNames({ APP_ORIGIN: 'http://localhost:3001' })).toEqual(['__Host-accsys_sid', 'accsys_sid']);
  });
});
