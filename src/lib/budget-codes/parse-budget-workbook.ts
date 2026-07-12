import * as XLSX from 'xlsx';

export type ParsedBudgetRow = {
  rowNumber: number;
  code: string;
  departmentCode: string | null;
  projectCode: string | null;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: number | null;
  ownerEmployeeCode: string | null;
};

function cell(row: unknown[], index: number): string {
  return String(row[index] ?? '').trim();
}

function cellOrNull(row: unknown[], index: number): string | null {
  const value = cell(row, index);
  return value === '' ? null : value;
}

export function parseBudgetWorkbook(buffer: Buffer): ParsedBudgetRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const result: ParsedBudgetRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const code = cell(row, 0);
    if (code === '') continue;
    const rawAmount = row[5];
    result.push({
      rowNumber: i + 1,
      code,
      departmentCode: cellOrNull(row, 1),
      projectCode: cellOrNull(row, 2),
      category: cell(row, 3),
      fiscalYear: cell(row, 4),
      annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      ownerEmployeeCode: cellOrNull(row, 6),
    });
  }
  return result;
}
