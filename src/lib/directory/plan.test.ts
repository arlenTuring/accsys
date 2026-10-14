import { describe, expect, it } from 'vitest';
import { planDirectorySync, type LocalIdentity } from './plan';
import type { DirectoryUser } from './users';

const dir = (id: string, email: string, flags: Partial<DirectoryUser> = {}): DirectoryUser => ({
  id,
  primaryEmail: email,
  fullName: id,
  suspended: false,
  archived: false,
  orgUnitPath: null,
  customerId: null,
  profile: { phone: null, title: null, department: null, employeeCode: null, managerEmail: null },
  ...flags,
});
const bound = (subject: string, email: string, code = `E${subject}`): LocalIdentity => ({
  identityId: `i-${subject}`,
  employeeId: `e-${subject}`,
  employeeCode: code,
  subject,
  email,
});
const first = { previousActiveCount: null };

describe('planDirectorySync', () => {
  it('revokes suspended and archived bindings only', () => {
    const plan = planDirectorySync(
      [dir('1', 'a@x.test'), dir('2', 'b@x.test', { suspended: true }), dir('3', 'c@x.test', { archived: true })],
      [bound('1', 'a@x.test'), bound('2', 'b@x.test'), bound('3', 'c@x.test')],
      first
    );
    expect(plan.revoke.map((r) => [r.subject, r.reason])).toEqual([
      ['2', 'suspended'],
      ['3', 'archived'],
    ]);
    expect(plan.blocked).toBeNull();
  });

  it('follows an email rename on the same account', () => {
    const plan = planDirectorySync([dir('1', 'new@x.test')], [bound('1', 'old@x.test')], first);
    expect(plan.emailChanges).toEqual([{ identityId: 'i-1', employeeCode: 'E1', from: 'old@x.test', to: 'new@x.test' }]);
    expect(plan.revoke).toEqual([]);
  });

  it('never moves a binding to a new account that reuses the email', () => {
    const plan = planDirectorySync([dir('2', 'a@x.test')], [bound('1', 'a@x.test')], first);
    expect(plan.missing.map((m) => m.subject)).toEqual(['1']);
    expect(plan.unbound).toEqual([{ subject: '2', email: 'a@x.test', fullName: '2' }]);
    expect(plan.revoke).toEqual([]);
  });

  it('only reports bound accounts missing from the listing', () => {
    const plan = planDirectorySync([dir('1', 'a@x.test')], [bound('1', 'a@x.test'), bound('9', 'z@x.test')], first);
    expect(plan.missing.map((m) => m.subject)).toEqual(['9']);
    expect(plan.revoke).toEqual([]);
  });

  it('lists active accounts without a binding, not suspended ones', () => {
    const plan = planDirectorySync([dir('5', 'n@x.test'), dir('6', 's@x.test', { suspended: true })], [], first);
    expect(plan.unbound.map((u) => u.subject)).toEqual(['5']);
  });

  it('blocks an empty listing', () => {
    expect(planDirectorySync([], [bound('1', 'a@x.test')], first).blocked).toContain('no accounts');
  });

  it('blocks a sharp drop in active accounts', () => {
    const users = Array.from({ length: 70 }, (_, i) => dir(String(i + 1), `u${i}@x.test`));
    expect(planDirectorySync(users, [], { previousActiveCount: 100 }).blocked).toContain('dropped from 100 to 70');
    expect(planDirectorySync(users, [], { previousActiveCount: 80 }).blocked).toBeNull();
  });

  it('blocks revoking many bindings at once', () => {
    const users = Array.from({ length: 10 }, (_, i) => dir(String(i + 1), `u${i}@x.test`, { suspended: i < 6 }));
    const local = users.map((u) => bound(u.id, u.primaryEmail));
    expect(planDirectorySync(users, local, first).blocked).toContain('6 bindings would be revoked');
    expect(planDirectorySync(users, local, { ...first, maxRevocations: 6 }).blocked).toBeNull();
  });
});
