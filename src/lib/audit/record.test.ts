import { describe, expect, it } from 'vitest';
import { redactAuditDetails } from './record';

describe('redactAuditDetails', () => {
  it('removes secrets and bank account numbers, including nested ones', () => {
    expect(
      redactAuditDetails({
        reason: 'x',
        sessionToken: 'abc',
        nested: { bank_account: '0123456789', code_verifier: 'v', ok: 1 },
        list: [1, 2],
      })
    ).toEqual({
      reason: 'x',
      sessionToken: '[redacted]',
      nested: { bank_account: '[redacted]', code_verifier: '[redacted]', ok: 1 },
      list: [1, 2],
    });
  });
});
