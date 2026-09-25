import { describe, expect, it } from 'vitest';
import { resolveAdminDatabaseUrl, resolveTestDatabaseUrl } from './test-database-url';

const TEST_URL = 'postgres://u:p@127.0.0.1:25432/accsys_test';

describe('resolveTestDatabaseUrl', () => {
  it('accepts a postgres URL whose database name ends with _test', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_URL })).toEqual({ ok: true, url: TEST_URL });
  });

  it('fails when TEST_DATABASE_URL is missing, even if DATABASE_URL is set', () => {
    const result = resolveTestDatabaseUrl({ DATABASE_URL: 'postgres://u:p@db:5432/accsys' });
    expect(result.ok).toBe(false);
  });

  it('refuses a database whose name does not end with _test', () => {
    const result = resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/accsys' });
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain('"accsys"');
  });

  it('refuses a name that only contains test elsewhere', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@test-host:5432/accsys' }).ok).toBe(false);
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@h:5432/test_accsys' }).ok).toBe(false);
  });

  it('refuses when TEST_DATABASE_URL equals DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_URL, DATABASE_URL: TEST_URL }).ok).toBe(false);
  });

  it('refuses non-postgres schemes and malformed URLs', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'mysql://u:p@h/accsys_test' }).ok).toBe(false);
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'not a url' }).ok).toBe(false);
  });
});

describe('resolveAdminDatabaseUrl', () => {
  it('accepts a local _test database', () => {
    expect(resolveAdminDatabaseUrl({ TEST_ADMIN_DATABASE_URL: TEST_URL }).ok).toBe(true);
  });

  it('fails when missing', () => {
    expect(resolveAdminDatabaseUrl({}).ok).toBe(false);
  });

  it('refuses remote hosts even for _test databases', () => {
    expect(resolveAdminDatabaseUrl({ TEST_ADMIN_DATABASE_URL: 'postgres://u:p@db.corp:5432/accsys_test' }).ok).toBe(false);
  });

  it('refuses non-_test databases', () => {
    expect(resolveAdminDatabaseUrl({ TEST_ADMIN_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/postgres' }).ok).toBe(false);
  });
});
