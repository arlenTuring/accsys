import { loadWorkbook, readRows, type CellPrimitive, type SheetRow } from '@/lib/excel/read-rows';
import { checkZipArchive } from '@/lib/excel/zip-guard';
import {
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from './constants';

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
  /** 若工作簿內含歷年實際執行數或去年核定預算，一併解析供歷年匯入與檢視 */
  historicalActualAmount?: number | null;
  historicalFiscalYear?: string | null;
};

function cell(row: CellPrimitive[], index: number): string {
  return String(row[index] ?? '').trim();
}

function cellOrNull(row: CellPrimitive[], index: number): string | null {
  const value = cell(row, index);
  return value === '' ? null : value;
}

function parseNumericCell(val: CellPrimitive): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').trim();
    if (cleaned === '' || cleaned === '-') return null;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const KNOWN_DEPT_CODES = ['CO', 'CEO', 'AD', 'S&M', 'PD', 'VD', 'D&C', 'ADS', 'RD', 'HR', 'FA', 'SALES'];

function extractUnitAndYearFromSheet(
  sheetName: string,
  rows: SheetRow[]
): {
  departmentCode: string | null;
  projectCode: string | null;
  fiscalYear: string;
  ownerEmployeeCode: string | null;
} {
  let departmentCode: string | null = null;
  let projectCode: string | null = null;
  let fiscalYear = '116';
  let ownerEmployeeCode: string | null = null;

  // Check metadata rows at top of sheet
  for (const r of rows.slice(0, 6)) {
    const line = r.cells.map((c) => String(c ?? '')).join(' ');
    const deptMatch = line.match(/部門代碼[：:]\s*([A-Za-z0-9&-]+)/);
    if (deptMatch) departmentCode = deptMatch[1]!.trim();
    const projMatch = line.match(/專案代碼[：:]\s*([A-Za-z0-9_-]+)/);
    if (projMatch) projectCode = projMatch[1]!.trim();
    const yearMatch = line.match(/預算年度[：:]\s*(\d{3,4})/) ?? line.match(/(20\d{2})\s*年度/);
    if (yearMatch) {
      const y = Number(yearMatch[1]);
      fiscalYear = y > 1911 ? String(y - 1911) : String(y);
    }
    const ownerMatch = line.match(/負責人工號[：:]\s*([A-Za-z0-9_-]+)/);
    if (ownerMatch && ownerMatch[1]!.trim()) ownerEmployeeCode = ownerMatch[1]!.trim();
  }

  // Fallback to sheet name e.g. "管理部(AD)" or "115BD001-次世代自駕"
  if (!departmentCode && !projectCode) {
    const parenMatch = sheetName.match(/\(([A-Za-z0-9&-]+)\)/);
    if (parenMatch) {
      const token = parenMatch[1]!.trim();
      if (KNOWN_DEPT_CODES.includes(token.toUpperCase()) || /^[A-Z&]{2,5}$/.test(token)) {
        departmentCode = token;
      } else {
        projectCode = token;
      }
    } else {
      const projPrefix = sheetName.match(/^(\d{3}[A-Za-z0-9_-]+)/);
      if (projPrefix) {
        projectCode = projPrefix[1]!.trim();
      } else if (KNOWN_DEPT_CODES.includes(sheetName.trim().toUpperCase())) {
        departmentCode = sheetName.trim().toUpperCase();
      }
    }
  }

  return { departmentCode, projectCode, fiscalYear, ownerEmployeeCode };
}

/**
 * 嘗試解析多工作表「部門預算表 / 專案預算表 / 預算差異分析表」格式
 */
