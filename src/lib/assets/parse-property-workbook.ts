import {
  PROPERTY_REGISTER_COLUMNS,
  findColumnByHeader,
  normalizeExcelHeader,
  type ExcelSourceColumn,
} from '@/lib/assets/field-catalog';
import { parseAssetDateCell } from '@/lib/assets/roc-date';
import { ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';
import { loadWorkbook, type CellPrimitive } from '@/lib/excel/read-rows';
import { checkZipArchive } from '@/lib/excel/zip-guard';

export const PROPERTY_SHEET_NAME = '1150630財產保管清冊';
export const PROPERTY_HEADER_ROW = 4;
export const MAX_PROPERTY_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_PROPERTY_DATA_ROWS = 20000;

export class PropertyWorkbookRejected extends Error {}

export type PropertyRowIssue = {
  rowNumber: number;
  column?: string;
  code: string;
  message: string;
};

export type ParsedPropertyRow = {
  rowNumber: number;
  tag: string;
  core: {
    name: string;
    quantity: number | null;
    statusLabel: string | null;
    status: AssetStatus | 'invalid' | null;
    location: string;
    remark: string | null;
    itemKind: string | null;
    description: string | null;
    unit: string | null;
    custodyDepartmentLabel: string | null;
    custodianLabel: string | null;
  };
  /** Configurable asset-scope values keyed by stableKey. */
  assetFields: Record<string, unknown>;
  /** Inventory-scope values keyed by stableKey (+ physicalQuantity). */
  inventory: {
    physicalQuantity: number | null;
    answers: Record<string, unknown>;
  };
};

export type PropertyWorkbookParseResult = {
  sheetName: string;
  headerRow: number;
  columns: ExcelSourceColumn[];
  unmatchedHeaders: string[];
  rows: ParsedPropertyRow[];
  issues: PropertyRowIssue[];
};

function cellText(raw: CellPrimitive | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Preserve integer-looking numbers as text without scientific notation / trailing .0
    if (Number.isInteger(raw)) return String(raw);
    return String(raw);
  }
  return String(raw).trim();
}

/** Force voucher / tag style identifiers to text (keep leading zeros). */
function cellIdText(raw: CellPrimitive | undefined): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number.isInteger(raw)) return String(raw);
    // Avoid float garbage for ids
    return String(raw);
  }
  return String(raw).trim();
}

function parseTristate(raw: CellPrimitive | undefined): 'yes' | 'no' | 'unset' | 'invalid' {
  const t = cellText(raw);
  if (t === '') return 'unset';
  const u = t.toUpperCase();
  if (u === 'V' || u === 'Y' || t === '是' || t === '有' || t === '✓') return 'yes';
  if (u === 'X' || u === 'N' || t === '否' || t === '無' || t === '✗') return 'no';
  return 'invalid';
}

function parseStatus(label: string): AssetStatus | 'invalid' | null {
  if (label === '') return null;
  const byLabel = (Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).find(
    (k) => ASSET_STATUS_LABELS[k] === label
  );
  if (byLabel) return byLabel;
  // workbook uses 保管中 etc.
  if (label === '保管中') return 'in_custody';
  if (label === '外借中' || label === '借出') return 'lent';
  if (label === '已合併') return 'merged';
  if (label === '已出售') return 'sold';
  if (label === '已報廢') return 'scrapped';
  return 'invalid';
}

function parseIntCell(raw: CellPrimitive | undefined): number | null | 'invalid' {
  if (raw === null || raw === undefined || cellText(raw) === '') return null;
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  const n = Number(cellText(raw));
  if (!Number.isInteger(n)) return 'invalid';
  return n;
}

/**
 * Parse the company property register workbook.
 * Only the named sheet is used; other history / transfer sheets are ignored.
 * Effective columns are detected from non-empty header cells on row 4 — trailing blanks are dropped.
 */
