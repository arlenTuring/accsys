import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './redirect';

const ORIGIN = 'https://accsys.example.com';

describe('safeReturnTo', () => {
  it.each([
    ['/requests', '/requests'],
    ['/requests/abc?tab=items', '/requests/abc?tab=items'],
  ])('keeps same-origin path %s', (input, expected) => {
    expect(safeReturnTo(input, ORIGIN)).toBe(expected);
  });

  it.each([
    null,
    '',
    'requests',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    'https://evil.com/x',
    'javascript:alert(1)',
    '/\r\nSet-Cookie:x',
    '/login',
    '/auth/logout',
    '/auth/callback?code=x',
    `/${'a'.repeat(600)}`,
  ])('replaces %s with the default page', (input) => {
    expect(safeReturnTo(input, ORIGIN)).toBe('/dashboard');
  });

  it('keeps percent-encoded CR/LF encoded (cannot split the Location header)', () => {
    const result = safeReturnTo('/%0d%0aSet-Cookie:x', ORIGIN);
    expect(result).not.toMatch(/[\r\n]/);
    expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
  });
});
