import { createHash } from 'node:crypto';
import { loadWorkbook, readRows, type CellPrimitive } from '@/lib/excel/read-rows';
import { checkZipArchive } from '@/lib/excel/zip-guard';

/**
 * Employee import from the company workbook, sheet "link", same columns as the
 * seed script (scripts/lib/parse-seed-workbook.ts): B code, C name,
 * D department name, E department code, F manager name, G title.
 * Used before Workspace sync is authorized; the admin reviews the plan first.
 */
export const MAX_EMPLOYEE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_EMPLOYEE_ROWS = 5000;
export const EMPLOYEE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export class WorkbookRejected extends Error {}

export type EmployeeSheetRow = {
  rowNumber: number;
  employeeCode: string;
  name: string;
  departmentName: string;
  departmentCode: string;
  managerName: string;
  title: string;
};

const cell = (row: CellPrimitive[], index: number) => String(row[index] ?? '').trim();

export const workbookHash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

export async function parseEmployeeWorkbook(buffer: Buffer): Promise<EmployeeSheetRow[]> {
  if (buffer.length > MAX_EMPLOYEE_FILE_BYTES) throw new WorkbookRejected('file_too_large');
  const zip = checkZipArchive(buffer);
  if (!zip.ok) throw new WorkbookRejected(zip.reason);
  const workbook = await loadWorkbook(buffer);
  const sheet = workbook.getWorksheet('link');
  if (!sheet) throw new WorkbookRejected('missing_link_sheet');
  const rows = readRows(sheet).slice(1);
  if (rows.length > MAX_EMPLOYEE_ROWS) throw new WorkbookRejected('too_many_rows');
  return rows
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      employeeCode: cell(cells, 1),
      name: cell(cells, 2),
      departmentName: cell(cells, 3),
      departmentCode: cell(cells, 4),
      managerName: cell(cells, 5),
      title: cell(cells, 6),
    }))
    .filter((r) => r.employeeCode !== '');
}

export type ImportEmployee = { id: string; employeeCode: string; name: string; departmentId: string; title: string | null };
export type ImportDepartment = { id: string; code: string; name: string };

export type ImportField = 'name' | 'department' | 'title';
export type ImportChange = { field: ImportField; current: string | null; next: string };

export type ImportPlan = {
  creates: { rowNumber: number; employeeCode: string; name: string; departmentId: string; departmentLabel: string; title: string | null }[];
  updates: { rowNumber: number; employeeId: string; employeeCode: string; name: string; departmentId: string; title: string | null; changes: ImportChange[] }[];
  unchanged: number;
  errors: { rowNumber: number; employeeCode: string; reason: string }[];
};

/**
 * What applying the sheet would do. Departments are matched by code, then by a
 * unique name, and never created here. Blank cells never clear a value, and
 * employees missing from the sheet are left alone (no disabling).
 */
export function planEmployeeImport(rows: EmployeeSheetRow[], employees: ImportEmployee[], departments: ImportDepartment[]): ImportPlan {
  const byCode = new Map(employees.map((e) => [e.employeeCode, e]));
  const deptByCode = new Map(departments.map((d) => [d.code, d]));
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const deptByName = new Map<string, ImportDepartment | null>();
  for (const d of departments) deptByName.set(d.name, deptByName.has(d.name) ? null : d);
  const label = (d: ImportDepartment) => `${d.code} ${d.name}`;

  const plan: ImportPlan = { creates: [], updates: [], unchanged: 0, errors: [] };
  const seen = new Set<string>();
  for (const r of rows) {
    const error = (reason: string) => plan.errors.push({ rowNumber: r.rowNumber, employeeCode: r.employeeCode, reason });
    if (!EMPLOYEE_CODE.test(r.employeeCode)) {
      error('員工編號格式不正確');
      continue;
    }
    if (seen.has(r.employeeCode)) {
      error('員工編號在工作表中重複');
      continue;
    }
    seen.add(r.employeeCode);
    if (r.name.length > 100 || r.title.length > 100) {
      error('姓名或職稱過長');
      continue;
    }
    let dept: ImportDepartment | null | undefined = null;
    if (r.departmentCode) {
      dept = deptByCode.get(r.departmentCode);
      if (!dept) {
        error(`找不到部門代碼 ${r.departmentCode}（請先在「部門」頁建立）`);
        continue;
      }
    } else if (r.departmentName) {
      dept = deptByName.get(r.departmentName);
      if (!dept) {
        error(`部門「${r.departmentName}」不存在或名稱重複，請填部門代碼`);
        continue;
      }
    }

    const existing = byCode.get(r.employeeCode);
    if (!existing) {
      if (!r.name || !dept) {
        error('新員工需要姓名與部門');
        continue;
      }
      plan.creates.push({ rowNumber: r.rowNumber, employeeCode: r.employeeCode, name: r.name, departmentId: dept.id, departmentLabel: label(dept), title: r.title || null });
      continue;
    }
    const changes: ImportChange[] = [];
    if (r.name && r.name !== existing.name) changes.push({ field: 'name', current: existing.name, next: r.name });
    if (dept && dept.id !== existing.departmentId) {
      const current = deptById.get(existing.departmentId);
      changes.push({ field: 'department', current: current ? label(current) : null, next: label(dept) });
    }
    if (r.title && r.title !== (existing.title ?? '')) changes.push({ field: 'title', current: existing.title, next: r.title });
    if (changes.length === 0) {
      plan.unchanged++;
      continue;
    }
    plan.updates.push({
      rowNumber: r.rowNumber,
      employeeId: existing.id,
      employeeCode: r.employeeCode,
      name: r.name || existing.name,
      departmentId: dept?.id ?? existing.departmentId,
      title: r.title || existing.title,
      changes,
    });
  }
  return plan;
}
