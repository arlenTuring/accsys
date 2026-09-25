/**
 * Integration tests may only talk to a disposable database whose name ends in
 * `_test`. The app's DATABASE_URL (e.g. from .env.local) is never used: this
 * returns an error instead of falling back, so a missing test DB fails the run
 * rather than silently skipping or hitting a real database.
 */
export function resolveTestDatabaseUrl(
  env: Record<string, string | undefined>
): { ok: true; url: string } | { ok: false; error: string } {
  const raw = env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    return {
      ok: false,
      error:
        'TEST_DATABASE_URL is required for integration tests. Start the disposable DB with ' +
        '`npm run test:db:up` and see README "測試".',
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'TEST_DATABASE_URL is not a valid URL' };
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { ok: false, error: 'TEST_DATABASE_URL must use the postgres:// scheme' };
  }

  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/_test$/.test(dbName)) {
    return {
      ok: false,
      error: `Refusing to run integration tests against database "${dbName}": name must end with "_test"`,
    };
  }

  const appUrl = env.DATABASE_URL?.trim();
  if (appUrl && appUrl === raw) {
    return { ok: false, error: 'TEST_DATABASE_URL must differ from DATABASE_URL' };
  }

  return { ok: true, url: raw };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Superuser URL of the disposable test server, used only by the migration
 * drills to create and drop scratch databases. Must be local and `_test`.
 */
export function resolveAdminDatabaseUrl(
  env: Record<string, string | undefined>
): { ok: true; url: string } | { ok: false; error: string } {
  const raw = env.TEST_ADMIN_DATABASE_URL?.trim();
  if (!raw) {
    return {
      ok: false,
      error: 'TEST_ADMIN_DATABASE_URL is required for migration tests (superuser of the disposable test server).',
    };
  }
  const base = resolveTestDatabaseUrl({ TEST_DATABASE_URL: raw });
  if (!base.ok) return { ok: false, error: base.error.replace('TEST_DATABASE_URL', 'TEST_ADMIN_DATABASE_URL') };
  const host = new URL(raw).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    return { ok: false, error: `TEST_ADMIN_DATABASE_URL must point at a local server, not "${host}"` };
  }
  return { ok: true, url: raw };
}
