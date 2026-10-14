import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MIGRATION_BATCHES } from '@/lib/custom-forms/migrated';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';
import type { FormSchema } from '@/lib/custom-forms/schema';

const currentEmployee: { value: unknown } = { value: null };
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => currentEmployee.value }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// Every migrated form goes through the designer exactly as an admin would:
// the installed draft opens in the designer, publishes (switching the
// hard-coded form over), can be edited and republished as a new version, and
// keeps replacing the hard-coded form throughout.
describe('migrated forms are ordinary designer forms', () => {
  let sql: Sql;
  const tag = `md${Date.now()}`;
  const ids = {} as Record<'admin' | 'dept', string>;
  const all = Object.values(MIGRATION_BATCHES).flatMap((b) => b.forms);
  const keyOf = new Map(all.map((f, i) => [f.key, `${tag}-${i}`]));
  /** 關聯單據 rules name other forms by key: point them at the tagged copies. */
  const remapSources = (schema: MigratedForm['schema']) => {
    for (const section of schema.sections as { fields: Record<string, unknown>[] }[])
      for (const field of section.fields)
        if (field.type === 'source')
          for (const rule of field.sources as { form: string; unlessCaseHas?: string }[]) {
            rule.form = keyOf.get(rule.form) ?? rule.form;
            if (rule.unlessCaseHas) rule.unlessCaseHas = keyOf.get(rule.unlessCaseHas) ?? rule.unlessCaseHas;
          }
    return schema;
  };
  const forms: MigratedForm[] = all.map((f) => {
    const copy = clone(f);
    return { ...copy, key: keyOf.get(f.key)!, schema: remapSources(copy.schema) };
  });
  const admin = () => ({ id: ids.admin, role: 'admin', authenticatedAt: new Date() });
  const rowVersion = async (id: string) => Number((await sql`select version from form_definitions where id = ${id}`)[0].version);

  beforeAll(async () => {
    sql = await loadSql();
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type = any(${forms.map((f) => f.legacyFormType)})`;
    ids.dept = (await sql`select id from departments where active limit 1`)[0].id;
    ids.admin = (
      await sql`insert into employees (employee_code, name, department_id, role) values (${`${tag}-admin`}, '轉換表單管理員', ${ids.dept}, 'admin') returning id`
    )[0].id;
  });

  afterAll(async () => {
    await sql`update form_definitions set legacy_form_type = null where key like ${`${tag}-%`}`;
    await sql`delete from rate_limit_buckets where bucket_key = ${`form-builder:${ids.admin}`}`;
    currentEmployee.value = null;
  });

  it('covers every batch', () => {
    expect(forms.map((f) => f.legacyFormType).sort()).toEqual(
      [
        'contract_seal_request',
        'general_seal_request',
        'invoice_seal_request',
        'travel_expense',
        'department_expense',
        'minor_expense',
        'project_expense',
        'revenue_expense',
        'asset_transfer',
        'purchase_request',
        'purchase_order',
      ].sort()
    );
  });

  for (const [i, form] of forms.entries()) {
    it(`${form.name}: opens in the designer, publishes, edits and republishes`, async () => {
      const { runInTransaction } = await import('@/lib/workflow/tx');
      const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
      const { getDesignerData } = await import('@/lib/form-builder/queries');
      const { publishDraft, saveDraft } = await import('@/lib/form-builder/service');
      const { replacementFor } = await import('@/lib/custom-forms/legacy');
      const { getNewFormContext } = await import('@/lib/custom-forms/queries');
      currentEmployee.value = { id: ids.admin, role: 'admin', departmentId: ids.dept };

      const installed = await runInTransaction('test.migrate', async (tx) => ({ ok: true as const, ...(await installMigratedForm(tx, form, ids.admin, 'draft')) }));
      expect(installed).toMatchObject({ ok: true, outcome: 'drafted' });
      const [{ id }] = await sql`select id from form_definitions where key = ${form.key}`;

      const opened = await getDesignerData(id);
      expect(opened).toMatchObject({ hasDraft: true, draftUnreadable: false, published: null, status: 'draft' });
      expect(await replacementFor(form.legacyFormType)).toBeNull();

      expect(await publishDraft(admin(), id, await rowVersion(id))).toMatchObject({ ok: true, published: 1 });
      expect(await replacementFor(form.legacyFormType)).toBe(form.key);

      const live = await getDesignerData(id);
      expect(live).toMatchObject({ hasDraft: false, status: 'published', published: { version: 1 } });
      const schema = clone(live!.schema) as FormSchema;
      const field = schema.sections[0].fields[0];
      field.label = `${field.label}（第 ${i + 1} 張修改）`;
      expect(await saveDraft(admin(), id, { schema, flow: live!.flow }, await rowVersion(id))).toMatchObject({ ok: true });
      expect(await getDesignerData(id)).toMatchObject({ hasDraft: true, draftUnreadable: false });
      expect(await publishDraft(admin(), id, await rowVersion(id))).toMatchObject({ ok: true, published: 2 });

      const [row] = await sql`select status, legacy_form_type from form_definitions where id = ${id}`;
      expect(row).toMatchObject({ status: 'published', legacy_form_type: form.legacyFormType });
      expect(await replacementFor(form.legacyFormType)).toBe(form.key);
      const filing = await getNewFormContext(form.key);
      expect(filing?.schema.sections[0].fields[0].label).toBe(field.label);

      await sql`update form_definitions set legacy_form_type = null where id = ${id}`;
    });
  }
});