export async function parsePropertyRegisterWorkbook(
  buffer: Buffer,
  opts?: { sheetName?: string }
): Promise<PropertyWorkbookParseResult> {
  if (buffer.length > MAX_PROPERTY_FILE_BYTES) {
    throw new PropertyWorkbookRejected('file_too_large');
  }
  const zip = checkZipArchive(buffer);
  if (!zip.ok) throw new PropertyWorkbookRejected(zip.reason);

  const workbook = await loadWorkbook(buffer);
  const sheetName = opts?.sheetName ?? PROPERTY_SHEET_NAME;
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.worksheets.find((w) => w.name === sheetName);
  if (!sheet) {
    throw new PropertyWorkbookRejected(`sheet_not_found:${sheetName}`);
  }

  const headerRow = sheet.getRow(PROPERTY_HEADER_ROW);
  const detected: Array<{ col: number; header: string; mapped?: ExcelSourceColumn }> = [];
  const unmatchedHeaders: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = cellText(cell.value as CellPrimitive);
    if (!header) return;
    const mapped = findColumnByHeader(header);
    detected.push({ col: colNumber, header, mapped });
    if (!mapped) unmatchedHeaders.push(header);
  });

  const colIndexByDef = new Map<number, ExcelSourceColumn>();
  for (const d of detected) {
    if (d.mapped) colIndexByDef.set(d.col, d.mapped);
  }
  // Fallback: catalog excelCol positions when header text failed to map but sheet layout matches.
  if (colIndexByDef.size < 10) {
    for (const c of PROPERTY_REGISTER_COLUMNS) {
      if (![...colIndexByDef.values()].some((x) => x.excelCol === c.excelCol)) {
        colIndexByDef.set(c.excelCol, c);
      }
    }
  }
  const activeColumns = PROPERTY_REGISTER_COLUMNS.filter((c) =>
    [...colIndexByDef.values()].some((x) => x.excelCol === c.excelCol)
  );

  const rows: ParsedPropertyRow[] = [];
  const issues: PropertyRowIssue[] = [];
  let blankRun = 0;
  const lastRow = Math.min(sheet.rowCount || PROPERTY_HEADER_ROW + 1, PROPERTY_HEADER_ROW + MAX_PROPERTY_DATA_ROWS);

  for (let r = PROPERTY_HEADER_ROW + 1; r <= lastRow; r++) {
    const excelRow = sheet.getRow(r);
    const get = (excelCol: number): CellPrimitive | undefined => {
      const v = excelRow.getCell(excelCol).value;
      if (v && typeof v === 'object' && 'result' in v) return (v as { result: CellPrimitive }).result;
      if (v && typeof v === 'object' && 'text' in v) return (v as { text: string }).text;
      if (v && typeof v === 'object' && 'richText' in v) {
        return (v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('');
      }
      return v as CellPrimitive;
    };

    const tagCol = [...colIndexByDef.entries()].find(([, c]) => c.binding.kind === 'core' && c.binding.column === 'tag');
    const tagExcelCol = tagCol?.[0] ?? 3;
    const tag = cellIdText(get(tagExcelCol));
    if (tag === '') {
      blankRun += 1;
      if (blankRun > 40) break;
      continue;
    }
    blankRun = 0;

    const core: ParsedPropertyRow['core'] = {
      name: '',
      quantity: null,
      statusLabel: null,
      status: null,
      location: '',
      remark: null,
      itemKind: null,
      description: null,
      unit: null,
      custodyDepartmentLabel: null,
      custodianLabel: null,
    };
    const assetFields: Record<string, unknown> = {};
    const inventoryAnswers: Record<string, unknown> = {};
    let physicalQuantity: number | null = null;

    for (const [excelCol, colDef] of colIndexByDef) {
      const raw = get(excelCol);
      const b = colDef.binding;
      if (b.kind === 'core') {
        switch (b.column) {
          case 'tag':
            break;
          case 'name':
            core.name = cellText(raw);
            break;
          case 'quantity': {
            const q = parseIntCell(raw);
            if (q === 'invalid') {
              issues.push({
                rowNumber: r,
                column: colDef.label,
                code: 'quantity_invalid',
                message: '帳載數量必須為整數',
              });
            } else core.quantity = q;
            break;
          }
          case 'status': {
            const label = cellText(raw);
            core.statusLabel = label || null;
            core.status = parseStatus(label);
            if (core.status === 'invalid') {
              issues.push({
                rowNumber: r,
                column: colDef.label,
                code: 'status_invalid',
                message: `無法辨識狀態：${label}`,
              });
            }
            break;
          }
          case 'location':
            core.location = cellText(raw);
            break;
          case 'remark':
            core.remark = cellText(raw) || null;
            break;
          case 'itemKind':
            core.itemKind = cellText(raw) || null;
            break;
          case 'description':
            core.description = cellText(raw) || null;
            break;
          case 'unit':
            core.unit = cellText(raw) || null;
            break;
          case 'custodyDepartment':
            core.custodyDepartmentLabel = cellText(raw) || null;
            break;
          case 'custodian':
            core.custodianLabel = cellText(raw) || null;
            break;
        }
      } else if (b.kind === 'asset_field') {
        if (b.fieldType === 'date') {
          if (cellText(raw) === '' && (raw === null || raw === undefined)) {
            /* optional blank */
          } else {
            const d = parseAssetDateCell(raw);
            if (!d.ok) {
              issues.push({
                rowNumber: r,
                column: colDef.label,
                code: 'date_unparsed',
                message: d.error,
              });
            } else assetFields[b.stableKey] = d.iso;
          }
        } else if (b.fieldType === 'tristate') {
          const t = parseTristate(raw);
          if (t === 'invalid') {
            issues.push({
              rowNumber: r,
              column: colDef.label,
              code: 'tristate_invalid',
              message: `無法辨識是／否：${cellText(raw)}`,
            });
          } else if (t !== 'unset') assetFields[b.stableKey] = t;
        } else if (b.stableKey === 'voucher_no' || b.stableKey === 'disposal_voucher_no') {
          const id = cellIdText(raw);
          if (id) assetFields[b.stableKey] = id;
        } else {
          const t = cellText(raw);
          if (t) assetFields[b.stableKey] = t;
        }
      } else if (b.kind === 'inventory_field') {
        if (b.mapsToPhysicalQuantity) {
          const q = parseIntCell(raw);
          if (q === 'invalid') {
            issues.push({
              rowNumber: r,
              column: colDef.label,
              code: 'physical_qty_invalid',
              message: '實盤數量必須為整數',
            });
          } else physicalQuantity = q;
        } else if (b.fieldType === 'tristate') {
          const t = parseTristate(raw);
          if (t === 'invalid') {
            issues.push({
              rowNumber: r,
              column: colDef.label,
              code: 'tristate_invalid',
              message: `無法辨識是／否：${cellText(raw)}`,
            });
          } else if (t !== 'unset') inventoryAnswers[b.stableKey] = t;
        } else {
          const t = cellText(raw);
          if (t) inventoryAnswers[b.stableKey] = t;
        }
      }
    }

    if (!core.name) {
      issues.push({
        rowNumber: r,
        column: '設備或生財器具名稱',
        code: 'name_required',
        message: '名稱空白',
      });
    }

    rows.push({
      rowNumber: r,
      tag,
      core,
      assetFields,
      inventory: { physicalQuantity, answers: inventoryAnswers },
    });

    if (rows.length > MAX_PROPERTY_DATA_ROWS) {
      throw new PropertyWorkbookRejected('too_many_rows');
    }
  }

  return {
    sheetName,
    headerRow: PROPERTY_HEADER_ROW,
    columns: activeColumns,
    unmatchedHeaders,
    rows,
    issues,
  };
}

// silence unused in case of tree shake of normalize helper for tests
export { normalizeExcelHeader };
