import { describe, expect, it } from 'vitest';
import { buildDirectoryReview, sameName, type EmployeeRow, type SnapshotRow } from './review';

const dir = (id: string, over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  directoryUserId: id,
  primaryEmail: `u${id}@example.com`,
  fullName: `User ${id}`,
  suspended: false,
  archived: false,
  removed: false,
  phone: null,
  title: null,
  department: null,
  employeeCode: null,
  ...over,
});

const emp = (id: string, over: Partial<EmployeeRow> = {}): EmployeeRow => ({
  id,
  employeeCode: `E${id}`,
  name: `User ${id}`,
  googleEmail: null,
  phone: null,
  title: null,
  departmentName: '業務部',
  accessEnabled: true,
  ...over,
});

describe('sameName', () => {
  it('ignores spacing and the given-family order Workspace uses for CJK names', () => {
    expect(sameName('王小明', '小明 王')).toBe(true);
    expect(sameName('王小明', '王 小明')).toBe(true);
    expect(sameName('王小明', '王大明')).toBe(false);
  });
});

describe('buildDirectoryReview', () => {
  it('lists unbound active accounts as new hires with an email or code suggestion', () => {
    const review = buildDirectoryReview({
      snapshot: [
        dir('1', { primaryEmail: 'amy@example.com' }),
        dir('2', { employeeCode: 'E2' }),
        dir('3'),
        dir('4', { suspended: true }),
      ],
      employees: [emp('1', { googleEmail: 'AMY@example.com', name: 'User 1' }), emp('2')],
      identities: [],
      linkRequests: [{ id: 'req-3', subject: '3', email: 'u3@example.com' }],
    });
    expect(review.newHires.map((h) => [h.directoryUserId, h.match?.by ?? null, h.linkRequestId])).toEqual([
      ['1', 'email', null],
      ['2', 'code', null],
      ['3', null, 'req-3'],
    ]);
    expect(review.newHires[1].match!.changes).toEqual([{ field: 'email', current: null, next: 'u2@example.com' }]);
  });

  it('does not suggest an employee that is already bound to another account', () => {
    const review = buildDirectoryReview({
      snapshot: [dir('2', { primaryEmail: 'u1@example.com' })],
      employees: [emp('1', { googleEmail: 'u1@example.com' })],
      identities: [{ employeeId: '1', subject: '99', active: true }],
      linkRequests: [],
    });
    expect(review.newHires[0].match).toBeNull();
  });

  it('reports field changes for bound employees; empty directory values never overwrite', () => {
    const review = buildDirectoryReview({
      snapshot: [dir('1', { fullName: '小明 王', primaryEmail: 'new@example.com', phone: '02-1234', title: null, department: '研發部' })],
      employees: [emp('1', { name: '王小明', googleEmail: 'old@example.com', title: '工程師' })],
      identities: [{ employeeId: '1', subject: '1', active: true }],
      linkRequests: [],
    });
    expect(review.changes).toEqual([
      {
        employeeId: '1',
        employeeCode: 'E1',
        name: '王小明',
        directoryUserId: '1',
        changes: [
          { field: 'email', current: 'old@example.com', next: 'new@example.com' },
          { field: 'phone', current: null, next: '02-1234' },
        ],
        departmentHint: '研發部',
        departmentName: '業務部',
      },
    ]);
    expect(review.matchedBindings).toBe(1);
  });

  it('lists enabled employees whose account is suspended, archived, removed or missing', () => {
    const review = buildDirectoryReview({
      snapshot: [dir('1', { suspended: true }), dir('2', { archived: true }), dir('3', { removed: true }), dir('4'), dir('5', { suspended: true })],
      employees: [emp('1'), emp('2'), emp('3'), emp('4'), emp('5', { accessEnabled: false }), emp('6')],
      identities: [
        // the sync already revoked these bindings; they still link the account
        { employeeId: '1', subject: '1', active: false },
        { employeeId: '2', subject: '2', active: false },
        { employeeId: '3', subject: '3', active: true },
        { employeeId: '4', subject: '4', active: true },
        { employeeId: '5', subject: '5', active: false },
        { employeeId: '6', subject: '600', active: true },
      ],
      linkRequests: [],
    });
    expect(review.leavers.map((l) => [l.employeeId, l.reason])).toEqual([
      ['1', 'suspended'],
      ['2', 'archived'],
      ['3', 'removed'],
      ['6', 'missing'],
    ]);
  });

  it('ignores a revoked binding when the employee has since been bound to another account', () => {
    const review = buildDirectoryReview({
      snapshot: [dir('1', { suspended: true }), dir('2')],
      employees: [emp('1')],
      identities: [
        { employeeId: '1', subject: '1', active: false },
        { employeeId: '1', subject: '2', active: true },
      ],
      linkRequests: [],
    });
    expect(review.leavers).toEqual([]);
    expect(review.newHires).toEqual([]);
  });

  it('does not list "missing" bindings when no binding matches at all (directory ids may not be login ids)', () => {
    const review = buildDirectoryReview({
      snapshot: [dir('1')],
      employees: [emp('1')],
      identities: [{ employeeId: '1', subject: 'oidc-sub-1', active: true }],
      linkRequests: [],
    });
    expect(review.matchedBindings).toBe(0);
    expect(review.activeBindings).toBe(1);
    expect(review.leavers).toEqual([]);
  });
});
