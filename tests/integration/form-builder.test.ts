import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emptyFlow } from '@/lib/form-builder/blank';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const builder = () => import('@/lib/form-builder/service');

describe('form designer (/admin/form-builder)', () => {
  let sql: Sql;
  const tag = `fb${Date.now()}`;
  const ids = {} as Record<'admin' | 'staff' | 'mgr' | 'dept', string>;
  const submissionIds: string[] = [];
  const admin = () => ({ id: ids.admin, role: 'admin', authenticatedAt: new Date() });
  const ok = <T extends { ok: boolean }>(r: T) => {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
  };
  const rowVersion = async (id: string) => Number((await sql`select version from form_definitions where id = ${id}`)[0].version);
  const settings = (key: string) => ({ key, name: '測試表單', categoryKey: 'general', numberPrefix: 'TB', visibility: {} });
  const schemaV1 = {
    version: 1,
    sections: [{ id: 'main', title: '內容', description: '', fields: [{ id: 'subject', type: 'text', label: '主旨', required: true, width: 4, maxLength: 100 }] }],
  };

  beforeAll(async () => {
    sql = await loadSql();
    const [anyDept] = await sql`select id from departments where active limit 1`;
    const employee = async (name: string, deptId: string, role = 'staff') =>
      (await sql`insert into employees (employee_code, name, department_id, role) values (${`${tag}-${name}`}, ${name}, ${deptId}, ${role}) returning id`)[0]
        .id as string;
    ids.admin = await employee('admin', anyDept.id, 'admin');
    ids.mgr = await employee('設計器主管', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '設計器測試部', ${ids.mgr}) returning id`)[0].id;
    ids.staff = await employee('staff', ids.dept);
  });

  afterAll(async () => {
    if (submissionIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    await sql`delete from rate_limit_buckets where bucket_key = ${`form-builder:${ids.admin}`}`;
  });

  it('allows only a recently signed-in admin who is still an admin in the database', async () => {
    const { createDefinition, simulateDraft } = await builder();
    const input = settings(`${tag}-authz`);
    expect(await createDefinition(null, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await createDefinition({ id: ids.staff, role: 'staff', authenticatedAt: new Date() }, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await createDefinition({ ...admin(), authenticatedAt: new Date(Date.now() - 2 * 3600_000) }, input)).toMatchObject({ ok: false, code: 'reauth_required' });
    expect(await createDefinition({ id: ids.staff, role: 'admin', authenticatedAt: new Date() }, input)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await simulateDraft({ id: ids.staff, role: 'admin', authenticatedAt: new Date() }, {})).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await sql`select count(*)::int as n from form_definitions where key = ${input.key}`)[0].n).toBe(0);
  });

  it('creates drafts, keeps keys unique and detects concurrent edits', async () => {
    const { createDefinition, saveDraft } = await builder();
    const a = ok(await createDefinition(admin(), settings(`${tag}-a`)));
    expect(await createDefinition(admin(), settings(`${tag}-a`))).toMatchObject({ ok: false, code: 'conflict' });
    expect(await createDefinition(admin(), { ...settings(`${tag}-b`), categoryKey: 'no_such' })).toMatchObject({ ok: false, code: 'validation' });
    expect(await createDefinition(admin(), { ...settings(`${tag}-b`), visibility: { departmentIds: [crypto.randomUUID()] } })).toMatchObject({
      ok: false,
      code: 'validation',
    });

    const v = await rowVersion(a.id);
    // Incomplete drafts are stored; shapes the editor cannot load are not.
    const incomplete = { schema: { version: 1, sections: [{ id: 'main', title: '', description: '', fields: [] }] }, flow: emptyFlow() };
    const saved = ok(await saveDraft(admin(), a.id, incomplete, v));
    expect(saved.version).toBe(v + 1);
    expect(await saveDraft(admin(), a.id, incomplete, v)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await saveDraft(admin(), a.id, { schema: { version: 1, sections: 'x' }, flow: emptyFlow() }, v + 1)).toMatchObject({ ok: false, code: 'validation' });
    const [{ n }] = await sql`select count(*)::int as n from audit_events where action = 'form_definition.draft_saved' and entity_id = ${a.id}`;
    expect(n).toBe(1);
  });

  it('publishes only valid drafts, keeps field types stable and leaves old submissions on their version', async () => {
    const { createDefinition, saveDraft, publishDraft } = await builder();
    const key = `${tag}-pub`;
    const d = ok(await createDefinition(admin(), settings(key)));

    ok(await saveDraft(admin(), d.id, { schema: { version: 1, sections: [{ id: 'main', title: '', description: '', fields: [] }] }, flow: emptyFlow() }, await rowVersion(d.id)));
    expect(await publishDraft(admin(), d.id, await rowVersion(d.id))).toMatchObject({ ok: false, code: 'validation' });
    expect((await sql`select count(*)::int as n from form_definition_versions where definition_id = ${d.id}`)[0].n).toBe(0);

    ok(await saveDraft(admin(), d.id, { schema: schemaV1, flow: emptyFlow() }, await rowVersion(d.id)));
    const v1 = ok(await publishDraft(admin(), d.id, await rowVersion(d.id)));
    expect(v1.published).toBe(1);
    const [row] = await sql`select status, draft_schema, draft_flow, version from form_definitions where id = ${d.id}`;
    expect(row).toMatchObject({ status: 'published', draft_schema: null, draft_flow: null });
    expect(Number(row.version)).toBe(v1.version);
    expect(await publishDraft(admin(), d.id, v1.version)).toMatchObject({ ok: false, code: 'conflict' });

    const service = await import('@/lib/custom-forms/service');
    const sub = await service.createSubmission({ id: ids.staff }, key, { data: { subject: '第一版' }, idempotencyKey: crypto.randomUUID(), fileCount: 0 });
    if (!sub.ok) throw new Error(JSON.stringify(sub));
    submissionIds.push(sub.submissionId);
    const [{ version_id: firstVersionId }] = await sql`select version_id from form_submissions where id = ${sub.submissionId}`;

    const retyped = structuredClone(schemaV1) as { sections: { fields: Record<string, unknown>[] }[] };
    retyped.sections[0].fields[0] = { id: 'subject', type: 'number', label: '主旨', width: 4 };
    ok(await saveDraft(admin(), d.id, { schema: retyped, flow: emptyFlow() }, await rowVersion(d.id)));
    const refused = await publishDraft(admin(), d.id, await rowVersion(d.id));
    expect(refused).toMatchObject({ ok: false, code: 'validation' });
    if (!refused.ok) expect(refused.error).toContain('主旨');

    const v2Schema = structuredClone(schemaV1) as { sections: { fields: Record<string, unknown>[] }[] };
    v2Schema.sections[0].fields.push({ id: 'note', type: 'textarea', label: '備註', width: 4 });
    ok(await saveDraft(admin(), d.id, { schema: v2Schema, flow: emptyFlow() }, await rowVersion(d.id)));
    expect(ok(await publishDraft(admin(), d.id, await rowVersion(d.id))).published).toBe(2);
    const [{ version_id: stillFirst }] = await sql`select version_id from form_submissions where id = ${sub.submissionId}`;
    expect(stillFirst).toBe(firstVersionId);
    const audits = await sql`select details from audit_events where action = 'form_definition.published' and entity_id = ${d.id} order by id`;
    expect(audits.map((a) => a.details.version)).toEqual([1, 2]);
  });

  it('fixes the key after publishing, archives, unarchives and deletes only unpublished forms', async () => {
    const { createDefinition, saveDraft, publishDraft, saveSettings, setArchived, deleteDraftDefinition, discardDraft } = await builder();
    const key = `${tag}-life`;
    const d = ok(await createDefinition(admin(), settings(key)));
    ok(await saveSettings(admin(), d.id, { ...settings(`${key}2`), name: '改名前' }, await rowVersion(d.id)));
    ok(await saveDraft(admin(), d.id, { schema: schemaV1, flow: emptyFlow() }, await rowVersion(d.id)));
    ok(await publishDraft(admin(), d.id, await rowVersion(d.id)));

    expect(await saveSettings(admin(), d.id, settings(`${key}3`), await rowVersion(d.id))).toMatchObject({ ok: false, code: 'validation' });
    ok(await saveSettings(admin(), d.id, { ...settings(`${key}2`), name: '改名後', visibility: { departmentIds: [ids.dept] } }, await rowVersion(d.id)));
    const [audit] = await sql`select details from audit_events where action = 'form_definition.settings_updated' and entity_id = ${d.id} order by id desc limit 1`;
    expect(audit.details).toMatchObject({ before: { name: '改名前' }, after: { name: '改名後', visibility: { departmentIds: [ids.dept] } } });

    expect(await deleteDraftDefinition(admin(), d.id, await rowVersion(d.id))).toMatchObject({ ok: false, code: 'conflict' });
    expect(await discardDraft(admin(), d.id, await rowVersion(d.id))).toMatchObject({ ok: true });

    ok(await setArchived(admin(), d.id, true, await rowVersion(d.id)));
    const service = await import('@/lib/custom-forms/service');
    const blocked = await service.createSubmission({ id: ids.staff }, `${key}2`, { data: { subject: 'x' }, idempotencyKey: crypto.randomUUID(), fileCount: 0 });
    expect(blocked).toMatchObject({ ok: false, code: 'not_found' });
    expect(await setArchived(admin(), d.id, true, await rowVersion(d.id))).toMatchObject({ ok: false, code: 'conflict' });
    ok(await setArchived(admin(), d.id, false, await rowVersion(d.id)));
    expect((await sql`select status from form_definitions where id = ${d.id}`)[0].status).toBe('published');

    const draftOnly = ok(await createDefinition(admin(), settings(`${tag}-gone`)));
    expect(await discardDraft(admin(), draftOnly.id, await rowVersion(draftOnly.id))).toMatchObject({ ok: false, code: 'validation' });
    ok(await deleteDraftDefinition(admin(), draftOnly.id, await rowVersion(draftOnly.id)));
    expect((await sql`select count(*)::int as n from form_definitions where id = ${draftOnly.id}`)[0].n).toBe(0);
  });

  it('simulates the unsaved definition read-only', async () => {
    const { simulateDraft } = await builder();
    const flow = {
      version: 1,
      blocks: [
        {
          id: 'c1',
          type: 'condition',
          label: '金額',
          branches: [{ id: 'br1', label: '大額', when: { all: [{ field: 'amount', op: 'gt', value: 1000 }] }, blocks: [{ id: 'b1', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 } }] }],
          otherwise: { label: '其他', blocks: [] },
        },
      ],
      options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' },
    };
    const schema = { version: 1, sections: [{ id: 'main', title: '', description: '', fields: [{ id: 'amount', type: 'money', label: '金額', width: 2 }] }] };
    const audits = () => sql`select count(*)::int as n from audit_events where actor_employee_id = ${ids.admin}`;
    const before = (await audits())[0].n;
    const big = ok(await simulateDraft(admin(), { key: `${tag}-sim`, schema, flow, applicantId: ids.staff, fields: { amount: 5000 } }));
    expect(big.simulation).toMatchObject({ ok: true, steps: [{ label: '主管', approverName: '設計器主管', status: 'pending' }] });
    const small = ok(await simulateDraft(admin(), { key: `${tag}-sim`, schema, flow, applicantId: ids.staff, fields: { amount: 10 } }));
    expect(small.simulation).toMatchObject({ ok: true, steps: [], autoApproved: true });
    expect(await simulateDraft(admin(), { schema, flow: { ...flow, blocks: 'x' }, applicantId: ids.staff })).toMatchObject({ ok: false, code: 'validation' });
    expect((await audits())[0].n).toBe(before);
  });
});
