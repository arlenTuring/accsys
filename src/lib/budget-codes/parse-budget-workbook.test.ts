import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBudgetWorkbook } from './parse-budget-workbook';

function buildWorkbookBuffer(rows: (string | number | null)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '預算編號');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADER = ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'];

describe('parseBudgetWorkbook', () => {
  it('parses a department-scoped row', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115ADSE01', 'AD', null, '人事費', '115', 5000000, '0009'],
    ]);
    expect(parseBudgetWorkbook(buffer)).toEqual([
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

  it('parses a project-scoped row with no owner', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115BD001', null, '115BD001', '專案費用', '115', 300000, null],
    ]);
    expect(parseBudgetWorkbook(buffer)).toEqual([
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

  it('sets annualBudgetAmount to null when the amount cell is not a number', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['115ADSE02', 'AD', null, '租金支出', '115', 'oops', null],
    ]);
    expect(parseBudgetWorkbook(buffer)[0].annualBudgetAmount).toBeNull();
  });

  it('skips rows with an empty budget code and keeps correct row numbers for the rest', () => {
    const buffer = buildWorkbookBuffer([
      HEADER,
      ['', 'AD', null, '人事費', '115', 1000, null],
      ['115ADSE03', 'AD', null, '旅費', '115', 40000, null],
    ]);
    const rows = parseBudgetWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('115ADSE03');
    expect(rows[0].rowNumber).toBe(3);
  });
});
