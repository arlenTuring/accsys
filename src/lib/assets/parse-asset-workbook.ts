import { ASSET_STATUSES, ASSET_STATUS_LABELS, type AssetStatus } from '@/lib/asset-transfers/constants';
import { loadWorkbook, readRows, type CellPrimitive } from '@/lib/excel/read-rows';
import { checkZipArchive } from '@/lib/excel/zip-guard';

export const MAX_ASSET_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_ROWS = 5000;

export class WorkbookRejected extends Error {}

/** Columns: 財產編號 | 財產名稱 | 數量 | 保管人工號 | 保管地點 | 狀態 (optional) | 備註 (optional). */
export type ParsedAssetRow = {
  rowNumber: number;
  tag: string;
  name: string;
  quantity: number | null;
  custodianEmployeeCode: string;
  location: string;
  /** null when the cell is empty (keeps the current status, 保管中 for new assets); 'invalid' when unknown. */
  status: AssetStatus | 'invalid' | null;
  remark: string | null;
};

function cell(row: CellPrimitive[], index: number): string {
  return String(row[index] ?? '').trim();
}

/** Accepts the Chinese label (保管中) or the code (in_custody). */
export function parseAssetStatus(value: string): AssetStatus | 'invalid' | null {
  if (value === '') return null;
  const byLabel = ASSET_STATUSES.find((s) => ASSET_STATUS_LABELS[s] === value);
  if (byLabel) return byLabel;
  return (ASSET_STATUSES as readonly string[]).includes(value) ? (value as AssetStatus) : 'invalid';
}

export async function parseAssetWorkbook(buffer: Buffer): Promise<ParsedAssetRow[]> {
  if (buffer.length > MAX_ASSET_FILE_BYTES) throw new WorkbookRejected('file_too_large');
  const zip = checkZipArchive(buffer);
  if (!zip.ok) throw new WorkbookRejected(zip.reason);
  const workbook = await loadWorkbook(buffer);
  // First non-empty row of the first sheet is the header.
  const rows = readRows(workbook.worksheets[0]).slice(1);
  if (rows.length > MAX_ASSET_ROWS) throw new WorkbookRejected('too_many_rows');

  const result: ParsedAssetRow[] = [];
  for (const { rowNumber, cells } of rows) {
    const tag = cell(cells, 0);
    if (tag === '') continue;
    const rawQuantity = cells[2];
    const quantity = typeof rawQuantity === 'number' ? rawQuantity : Number(cell(cells, 2) || '1');
    result.push({
      rowNumber,
      tag,
      name: cell(cells, 1),
      quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : null,
      custodianEmployeeCode: cell(cells, 3),
      location: cell(cells, 4),
      status: parseAssetStatus(cell(cells, 5)),
      remark: cell(cells, 6) || null,
    });
  }
  return result;
}
