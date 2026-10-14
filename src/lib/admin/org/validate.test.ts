import { describe, expect, it } from 'vitest';
import {
  MAX_GROUP_MEMBERS,
  delegationsOverlap,
  parseDelegation,
  parseDepartment,
  parseJobRole,
  parseLevel,
  parseMemberIds,
  subtreeOf,
} from './validate';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('parseLevel', () => {
  it('accepts a well-formed level', () => {
    expect(parseLevel({ code: 'division', name: ' 處 ', rank: '20' }, true)).toEqual({ ok: true, value: { code: 'division', name: '處', rank: 20 } });
  });

  it('rejects bad codes only when creating, and out-of-range ranks', () => {
    expect(parseLevel({ code: 'Division', name: '處', rank: 20 }, true).ok).toBe(false);
    expect(parseLevel({ code: 'Division', name: '處', rank: 20 }, false).ok).toBe(true);
    expect(parseLevel({ code: 'x', name: '處', rank: 0 }, true).ok).toBe(false);
    expect(parseLevel({ code: 'x', name: '處', rank: 1.5 }, true).ok).toBe(false);
    expect(parseLevel({ code: 'x', name: '', rank: 5 }, true).ok).toBe(false);
  });
});

describe('parseDepartment', () => {
  it('normalises empty references to null', () => {
    const r = parseDepartment({ code: 'IT-1', name: '資訊', parentId: '', orgLevelId: undefined, managerId: A, sortOrder: '3' }, true);
    expect(r).toEqual({ ok: true, value: { code: 'IT-1', name: '資訊', parentId: null, orgLevelId: null, managerId: A, sortOrder: 3 } });
  });

  it('rejects malformed ids, codes and control characters', () => {
    expect(parseDepartment({ code: 'IT', name: '資訊', parentId: 'nope' }, true).ok).toBe(false);
    expect(parseDepartment({ code: '資訊', name: '資訊' }, true).ok).toBe(false);
    expect(parseDepartment({ code: 'IT', name: '資\u0007訊' }, true).ok).toBe(false);
    expect(parseDepartment({ code: 'IT', name: '資訊', sortOrder: -1 }, true).ok).toBe(false);
  });
});

describe('parseJobRole', () => {
  it('keeps the description optional and bounded', () => {
    expect(parseJobRole({ code: 'it_admin', name: '資訊管理員' }, true)).toEqual({ ok: true, value: { code: 'it_admin', name: '資訊管理員', description: '' } });
    expect(parseJobRole({ code: 'it_admin', name: '資訊管理員', description: 'x'.repeat(201) }, true).ok).toBe(false);
  });
});

describe('parseMemberIds', () => {
  it('requires distinct uuids within the size limit', () => {
    expect(parseMemberIds([A, B])).toEqual({ ok: true, value: [A, B] });
    expect(parseMemberIds([A, A]).ok).toBe(false);
    expect(parseMemberIds(['x']).ok).toBe(false);
    expect(parseMemberIds(Array.from({ length: MAX_GROUP_MEMBERS + 1 }, (_, i) => uuid(i))).ok).toBe(false);
  });
});

describe('parseDelegation', () => {
  const base = { delegatorId: A, delegateId: B, startsOn: '2026-10-13', endsOn: '2026-10-20', formKeys: null, reason: '' };

  it('accepts a current period for all forms or listed forms', () => {
    expect(parseDelegation(base, '2026-10-13').ok).toBe(true);
    const r = parseDelegation({ ...base, formKeys: ['admin-purchase', 'admin-purchase'] }, '2026-10-13');
    expect(r.ok && r.value.formKeys).toEqual(['admin-purchase']);
  });

  it('rejects self-delegation, reversed or past periods and over-long periods', () => {
    expect(parseDelegation({ ...base, delegateId: A }, '2026-10-13').ok).toBe(false);
    expect(parseDelegation({ ...base, endsOn: '2026-10-12' }, '2026-10-01').ok).toBe(false);
    expect(parseDelegation({ ...base, startsOn: '2026-10-01', endsOn: '2026-10-05' }, '2026-10-13').ok).toBe(false);
    expect(parseDelegation({ ...base, endsOn: '2027-10-14' }, '2026-10-13').ok).toBe(false);
    expect(parseDelegation({ ...base, endsOn: '2027-10-13' }, '2026-10-13').ok).toBe(true);
    expect(parseDelegation({ ...base, startsOn: '2026-02-30' }, '2026-01-01').ok).toBe(false);
    expect(parseDelegation({ ...base, formKeys: [] }, '2026-10-13').ok).toBe(false);
  });
});

describe('delegationsOverlap', () => {
  const p = (startsOn: string, endsOn: string, formKeys: string[] | null) => ({ startsOn, endsOn, formKeys });

  it('needs both the dates and the form scopes to overlap', () => {
    expect(delegationsOverlap(p('2026-10-01', '2026-10-10', null), p('2026-10-10', '2026-10-20', ['a']))).toBe(true);
    expect(delegationsOverlap(p('2026-10-01', '2026-10-09', null), p('2026-10-10', '2026-10-20', null))).toBe(false);
    expect(delegationsOverlap(p('2026-10-01', '2026-10-10', ['a']), p('2026-10-05', '2026-10-20', ['b']))).toBe(false);
    expect(delegationsOverlap(p('2026-10-01', '2026-10-10', ['a', 'b']), p('2026-10-05', '2026-10-20', ['b']))).toBe(true);
  });
});

describe('subtreeOf', () => {
  it('returns the department and everything below it', () => {
    const depts = [
      { id: 'root', parentId: null },
      { id: 'a', parentId: 'root' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'root' },
    ];
    expect([...subtreeOf('a', depts)].sort()).toEqual(['a', 'b']);
    expect(subtreeOf('root', depts).size).toBe(4);
  });
});
