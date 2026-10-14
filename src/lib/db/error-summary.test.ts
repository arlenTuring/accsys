import { describe, expect, it } from 'vitest';
import { errorSummary } from './error-summary';

const pgError = () =>
  Object.assign(new Error('duplicate key value violates unique constraint "employees_google_email_key"'), {
    name: 'PostgresError',
    severity: 'ERROR',
    code: '23505',
    detail: 'Key (google_email)=(someone@example.test) already exists.',
    table_name: 'employees',
    constraint_name: 'employees_google_email_key',
  });

describe('errorSummary', () => {
  it('keeps only codes and identifiers of a PostgreSQL error', () => {
    const out = errorSummary(pgError());
    expect(out).toEqual({ pg_code: '23505', pg_severity: 'ERROR', pg_table_name: 'employees', pg_constraint_name: 'employees_google_email_key' });
    expect(JSON.stringify(out)).not.toContain('someone@example.test');
  });

  it('drops the SQL and bound parameters of a wrapped query error', () => {
    const wrapped = Object.assign(new Error('Failed query: insert into expense_requests ...\nparams: 012345678901'), {
      name: 'DrizzleQueryError',
      query: 'insert into expense_requests ...',
      params: ['012345678901'],
      cause: pgError(),
    });
    const out = errorSummary(wrapped);
    expect(out).toMatchObject({ wrapper: 'DrizzleQueryError', pg_code: '23505' });
    expect(JSON.stringify(out)).not.toContain('012345678901');
    expect(JSON.stringify(out)).not.toContain('Failed query');
  });

  it('keeps name, message and stack of programming errors', () => {
    const out = errorSummary(new TypeError('x.trim is not a function'));
    expect(out).toMatchObject({ name: 'TypeError', message: 'x.trim is not a function' });
    expect(typeof out.stack).toBe('string');
  });
});
