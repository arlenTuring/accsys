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

  it('also redacts inside arrays (previous rows snapshotted on edit/resubmit)', () => {
    const at = new Date('2026-10-13T00:00:00Z');
    expect(
      redactAuditDetails({
        previousItems: [{ id: 'r1', bankAccount: '0123456789', updatedAt: at, items: [{ bank_account: '1', amount: 5 }] }],
        nestedLists: [[{ password: 'p' }]],
      })
    ).toEqual({
      previousItems: [{ id: 'r1', bankAccount: '[redacted]', updatedAt: at, items: [{ bank_account: '[redacted]', amount: 5 }] }],
      nestedLists: [[{ password: '[redacted]' }]],
    });
  });
});
