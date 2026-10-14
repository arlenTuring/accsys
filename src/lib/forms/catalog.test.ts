import { describe, expect, it } from 'vitest';
import { FORM_ROUTE_PREFIX, FORM_TYPES } from '@/lib/procurement/form-registry';
import { FORM_CATEGORIES, isNewFormPage, isRecordPage, isUnder, mergeCatalog } from './catalog';

describe('form catalog', () => {
  const formHrefs = FORM_CATEGORIES.flatMap((c) => c.forms.map((f) => f.href));
  const recordHrefs = FORM_CATEGORIES.flatMap((c) => c.records.map((r) => r.href));
  // Designer forms get their entries from published definitions in the database.
  const builtIn = FORM_TYPES.filter((t) => t !== 'custom');

  it('offers a "new" entry for every built-in form type', () => {
    for (const type of builtIn) {
      expect(formHrefs, type).toContain(`${FORM_ROUTE_PREFIX[type]}/new`);
    }
  });

  it('lists every built-in form type under some "my records" page', () => {
    for (const type of builtIn) {
      expect(recordHrefs.some((href) => isUnder(FORM_ROUTE_PREFIX[type], href)), type).toBe(true);
    }
  });

  it('tells new-form pages from record pages', () => {
    expect(isNewFormPage('/forms')).toBe(true);
    expect(isNewFormPage('/expense-claims/minor/new')).toBe(true);
    expect(isRecordPage('/expense-claims/minor/new')).toBe(false);
    expect(isRecordPage('/expense-claims/minor/123')).toBe(true);
    expect(isRecordPage('/assets')).toBe(false);
    expect(isUnder('/asset-transfers', '/assets')).toBe(false);
    expect(isNewFormPage('/f/admin-purchase/new')).toBe(true);
    expect(isRecordPage('/f/admin-purchase')).toBe(true);
    expect(isRecordPage('/f/admin-purchase/123')).toBe(true);
  });

  it('merges designer forms into existing or new categories without touching the base', () => {
    const merged = mergeCatalog([
      { key: 'seal-x', name: '新用印', description: 'd', categoryKey: 'seal', categoryTitle: '用印申請', categoryDescription: '' },
      { key: 'leave', name: '請假單', description: '', categoryKey: 'hr', categoryTitle: '人事', categoryDescription: '人事表單' },
    ]);
    const seal = merged.find((c) => c.id === 'seal')!;
    expect(seal.forms.at(-1)).toEqual({ title: '新用印', description: 'd', href: '/f/seal-x/new' });
    expect(seal.records.at(-1)).toEqual({ label: '我的新用印', href: '/f/seal-x' });
    expect(merged.at(-1)).toMatchObject({ id: 'hr', title: '人事', forms: [{ href: '/f/leave/new' }] });
    expect(FORM_CATEGORIES.find((c) => c.id === 'seal')!.forms.some((f) => f.href === '/f/seal-x/new')).toBe(false);
  });
});
