import { loadWorkbook, readRows, type CellPrimitive } from '@/lib/excel/read-rows';
import { checkZipArchive } from '@/lib/excel/zip-guard';

export const MAX_BUDGET_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BUDGET_ROWS = 5000;

export class WorkbookRejected extends Error {}

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
  if (buffer.length > MAX_BUDGET_FILE_BYTES) throw new WorkbookRejected('file_too_large');
  const zip = checkZipArchive(buffer);
  if (!zip.ok) throw new WorkbookRejected(zip.reason);
  const workbook = await loadWorkbook(buffer);
  // First non-empty row of the first sheet is the header.
  const rows = readRows(workbook.worksheets[0]).slice(1);
  if (rows.length > MAX_BUDGET_ROWS) throw new WorkbookRejected('too_many_rows');

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
