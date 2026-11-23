import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  STANDARD_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from './constants';
import { parseBudgetWorkbook } from './parse-budget-workbook';
import { generateBudgetExcelTemplate } from './templates';
import { normalizeCascadingBudgetItem } from '@/app/components/two-tier-budget-select';

async function buildWorkbookBuffer(rows: (string | number | null)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('預算編號').addRows(rows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const HEADER = ['預算編號', '部門代碼', '專案代碼', '類別', '年度', '年度預算金額', '負責人工號'];

describe('parseBudgetWorkbook & Budget Module (五、預算模組)', () => {
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

  it('parses historical actual amounts when column 8 is present in flat workbook', async () => {
    const buffer = await buildWorkbookBuffer([
      [...HEADER, '歷年實際數(115年)'],
      ['116ADSE03', 'AD', null, '旅費', '116', 150000, '0009', 125000],
    ]);
    const rows = await parseBudgetWorkbook(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: '116ADSE03',
      fiscalYear: '116',
      annualBudgetAmount: 150000,
      historicalActualAmount: 125000,
      historicalFiscalYear: '115',
    });
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

  it('defines all 25 standard corporate account categories (SE01~SE23, SE99, PR01) and builds standard codes', () => {
    expect(STANDARD_ACCOUNT_CATEGORIES.length).toBe(25);
    expect(findStandardAccountCategory('SE03')?.categoryName).toBe('旅費');
    expect(findStandardAccountCategory('69000101')?.itemCode).toBe('SE01');
    expect(findStandardAccountCategory('資訊服務費')?.accountNumber).toBe('69002301');
    expect(buildStandardBudgetCode({ fiscalYear: '2027', unitCode: 'AD', itemCode: 'SE03' })).toBe('116ADSE03');
    expect(buildStandardBudgetCode({ fiscalYear: '116', unitCode: '115BD001', itemCode: 'PR01' })).toBe('115BD001PR01');
  });

  it('generates and round-trips multi-sheet corporate department/project/variance Excel templates', async () => {
    const deptTpl = await generateBudgetExcelTemplate({
      type: 'department',
      fiscalYear: '2027',
      departments: [{ code: 'AD', name: '管理部(AD)' }],
    });
    expect(deptTpl.filename).toBe('2027年度部門預算表-空白V1.xlsx');

    // Fill a monthly amount in the generated department sheet and parse it back
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(deptTpl.buffer as unknown as ArrayBuffer);
    const adSheet = wb.getWorksheet('管理部(AD)');
    expect(adSheet).toBeDefined();
    // Row 4 is SE01 薪資支出(應稅); set Jan (col 6) = 500000 and historical actual (col 5) = 480000
    adSheet!.getRow(4).getCell(5).value = 480000;
    adSheet!.getRow(4).getCell(6).value = 500000;
    adSheet!.getRow(4).getCell(18).value = 500000;

    const filledBuffer = Buffer.from(await wb.xlsx.writeBuffer());
    const parsedRows = await parseBudgetWorkbook(filledBuffer);
    expect(parsedRows.length).toBeGreaterThanOrEqual(1);
    expect(parsedRows[0]).toMatchObject({
      code: '116ADSE01',
      departmentCode: 'AD',
      category: '薪資支出(應稅)',
      fiscalYear: '116',
      annualBudgetAmount: 500000,
      historicalActualAmount: 480000,
      historicalFiscalYear: '115',
    });

    const projTpl = await generateBudgetExcelTemplate({ type: 'project', fiscalYear: '2027' });
    expect(projTpl.filename).toBe('2027年度營收.產品專案預算表-空白V1.xlsx');

    const varTpl = await generateBudgetExcelTemplate({ type: 'variance', fiscalYear: '2027' });
    expect(varTpl.filename).toBe('2027年度預算差異分析表-空白V1.xlsx');
  });

  it('normalizes budget items into two-tier cascading groupName and itemLabel (第 10 條)', () => {
    const parsedColon = normalizeCascadingBudgetItem({
      id: 'b1',
      label: '管理部：吳旭東（旅費｜116ADSE03）',
    });
    expect(parsedColon.groupName).toBe('管理部');
    expect(parsedColon.itemLabel).toBe('吳旭東（旅費｜116ADSE03）');

    const parsedPipe = normalizeCascadingBudgetItem({
      id: 'b2',
      label: '116ADSE01｜管理部｜薪資支出(應稅)',
    });
    expect(parsedPipe.groupName).toBe('管理部');
    expect(parsedPipe.itemLabel).toBe('薪資支出(應稅)（116ADSE01）');
  });
});
