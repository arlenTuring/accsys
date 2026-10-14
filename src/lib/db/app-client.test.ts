import { afterEach, describe, expect, it, vi } from 'vitest';
import { toError } from './app-client';

describe('toError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a generic message with a reference instead of the database text', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "employees_google_email_key" Key (google_email)=(a@x.test)'),
      { code: '23505' }
    );

    const result = toError(pgError);

    expect(result.message).toMatch(/^database_error \(ref [0-9a-f]{8}\)$/);
    expect(result.message).not.toContain('google_email');
    // The server log keeps the code and identifiers under the same reference, not row values.
    const ref = result.message.match(/ref ([0-9a-f]{8})/)![1];
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`ref=${ref} code=23505`), { pg_code: '23505' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('a@x.test');
  });
});
