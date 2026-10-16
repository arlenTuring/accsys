import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, SYSTEM_ROLE_PERMISSIONS, hasPermission, permissionsByGroup } from '@/lib/authz/permissions';
import { parseAccessRole } from './validate';

describe('access role permissions', () => {
  it('lists every catalog permission in a UI group', () => {
    const keys = permissionsByGroup().flatMap((g) => g.items.map((i) => i.key));
    expect(new Set(keys)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('gives admin every permission and finance the finance bundle', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toEqual(ALL_PERMISSIONS);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.finance, 'finance.budget')).toBe(true);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.finance, 'forms.design')).toBe(false);
    expect(SYSTEM_ROLE_PERMISSIONS.staff).toEqual([]);
  });

  it('parses a new role with free-form permissions and rejects reserved codes', () => {
    const ok = parseAccessRole({ code: 'form_owner', name: '表單負責人', description: '可設計與刪除', permissions: ['forms.design', 'forms.delete'] }, true);
    expect(ok).toMatchObject({ ok: true, value: { code: 'form_owner', permissions: ['forms.design', 'forms.delete'] } });
    expect(parseAccessRole({ code: 'admin', name: 'x', permissions: [] }, true)).toMatchObject({ ok: false });
    expect(parseAccessRole({ code: 'Bad', name: 'x', permissions: [] }, true)).toMatchObject({ ok: false });
    expect(parseAccessRole({ name: '改名', permissions: ['no.such'] }, false)).toMatchObject({ ok: false });
  });
});