function parseStructuredMultiSheetWorkbook(
  sheets: { name: string; rows: SheetRow[] }[]
): ParsedBudgetRow[] | null {
  const results: ParsedBudgetRow[] = [];

  for (const sheet of sheets) {
    if (
      sheet.name.includes('總表') ||
      sheet.name.includes('對照表') ||
      sheet.name.includes('彙總') ||
      sheet.name.includes('說明')
    ) {
      continue;
    }

    // Find a header row containing 會計科目編號 or 會計科目名稱
    const headerIdx = sheet.rows.findIndex((r) =>
      r.cells.some((c) => {
        const s = String(c ?? '').trim();
        return s.includes('會計科目') || s === '科目編號' || s === '科目代碼';
      })
    );
    if (headerIdx === -1) continue;

    const headerCells = sheet.rows[headerIdx]!.cells.map((c) => String(c ?? '').trim());
    const acctNoCol = headerCells.findIndex((h) => h.includes('科目編號'));
    const acctNameCol = headerCells.findIndex((h) => h.includes('科目名稱') || h === '會計科目');
    const budgetCodeCol = headerCells.findIndex((h) => h.includes('預算編號') || h.includes('預算代號'));
    const itemCodeCol = headerCells.findIndex((h) => h.includes('科目代碼'));
    const totalBudgetCol = headerCells.findIndex(
      (h) => h.includes('全年預算') || h.includes('年度預算') || h.includes('編列預算') || h.includes('預算合計')
    );
    const histActualCol = headerCells.findIndex((h) => h.includes('實際'));
    const janCol = headerCells.findIndex((h) => h === '1月' || h === '一月');

    const meta = extractUnitAndYearFromSheet(sheet.name, sheet.rows);
    if (!meta.departmentCode && !meta.projectCode) continue;

    const unitCode = (meta.departmentCode ?? meta.projectCode)!;
    const prevRocYear = String(Math.max(100, (Number(meta.fiscalYear) || 116) - 1));

    for (const row of sheet.rows.slice(headerIdx + 1)) {
      const acctNo = acctNoCol >= 0 ? cell(row.cells, acctNoCol) : '';
      const acctName = acctNameCol >= 0 ? cell(row.cells, acctNameCol) : '';
      const rawItemCode = itemCodeCol >= 0 ? cell(row.cells, itemCodeCol) : '';
      const rawBudgetCode = budgetCodeCol >= 0 ? cell(row.cells, budgetCodeCol) : '';

      if (acctNo.includes('合計') || acctName.includes('合計') || acctName.includes('總計')) {
        continue;
      }

      const stdCat =
        findStandardAccountCategory(rawItemCode) ??
        findStandardAccountCategory(acctNo) ??
        findStandardAccountCategory(acctName);

      if (!stdCat && !rawBudgetCode) continue;

      const category = acctName || stdCat?.categoryName || '';
      const code =
        rawBudgetCode ||
        (stdCat
          ? buildStandardBudgetCode({
              fiscalYear: meta.fiscalYear,
              unitCode,
              itemCode: stdCat.itemCode,
            })
          : '');
      if (!code || !category) continue;

      let amount: number | null =
        totalBudgetCol >= 0 ? parseNumericCell(row.cells[totalBudgetCol] ?? null) : null;

      // If total is 0 or null and 1~12月 columns exist, sum them up
      if ((amount === null || amount === 0) && janCol >= 0) {
        let sum12 = 0;
        let hasMonthNumber = false;
        for (let m = 0; m < 12; m += 1) {
          const v = parseNumericCell(row.cells[janCol + m] ?? null);
          if (v !== null) {
            sum12 += v;
            hasMonthNumber = true;
          }
        }
        if (hasMonthNumber && sum12 > 0) amount = sum12;
      }

      const histActual =
        histActualCol >= 0 ? parseNumericCell(row.cells[histActualCol] ?? null) : null;

      // Skip blank template rows where both current budget and historical actual are 0 / null
      if ((amount === null || amount === 0) && (histActual === null || histActual === 0)) {
        continue;
      }

      if (amount !== null && amount !== 0) {
        results.push({
          rowNumber: row.rowNumber,
          code,
          departmentCode: meta.departmentCode,
          projectCode: meta.projectCode,
          category,
          fiscalYear: meta.fiscalYear,
          annualBudgetAmount: amount,
          ownerEmployeeCode: meta.ownerEmployeeCode,
          historicalActualAmount: histActual,
          historicalFiscalYear: prevRocYear,
        });
      }
    }
  }

  return results.length > 0 ? results : null;
}

export async function parseBudgetWorkbook(buffer: Buffer): Promise<ParsedBudgetRow[]> {
  if (buffer.length > MAX_BUDGET_FILE_BYTES) throw new WorkbookRejected('file_too_large');
  const zip = checkZipArchive(buffer);
  if (!zip.ok) throw new WorkbookRejected(zip.reason);
  const workbook = await loadWorkbook(buffer);

  // Try structured multi-sheet corporate template first if the first sheet is not the 7-column flat format
  const firstSheetRows = readRows(workbook.worksheets[0]);
  const firstHeader = firstSheetRows[0]?.cells.map((c) => String(c ?? '').trim()) ?? [];
  const isFlatFormat =
    firstHeader[0]?.includes('預算編號') ||
    (firstHeader.length >= 6 &&
      firstHeader[1]?.includes('部門') &&
      firstHeader[2]?.includes('專案'));

  if (!isFlatFormat && workbook.worksheets.length >= 1) {
    const structured = parseStructuredMultiSheetWorkbook(
      workbook.worksheets.map((ws) => ({ name: ws.name, rows: readRows(ws) }))
    );
    if (structured) {
      if (structured.length > MAX_BUDGET_ROWS) throw new WorkbookRejected('too_many_rows');
      return structured;
    }
  }

  // First non-empty row of the first sheet is the header.
  const rows = firstSheetRows.slice(1);
  if (rows.length > MAX_BUDGET_ROWS) throw new WorkbookRejected('too_many_rows');

  const result: ParsedBudgetRow[] = [];
  for (const { rowNumber, cells } of rows) {
    const code = cell(cells, 0);
    if (code === '') continue;
    const rawAmount = cells[5];
    const fiscalYear = cell(cells, 4);
    const prevYearNum = Number(fiscalYear);
    const histActual = parseNumericCell(cells[7] ?? null);
    result.push({
      rowNumber,
      code,
      departmentCode: cellOrNull(cells, 1),
      projectCode: cellOrNull(cells, 2),
      category: cell(cells, 3),
      fiscalYear,
      annualBudgetAmount: typeof rawAmount === 'number' ? rawAmount : null,
      ownerEmployeeCode: cellOrNull(cells, 6),
      ...(histActual !== null
        ? {
            historicalActualAmount: histActual,
            historicalFiscalYear: Number.isFinite(prevYearNum) && prevYearNum > 1 ? String(prevYearNum - 1) : null,
          }
        : {}),
    });
  }
  return result;
}
