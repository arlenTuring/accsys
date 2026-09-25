import ExcelJS from 'exceljs';

export type CellPrimitive = string | number | boolean | Date | null;

export type SheetRow = {
  /** 1-based row number as shown in Excel. */
  rowNumber: number;
  /** 0-based: cells[0] is column A. Missing cells are null. */
  cells: CellPrimitive[];
};

/** Flattens exceljs cell objects (formula, rich text, hyperlink, error) to plain values. */
export function toCellPrimitive(value: ExcelJS.CellValue): CellPrimitive {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value;
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  // Formulas: use the cached result Excel saved with the file; never evaluate.
  if ('formula' in value || 'sharedFormula' in value) return toCellPrimitive(value.result ?? null);
  if ('hyperlink' in value) return toCellPrimitive(value.text);
  return null; // CellErrorValue such as #N/A
}

export async function loadWorkbook(source: Buffer | string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (typeof source === 'string') {
    await workbook.xlsx.readFile(source);
  } else {
    // exceljs declares its own ArrayBuffer-based `Buffer` type; Node's Buffer is accepted at runtime.
    await workbook.xlsx.load(source as unknown as ArrayBuffer);
  }
  return workbook;
}

/** Non-empty rows of a worksheet, in order. */
export function readRows(worksheet: ExcelJS.Worksheet | undefined): SheetRow[] {
  if (!worksheet) return [];
  const rows: SheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: CellPrimitive[] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      cells[colNumber - 1] = toCellPrimitive(cell.value);
    });
    for (let i = 0; i < cells.length; i += 1) {
      if (cells[i] === undefined) cells[i] = null;
    }
    rows.push({ rowNumber, cells });
  });
  return rows;
}
