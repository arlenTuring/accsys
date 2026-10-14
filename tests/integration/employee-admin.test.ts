import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AdminActor } from '@/lib/admin/accounts/service';

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();

describe('employee admin: manual add/edit and Excel import (disposable DB)', () => {
  let sql: Sql;
  let admin: AdminActor;
  let dept: { id: string; code: string };
  let otherDept: { id: string; code: string };
  const tag = `EA${Date.now()}`;
  const code = (k: string) => `${tag}-${k}`;
  const employee = async (c: string) => (await sql`select * from employees where employee_code = ${c}`)[0];

  async function workbook(rows: (string | null)[][]) {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('link').addRows([['', '員工編號', '姓名', '部門', '部門代碼', '主管', '職稱'], ...rows]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    sql = await loadSql();
    [dept, otherDept] = await sql`select id, code from departments where active order by code limit 2`;
    const [row] = await sql`insert into employees (employee_code, name, department_id, role) values (${code('admin')}, 'admin', ${dept.id}, 'admin') returning id`;
    admin = { id: row.id, role: 'admin', authenticatedAt: new Date() };
  });

  it('creates and edits an employee manually, with an audit trail of the changes', async () => {
    const { createEmployee, updateEmployee } = await import('@/lib/admin/employees/service');
    const created = await createEmployee(admin, {
      employeeCode: code('m1'),
      name: '手動 一',
      departmentId: dept.id,
      googleEmail: `M1-${tag}@Example.test`,
      phone: '02-1000',
      role: 'finance',
    });
    expect(created).toMatchObject({ ok: true });
    expect(await employee(code('m1'))).toMatchObject({ name: '手動 一', google_email: `m1-${tag}@example.test`.toLowerCase(), role: 'finance', title: null });

    const id = (created as { employeeId: string }).employeeId;
    const updated = await updateEmployee(admin, {
      employeeId: id,
      employeeCode: code('m1'),
      name: '手動 一',
      departmentId: otherDept.id,
      title: '專員',
      googleEmail: `m1-${tag}@example.test`,
      phone: '',
      extension: '123',
    });
    expect(updated).toMatchObject({ ok: true });
    expect(await employee(code('m1'))).toMatchObject({ department_id: otherDept.id, title: '專員', phone: null, extension: '123', role: 'finance' });
    const [audit] = await sql`select details from audit_events where action = 'employee.updated' and entity_id = ${id}`;
    expect(audit.details.changes.map((c: { field: string }) => c.field).sort()).toEqual(['departmentId', 'extension', 'phone', 'title']);
  });

  it('refuses duplicates, admin role, bad input and non-admins', async () => {
    const { createEmployee, updateEmployee } = await import('@/lib/admin/employees/service');
    const base = { employeeCode: code('m2'), name: 'm2', departmentId: dept.id };
    expect(await createEmployee(admin, { ...base, employeeCode: code('admin') })).toMatchObject({ error: 'duplicate_code' });
    expect(await createEmployee(admin, { ...base, googleEmail: `m1-${tag}@example.test` })).toMatchObject({ error: 'duplicate_email' });
    expect(await createEmployee(admin, { ...base, role: 'admin' })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployee(admin, { ...base, googleEmail: 'not-an-email' })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployee(admin, { ...base, name: '' })).toMatchObject({ error: 'invalid_input' });
    expect(await createEmployee({ ...admin, role: 'staff' }, base)).toMatchObject({ error: 'forbidden' });
    const m1 = await employee(code('m1'));
    expect(await updateEmployee(admin, { employeeId: m1.id, ...base, employeeCode: code('admin') })).toMatchObject({ error: 'duplicate_code' });
    expect(await employee(code('m2'))).toBeUndefined();
  });

  it('previews a workbook without writing, then applies only the kept rows', async () => {
    const { previewEmployeeImport, applyEmployeeImport } = await import('@/lib/admin/employees/service');
    const buffer = await workbook([
      [null, code('m1'), '手動 一（改）', null, null, null, null],
      [null, code('x1'), '匯入 一', null, dept.code, null, '工程師'],
      [null, code('x2'), '匯入 二', null, dept.code, null, null],
      [null, code('x3'), '匯入 三', null, 'NO-SUCH-DEPT', null, null],
    ]);
    const preview = await previewEmployeeImport(admin, buffer);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.plan.creates.map((c) => c.employeeCode)).toEqual([code('x1'), code('x2')]);
    expect(preview.plan.updates.map((u) => u.employeeCode)).toEqual([code('m1')]);
    expect(preview.plan.errors.map((e) => e.employeeCode)).toEqual([code('x3')]);
    expect(await employee(code('x1'))).toBeUndefined();

    const changed = await workbook([[null, code('x9'), 'other', null, dept.code, null, null]]);
    expect(await applyEmployeeImport(admin, { buffer: changed, sha256: preview.sha256, include: [code('x9')] })).toMatchObject({ error: 'invalid_state' });

    const applied = await applyEmployeeImport(admin, { buffer, sha256: preview.sha256, include: [code('m1'), code('x1'), code('x3')] });
    expect(applied).toEqual({ ok: true, applied: 2 });
    expect(await employee(code('x1'))).toMatchObject({ name: '匯入 一', department_id: dept.id, title: '工程師', role: 'staff', google_email: null });
    expect(await employee(code('x2'))).toBeUndefined();
    expect(await employee(code('x3'))).toBeUndefined();
    expect(await employee(code('m1'))).toMatchObject({ name: '手動 一（改）', department_id: otherDept.id, title: '專員' });
    const audits = await sql`select details from audit_events where action in ('employee.created', 'employee.updated') and details->>'source' = 'excel' and actor_employee_id = ${admin.id}`;
    expect(audits).toHaveLength(2);
  });

  it('rejects a file without the link sheet', async () => {
    const { previewEmployeeImport } = await import('@/lib/admin/employees/service');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['x']);
    expect(await previewEmployeeImport(admin, Buffer.from(await wb.xlsx.writeBuffer()))).toMatchObject({
      ok: false,
      error: 'invalid_input',
      detail: '找不到工作表「link」',
    });
  });
});
