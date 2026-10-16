import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => null }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const service = () => import('@/lib/admin/access-roles/service');

describe('access roles (/admin/org/access-roles)', () => {
  let sql: Sql;
  const tag = `ar${Date.now()}`;
  const ids = {} as Record<'admin' | 'staff', string>;
  const admin = () => ({ id: ids.admin, role: 'admin', authenticatedAt: new Date() });
  const ok = <T extends { ok: boolean }>(r: T) => {
    if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
    return r as Extract<T, { ok: true }>;
  };

  beforeAll(async () => {
    sql = await loadSql();
    const [dept] = await sql`select id from departments where active limit 1`;
    ids.admin = (
      await sql`insert into employees (employee_code, name, department_id, role) values (${`${tag}-a`}, '權限管理員', ${dept.id}, 'admin') returning id`
    )[0].id as string;
    ids.staff = (
      await sql`insert into employees (employee_code, name, department_id, role) values (${`${tag}-s`}, '權限員工', ${dept.id}, 'staff') returning id`
    )[0].id as string;
  });

  afterAll(async () => {
    // Leave employees / audit rows (audit is append-only for the app role); disposable DB is wiped by compose.
    await sql`delete from rate_limit_buckets where bucket_key = ${`access-roles:${ids.admin}`}`;
    await sql`update employees set role = 'staff' where id = ${ids.staff}`;
    await sql`delete from access_role_permissions where role_id in (select id from access_roles where code like ${`${tag}_%`})`;
    await sql`delete from access_roles where code like ${`${tag}_%`}`;
  });

  it('creates a role with permissions, edits them, and refuses reserved codes / staff without capability', async () => {
    const { saveAccessRole, setAccessRoleActive } = await service();
    expect(await saveAccessRole({ id: ids.staff, role: 'staff', authenticatedAt: new Date() }, null, { code: `${tag}_x`, name: 'x', permissions: [] })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await saveAccessRole(admin(), null, { code: 'admin', name: '假管理員', permissions: ['forms.design'] })).toMatchObject({ ok: false, code: 'validation' });

    const created = ok(
      await saveAccessRole(admin(), null, {
        code: `${tag}_owner`,
        name: '表單負責人',
        description: '設計與刪除',
        permissions: ['forms.design', 'forms.delete'],
      })
    );
    const [row] = await sql`select code, name, is_system, active, version from access_roles where id = ${created.id}`;
    expect(row).toMatchObject({ code: `${tag}_owner`, name: '表單負責人', is_system: false, active: true, version: 1 });
    const perms = await sql`select permission from access_role_permissions where role_id = ${created.id} order by permission`;
    expect(perms.map((p) => p.permission)).toEqual(['forms.delete', 'forms.design']);

    ok(await saveAccessRole(admin(), created.id, { name: '表單負責人二', description: '', permissions: ['forms.design', 'org.manage'] }, 1));
    const after = await sql`select permission from access_role_permissions where role_id = ${created.id} order by permission`;
    expect(after.map((p) => p.permission)).toEqual(['forms.design', 'org.manage']);

    // Assign an employee, then deactivating must fail until cleared.
    await sql`update employees set role = ${`${tag}_owner`} where id = ${ids.staff}`;
    expect(await setAccessRoleActive(admin(), created.id, false, 2)).toMatchObject({ ok: false, code: 'conflict' });
    await sql`update employees set role = 'staff' where id = ${ids.staff}`;
    ok(await setAccessRoleActive(admin(), created.id, false, 2));
    expect((await sql`select active from access_roles where id = ${created.id}`)[0].active).toBe(false);

    const [adminRole] = await sql`select id, version from access_roles where code = 'admin'`;
    expect(await saveAccessRole(admin(), adminRole.id, { name: '系統管理員', permissions: [] }, adminRole.version)).toMatchObject({ ok: false, code: 'validation' });
  });
});
