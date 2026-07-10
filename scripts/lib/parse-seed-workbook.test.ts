import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSeedWorkbook } from './parse-seed-workbook';

const FIXTURE_PATH = path.join(
  process.cwd(),
  'reference',
  '20260709_請採驗費用申請單.xlsx'
);

describe('parseSeedWorkbook', () => {
  const result = parseSeedWorkbook(FIXTURE_PATH);

  it('parses all 39 employees from the link sheet', () => {
    expect(result.employees).toHaveLength(39);
  });

  it('parses employee fields correctly for a known row', () => {
    const chairman = result.employees.find((e) => e.employeeCode === '0001');
    expect(chairman).toEqual({
      employeeCode: '0001',
      name: '陳維隆',
      departmentName: '董事長室',
      departmentCode: 'CO',
      managerName: '陳維隆',
      title: '董事長',
    });
  });

  it('parses all 293 unique budget codes', () => {
    const uniqueCodes = new Set(result.budgetCodes.map((b) => b.code));
    expect(uniqueCodes.size).toBe(293);
  });

  it('parses budget code fields correctly for a known row', () => {
    const budget = result.budgetCodes.find((b) => b.code === '115ADSE01');
    expect(budget).toEqual({
      code: '115ADSE01',
      departmentCode: 'AD',
      category: '人事費',
      fiscalYear: '115',
      annualBudgetAmount: -4063966,
    });
  });

  it('parses all 4 suppliers', () => {
    expect(result.suppliers).toHaveLength(4);
    expect(result.suppliers.map((s) => s.name)).toEqual([
      '中華電信',
      '遠傳',
      '台灣大哥大',
      '台灣之星',
    ]);
  });

  it('parses supplier contact fields', () => {
    const supplier = result.suppliers.find((s) => s.name === '中華電信');
    expect(supplier).toEqual({
      name: '中華電信',
      phone: '02-2706-6918#6988',
      email: 'summer797731@gmail.com',
      contactName: '王先生',
    });
  });
});
