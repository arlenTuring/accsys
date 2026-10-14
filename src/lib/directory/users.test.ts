import { describe, expect, it } from 'vitest';
import { collectDirectory, parseUsersPage, type DirectoryScope, type FetchPage } from './users';

const scope: DirectoryScope = { allowedDomains: ['example.test'], customerId: 'C0test' };
const user = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id,
  primaryEmail: email,
  name: { fullName: `User ${id}` },
  customerId: 'C0test',
  suspended: false,
  ...extra,
});
const page = (users: unknown[], nextPageToken?: string) => ({ kind: 'admin#directory#users', users, ...(nextPageToken ? { nextPageToken } : {}) });

/** Serves pages keyed by the token that requests them (null = first page). */
function source(pages: Record<string, { status: number; body: unknown } | Error>): FetchPage & { calls: number } {
  const fn = (async (token: string | null) => {
    fn.calls++;
    const r = pages[token ?? 'first'];
    if (r instanceof Error) throw r;
    return r;
  }) as FetchPage & { calls: number };
  fn.calls = 0;
  return fn;
}
const noSleep = { sleep: async () => {} };

describe('parseUsersPage', () => {
  it('normalizes emails and flags', () => {
    const r = parseUsersPage(page([user('101', ' Alice@Example.TEST ', { archived: true })]), scope);
    expect(r).toEqual({
      ok: true,
      nextPageToken: null,
      users: [{ id: '101', primaryEmail: 'alice@example.test', fullName: 'User 101', suspended: false, archived: true, orgUnitPath: null }],
    });
  });

  it('accepts an empty page (no users key)', () => {
    expect(parseUsersPage({ kind: 'admin#directory#users' }, scope)).toEqual({ ok: true, users: [], nextPageToken: null });
  });

  it.each([
    ['another domain', page([user('101', 'x@evil.example')])],
    ['another customer', page([user('101', 'x@example.test', { customerId: 'C0other' })])],
    ['a missing id', page([{ primaryEmail: 'x@example.test', customerId: 'C0test' }])],
    ['a non-boolean suspended flag', page([user('101', 'x@example.test', { suspended: 'yes' })])],
    ['an unexpected kind', { kind: 'admin#directory#groups', users: [] }],
  ])('rejects %s', (_label, body) => {
    expect(parseUsersPage(body, scope).ok).toBe(false);
  });
});

describe('collectDirectory', () => {
  it('reads every page', async () => {
    const fetchPage = source({
      first: { status: 200, body: page([user('1', 'a@example.test')], 't2') },
      t2: { status: 200, body: page([], 't3') },
      t3: { status: 200, body: page([user('2', 'b@example.test')]) },
    });
    const r = await collectDirectory(fetchPage, scope, noSleep);
    expect(r.ok && r.users.map((u) => u.id)).toEqual(['1', '2']);
    expect(r.ok && r.pages).toBe(3);
  });

  it('retries 429 / 5xx / network errors, then continues', async () => {
    let n = 0;
    const fetchPage: FetchPage = async () => {
      n++;
      if (n === 1) return { status: 429, body: null };
      if (n === 2) throw new Error('timeout');
      if (n === 3) return { status: 503, body: null };
      return { status: 200, body: page([user('1', 'a@example.test')]) };
    };
    expect((await collectDirectory(fetchPage, scope, noSleep)).ok).toBe(true);
  });

  it('fails the whole run when the second page keeps failing (no partial list)', async () => {
    const fetchPage = source({
      first: { status: 200, body: page([user('1', 'a@example.test')], 't2') },
      t2: { status: 500, body: null },
    });
    expect(await collectDirectory(fetchPage, scope, { ...noSleep, retries: 2 })).toEqual({ ok: false, error: 'page 2: HTTP 500' });
    expect(fetchPage.calls).toBe(4);
  });

  it('does not retry 403', async () => {
    const fetchPage = source({ first: { status: 403, body: null } });
    expect(await collectDirectory(fetchPage, scope, noSleep)).toEqual({ ok: false, error: 'page 1: not authorized' });
    expect(fetchPage.calls).toBe(1);
  });

  it('rejects an account listed twice and a repeating page token', async () => {
    const dup = source({
      first: { status: 200, body: page([user('1', 'a@example.test')], 't2') },
      t2: { status: 200, body: page([user('1', 'a@example.test')]) },
    });
    expect((await collectDirectory(dup, scope, noSleep)).ok).toBe(false);
    const loop = source({
      first: { status: 200, body: page([], 't2') },
      t2: { status: 200, body: page([], 't2') },
    });
    expect(await collectDirectory(loop, scope, noSleep)).toEqual({ ok: false, error: 'page 2: page token repeats' });
  });
});
