import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: vi.fn() }));

import { hasRecentAuthentication, type CurrentEmployee } from './current-employee';

// Session lookup itself (revocation, expiry, disabled employees, role changes)
// is covered against a real database in tests/integration/auth-*.test.ts.

describe('hasRecentAuthentication', () => {
  const at = (iso: string) => ({ authenticatedAt: new Date(iso) }) as CurrentEmployee;
  const now = Date.parse('2026-09-25T10:00:00Z');

  it('accepts a login within the window', () => {
    expect(hasRecentAuthentication(at('2026-09-25T09:50:00Z'), 15 * 60_000, now)).toBe(true);
  });

  it('rejects an older login', () => {
    expect(hasRecentAuthentication(at('2026-09-25T09:40:00Z'), 15 * 60_000, now)).toBe(false);
  });
});
