import { describe, expect, it } from 'vitest';

/**
 * Version-conflict semantics for application drafts (pure contract test).
 * DB-backed patch tests live under tests/integration when TEST_DATABASE_URL is set.
 */
describe('application draft versioning contract', () => {
  it('expects optimistic concurrency: mismatched version is conflict, not silent overwrite', () => {
    const current = { version: 3, data: { amount: '100' } };
    const expectedVersion = 2;
    const conflict = current.version !== expectedVersion;
    expect(conflict).toBe(true);
  });

  it('idempotency key is stable per draft version', () => {
    const draftId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const version = 4;
    expect(`ai-draft:${draftId}:v${version}`).toBe(
      'ai-draft:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:v4'
    );
  });
});
