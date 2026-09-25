import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseBudgetWorkbook } from './parse-budget-workbook';

async function buildWorkbookBuffer(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('預算編號').addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const HEADER = ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'];

describe('parseBudgetWorkbook', () => {
  it('parses a department-scoped row', async () => {
    const buffer = await buildWorkbookBuffer([
      HEADER,
      ['115ADSE01', 'AD', null, '人事費', '115', 5000000, '0009'],
    ]);
    expect(await parseBudgetWorkbook(buffer)).toEqual([
      {
        rowNumber: 2,
        code: '115ADSE01',
        departmentCode: 'AD',
        projectCode: null,
        category: '人事費',
        fiscalYear: '115',
        annualBudgetAmount: 5000000,
        ownerEmployeeCode: '0009',
      },
    ]);
  });

  it('parses a project-scoped row with no owner', async () => {
    const buffer = await buildWorkbookBuffer([
      HEADER,
      ['115BD001', null, '115BD001', '專案費用', '115', 300000, null],
    ]);
    expect(await parseBudgetWorkbook(buffer)).toEqual([
      {
        rowNumber: 2,
        code: '115BD001',
        departmentCode: null,
        projectCode: '115BD001',
        category: '專案費用',
        fiscalYear: '115',
        annualBudgetAmount: 300000,
        ownerEmployeeCode: null,
      },
    ]);
  });

  it('sets annualBudgetAmount to null when the amount cell is not a number', async () => {
    const buffer = await buildWorkbookBuffer([
      HEADER,
      ['115ADSE02', 'AD', null, '租金支出', '115', 'oops', null],
    ]);
    expect((await parseBudgetWorkbook(buffer))[0].annualBudgetAmount).toBeNull();
  });

  it('skips rows with an empty budget code and keeps correct row numbers for the rest', async () => {
    const buffer = await buildWorkbookBuffer([
      HEADER,
      ['', 'AD', null, '人事費', '115', 1000, null],
      ['115ADSE03', 'AD', null, '旅費', '115', 40000, null],
    ]);
    const rows = await parseBudgetWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('115ADSE03');
    expect(rows[0].rowNumber).toBe(3);
  });

  it('uses the cached result of a formula amount cell', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('預算編號');
    sheet.addRow(HEADER);
    sheet.addRow(['115ADSE04', 'AD', null, '人事費', '115', null, null]);
    sheet.getCell('F2').value = { formula: 'SUM(1000,2000)', result: 3000 };
    const rows = await parseBudgetWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(rows[0].annualBudgetAmount).toBe(3000);
  });

  it('rejects a buffer that is not an xlsx file', async () => {
    await expect(parseBudgetWorkbook(Buffer.from('not an excel file'))).rejects.toThrow();
  });
});
