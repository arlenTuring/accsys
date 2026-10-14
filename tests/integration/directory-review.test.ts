import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminActor } from '@/lib/admin/accounts/service';

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('directory review: create employees, apply changes, leavers (disposable DB)', () => {
  let sql: Sql;
  let issuer: string;
  let deptId: string;
  let admin: AdminActor;
  const tag = `DR${Date.now()}`;
  const num = tag.replace(/\D/g, '');
  const dirId = (n: number) => `${num}${n}`;
  const email = (k: string) => `${k}-${tag}@example.test`.toLowerCase();
  const directoryIds: string[] = [];
  const employeeIds: string[] = [];

  const addDirectory = async (n: number, over: Record<string, unknown> = {}) => {
    const row = {
      directory_user_id: dirId(n),
      primary_email: email(`d${n}`),
      full_name: `目錄 ${n}`,
      suspended: false,
      phone: null,
      title: null,
      department: null,
      employee_code: null,
      ...over,
    };
    await sql`insert into directory_users ${sql(row)}`;
    directoryIds.push(row.directory_user_id);
    return row;
  };
  const addEmployee = async (key: string, over: Record<string, unknown> = {}) => {
    const [row] = await sql`insert into employees ${sql({ employee_code: `${tag}-${key}`, name: key, department_id: deptId, ...over })} returning id`;
    employeeIds.push(row.id);
    return row.id as string;
  };
  const bind = (employeeId: string, subject: string, revoked = false) =>
    sql`insert into employee_identities (employee_id, provider, issuer, subject, email, revoked_at)
      values (${employeeId}, 'google', ${issuer}, ${subject}, ${email(subject)}, ${revoked ? sql`now()` : null})`;
  const employee = async (id: string) => (await sql`select * from employees where id = ${id}`)[0];

  beforeAll(async () => {
    sql = await loadSql();
    issuer = (await import('@/lib/directory/service')).directoryIssuer();
    deptId = (await sql`select id from departments where active limit 1`)[0].id;
    const adminId = await addEmployee('admin', { role: 'admin' });
    admin = { id: adminId, role: 'admin', authenticatedAt: new Date() };
  });

  afterAll(async () => {
    await sql`delete from approval_steps where approver_employee_id = any(${employeeIds}::uuid[])`;
    await sql`delete from employee_identities where employee_id = any(${employeeIds}::uuid[])`;
    await sql`delete from directory_users where directory_user_id = any(${directoryIds})`;
  });

  it('creates an employee from the snapshot values, without a login binding', async () => {
    const { createEmployeeFromDirectory } = await import('@/lib/admin/employees/service');
    await addDirectory(1, { full_name: '新人 一', phone: '02-1111 #21', title: '工程師' });
    const r = await createEmployeeFromDirectory(admin, { directoryUserId: dirId(1), employeeCode: `${tag}-n1`, departmentId: deptId });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    employeeIds.push(r.employeeId!);
    expect(await employee(r.employeeId!)).toMatchObject({
      name: '新人 一',
      google_email: email('d1'),
      phone: '02-1111',
      extension: '21',
      title: '工程師',
      role: 'staff',
      access_enabled: true,
    });
    const identities = await sql`select id from employee_identities where employee_id = ${r.employeeId!}`;
    expect(identities).toHaveLength(0);
    const [audit] = await sql`select actor_employee_id, details from audit_events where action = 'employee.created' and entity_id = ${r.employeeId!}`;
    expect(audit.actor_employee_id).toBe(admin.id);
    expect(audit.details).toMatchObject({ source: 'directory', directoryUserId: dirId(1) });

    // same Workspace account again: its email now belongs to an employee
    const again = await createEmployeeFromDirectory(admin, { directoryUserId: dirId(1), employeeCode: `${tag}-n1b`, departmentId: deptId });
    expect(again).toMatchObject({ ok: false, error: 'duplicate_email' });
  });

  it('refuses bad input, taken codes, suspended or bound accounts, admin role and non-admin actors', async () => {
    const { createEmployeeFromDirectory } = await import('@/lib/admin/employees/service');
    await addDirectory(2);
    await addDirectory(3, { suspended: true });
    await addDirectory(4);
    await bind(await addEmployee('bound4'), dirId(4), true);
    const base = { directoryUserId: dirId(2), employeeCode: `${tag}-n2`, departmentId: deptId };
    expect(await createEmployeeFromDirectory(admin, { ...base, employeeCode: `${tag}-admin` })).toMatchObject({ error: 'duplicate_code' });
    expect(await createEmployeeFromDirectory(admin, { ...base, directoryUserId: dirId(3) })).toMatchObject({ error: 'invalid_state' });
    expect(await createEmployeeFromDirectory(admin, { ...base, directoryUserId: dirId(4) })).toMatchObject({ error: 'invalid_state' });
    expect(await createEmployeeFromDirectory(admin, { ...base, role: 'admin' })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployeeFromDirectory(admin, { ...base, employeeCode: 'bad code!' })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployeeFromDirectory(admin, { ...base, departmentId: randomUUID() })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployeeFromDirectory({ ...admin, role: 'finance' }, base)).toMatchObject({ error: 'forbidden' });
    expect(
      await createEmployeeFromDirectory({ ...admin, authenticatedAt: new Date(Date.now() - 20 * 60_000) }, base)
    ).toMatchObject({ error: 'reauth_required' });
    const [n] = await sql`select count(*)::int as n from employees where employee_code = ${`${tag}-n2`}`;
    expect(n.n).toBe(0);
  });

  it('applies only the chosen fields, with values re-read from the snapshot', async () => {
    const { applyDirectoryChanges } = await import('@/lib/admin/employees/service');
    await addDirectory(5, { full_name: '五 王', primary_email: email('five-new'), phone: '02-5555', title: '經理' });
    const id = await addEmployee('five', { name: '王五', google_email: email('five-old'), title: '專員' });
    await bind(id, dirId(5));

    const r = await applyDirectoryChanges(admin, { items: [{ employeeId: id, directoryUserId: dirId(5), fields: ['phone', 'title', 'name'] }] });
    expect(r).toEqual({ ok: true, applied: 1 });
    // name "五 王" is the same person as 王五 (given-family order), so it is not a change
    expect(await employee(id)).toMatchObject({ name: '王五', phone: '02-5555', title: '經理', google_email: email('five-old') });
    const [audit] = await sql`select details from audit_events where action = 'employee.directory_updated' and entity_id = ${id}`;
    expect(audit.details.changes).toEqual([
      { field: 'phone', from: null, to: '02-5555' },
      { field: 'title', from: '專員', to: '經理' },
    ]);

    // nothing left for those fields: skipped, not an error
    expect(await applyDirectoryChanges(admin, { items: [{ employeeId: id, directoryUserId: dirId(5), fields: ['phone'] }] })).toEqual({ ok: true, applied: 0 });
    expect(await applyDirectoryChanges(admin, { items: [{ employeeId: id, directoryUserId: dirId(5), fields: ['department'] }] })).toMatchObject({ error: 'invalid_input' });
  });

  it('only updates employees linked to that account; before the first login, by the same email or code', async () => {
    const { applyDirectoryChanges } = await import('@/lib/admin/employees/service');
    await addDirectory(6, { employee_code: `${tag}-six`, phone: '02-6666' });
    const six = await addEmployee('six');
    const stranger = await addEmployee('stranger');
    const elsewhere = await addEmployee('elsewhere', { google_email: email('d6') });
    await bind(elsewhere, `${num}99`);

    expect(await applyDirectoryChanges(admin, { items: [{ employeeId: stranger, directoryUserId: dirId(6), fields: ['phone'] }] })).toMatchObject({ error: 'invalid_state' });
    expect(await applyDirectoryChanges(admin, { items: [{ employeeId: elsewhere, directoryUserId: dirId(6), fields: ['phone'] }] })).toMatchObject({ error: 'invalid_state' });
    expect(await applyDirectoryChanges(admin, { items: [{ employeeId: six, directoryUserId: dirId(6), fields: ['phone'] }] })).toEqual({ ok: true, applied: 1 });
    expect((await employee(six)).phone).toBe('02-6666');
    expect((await employee(stranger)).phone).toBeNull();
  });

  it('a batch is all-or-nothing when an email is already taken', async () => {
    const { applyDirectoryChanges } = await import('@/lib/admin/employees/service');
    await addDirectory(7, { phone: '02-7777' });
    await addDirectory(8, { primary_email: email('taken') });
    const seven = await addEmployee('seven');
    const eight = await addEmployee('eight');
    await addEmployee('owner', { google_email: email('taken') });
    await bind(seven, dirId(7));
    await bind(eight, dirId(8));
    const r = await applyDirectoryChanges(admin, {
      items: [
        { employeeId: seven, directoryUserId: dirId(7), fields: ['phone'] },
        { employeeId: eight, directoryUserId: dirId(8), fields: ['email'] },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: 'duplicate_email' });
    expect((await employee(seven)).phone).toBeNull();
  });

  it('the review page lists the leaver with their pending approval steps for handover', async () => {
    const { getDirectoryPageData } = await import('@/lib/admin/directory/queries');
    await addDirectory(9, { suspended: true });
    const nine = await addEmployee('nine');
    await bind(nine, dirId(9), true);
    const formId = randomUUID();
    await sql`insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status, step_label)
      values ('purchase_request', ${formId}, 1, ${nine}, 'department_manager', 'pending', '部門主管')`;

    const data = await getDirectoryPageData();
    const leaver = data.leavers.find((l) => l.employeeId === nine);
    expect(leaver).toMatchObject({ reason: 'suspended', pendingSteps: [{ formType: 'purchase_request', formId, stepLabel: '部門主管' }] });
    expect(data.newHires.some((h) => h.directoryUserId === dirId(9))).toBe(false);
    expect(data.newHires.find((h) => h.directoryUserId === dirId(2))).toMatchObject({ match: null });
  });

  it('the page shows the sync mode, Workspace authorization from the latest Workspace run, and the manager as a hint', async () => {
    const { getDirectoryPageData } = await import('@/lib/admin/directory/queries');
    await addDirectory(10, { department: '目錄部門', manager_email: email('boss') });
    await sql`insert into directory_sync_runs (source, status) values ('fixture', 'succeeded')`;
    await sql`insert into directory_sync_runs (source, status, error, finished_at) values ('directory', 'failed', ${`token expired ${tag}`}, now())`;
    await sql`insert into directory_sync_runs (source, status, finished_at) values ('fixture', 'succeeded', now() + interval '1 second')`;

    const data = await getDirectoryPageData();
    expect(data.syncMode).toBe(process.env.AUTH_MODE?.trim() || 'manual');
    expect(data.lastDirectoryRun).toMatchObject({ source: 'directory', status: 'failed', error: `token expired ${tag}` });
    expect(data.newHires.find((h) => h.directoryUserId === dirId(10))).toMatchObject({ department: '目錄部門', managerEmail: email('boss') });
    expect(data.jobRoles.length).toBeGreaterThan(0);
    expect(data.jobRoles.every((r) => typeof r.isSystem === 'boolean')).toBe(true);
  });

  it('a new hire can be given a job role right after being created (org service, audited)', async () => {
    const { createEmployeeFromDirectory } = await import('@/lib/admin/employees/service');
    const { addRoleHolder } = await import('@/lib/admin/org/service');
    const { getEmployeeAdminData } = await import('@/lib/admin/employees/queries');
    await addDirectory(11);
    const [role] = await sql`insert into job_roles (code, name) values (${`dr_${num}`}, ${`測試職務 ${tag}`}) returning id`;

    const created = await createEmployeeFromDirectory(admin, { directoryUserId: dirId(11), employeeCode: `${tag}-n11`, departmentId: deptId });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    employeeIds.push(created.employeeId!);
    expect(await addRoleHolder(admin, { jobRoleId: role.id, employeeId: created.employeeId, departmentId: deptId })).toEqual({ ok: true });

    const row = (await getEmployeeAdminData()).employees.find((e) => e.id === created.employeeId);
    expect(row?.jobRoles).toEqual([
      expect.objectContaining({ jobRoleId: role.id, departmentId: deptId, isPrimary: true }),
    ]);
    const [audit] = await sql`select details from audit_events where action = 'org.job_role.holder_added' and entity_id = ${role.id}`;
    expect(audit.details).toMatchObject({ employeeId: created.employeeId, departmentId: deptId });
  });
});
