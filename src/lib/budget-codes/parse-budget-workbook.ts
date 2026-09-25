import { loadWorkbook, readRows, type CellPrimitive } from '@/lib/excel/read-rows';

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

function cell(row: CellPrimitive[], index: number): string {
  return String(row[index] ?? '').trim();
}

function cellOrNull(row: CellPrimitive[], index: number): string | null {
  const value = cell(row, index);
  return value === '' ? null : value;
}

export async function parseBudgetWorkbook(buffer: Buffer): Promise<ParsedBudgetRow[]> {
  const workbook = await loadWorkbook(buffer);
  // First non-empty row of the first sheet is the header.
  const rows = readRows(workbook.worksheets[0]).slice(1);

  const result: ParsedBudgetRow[] = [];
  for (const { rowNumber, cells } of rows) {
    const code = cell(cells, 0);
    if (code === '') continue;
    const rawAmount = cells[5];
    result.push({
      rowNumber,
      code,
      departmentCode: cellOrNull(cells, 1),
      projectCode: cellOrNull(cells, 2),
      category: cell(cells, 3),
      fiscalYear: cell(cells, 4),
      annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      ownerEmployeeCode: cellOrNull(cells, 6),
    });
  }
  return result;
}
