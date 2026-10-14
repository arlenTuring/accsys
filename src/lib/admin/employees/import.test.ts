import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseEmployeeWorkbook, planEmployeeImport, type EmployeeSheetRow } from './import';

async function workbook(sheet: string, rows: (string | number | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet(sheet).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const HEADER = ['', '員工編號', '姓名', '部門', '部門代碼', '主管', '職稱'];

describe('parseEmployeeWorkbook', () => {
  it('reads columns B–G of the "link" sheet and skips rows without a code', async () => {
    const buffer = await workbook('link', [HEADER, [null, 'E001', ' 王小明 ', '研發部', 'RD', '李主管', '工程師'], [null, null, '空白列']]);
    expect(await parseEmployeeWorkbook(buffer)).toEqual([
      { rowNumber: 2, employeeCode: 'E001', name: '王小明', departmentName: '研發部', departmentCode: 'RD', managerName: '李主管', title: '工程師' },
    ]);
  });

  it('rejects a workbook without the "link" sheet, and non-Excel data', async () => {
    await expect(parseEmployeeWorkbook(await workbook('Sheet1', [HEADER]))).rejects.toThrow('missing_link_sheet');
    await expect(parseEmployeeWorkbook(Buffer.from('not an excel file'))).rejects.toThrow();
  });
});

describe('planEmployeeImport', () => {
  const departments = [
    { id: 'd-rd', code: 'RD', name: '研發部' },
    { id: 'd-ad', code: 'AD', name: '管理部' },
    { id: 'd-x1', code: 'X1', name: '重複' },
    { id: 'd-x2', code: 'X2', name: '重複' },
  ];
  const employees = [{ id: 'e1', employeeCode: 'E001', name: '王小明', departmentId: 'd-rd', title: '工程師' }];
  const row = (n: number, over: Partial<EmployeeSheetRow>): EmployeeSheetRow => ({
    rowNumber: n,
    employeeCode: '',
    name: '',
    departmentName: '',
    departmentCode: '',
    managerName: '',
    title: '',
    ...over,
  });

  it('plans creates, updates and unchanged rows; blank cells never clear values', () => {
    const plan = planEmployeeImport(
      [
        row(2, { employeeCode: 'E001', name: '王小明', departmentCode: 'AD' }),
        row(3, { employeeCode: 'E002', name: '陳新人', departmentName: '研發部', title: '助理' }),
        row(4, { employeeCode: 'E001', name: '重複' }),
      ],
      employees,
      departments
    );
    expect(plan.updates).toEqual([
      {
        rowNumber: 2,
        employeeId: 'e1',
        employeeCode: 'E001',
        name: '王小明',
        departmentId: 'd-ad',
        title: '工程師',
        changes: [{ field: 'department', current: 'RD 研發部', next: 'AD 管理部' }],
      },
    ]);
    expect(plan.creates).toEqual([{ rowNumber: 3, employeeCode: 'E002', name: '陳新人', departmentId: 'd-rd', departmentLabel: 'RD 研發部', title: '助理' }]);
    expect(plan.errors).toEqual([{ rowNumber: 4, employeeCode: 'E001', reason: '員工編號在工作表中重複' }]);
    expect(planEmployeeImport([row(2, { employeeCode: 'E001' })], employees, departments).unchanged).toBe(1);
  });

  it('reports unknown or ambiguous departments, bad codes and incomplete new rows instead of guessing', () => {
    const plan = planEmployeeImport(
      [
        row(2, { employeeCode: 'E010', name: 'a', departmentCode: 'ZZ' }),
        row(3, { employeeCode: 'E011', name: 'b', departmentName: '重複' }),
        row(4, { employeeCode: 'bad code', name: 'c', departmentCode: 'RD' }),
        row(5, { employeeCode: 'E012', departmentCode: 'RD' }),
      ],
      employees,
      departments
    );
    expect(plan.creates).toEqual([]);
    expect(plan.errors.map((e) => e.rowNumber)).toEqual([2, 3, 4, 5]);
    expect(plan.errors[0].reason).toContain('找不到部門代碼 ZZ');
  });
});
