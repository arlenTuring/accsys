/**
 * Republic of China (民國) calendar helpers for asset workbook dates.
 * Never guess — unparseable values return an error for the operator to fix.
 */

export type RocDateResult =
  | { ok: true; iso: string; source: 'roc' | 'iso' | 'excel_serial' }
  | { ok: false; error: string };

const ROC_RE = /^(\d{2,3})[./年月](\d{1,2})[./月]?(\d{1,2})日?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function ymdValid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Excel serial day number (1900 date system, as exported by Excel for mac/win sheets we see). */
function fromExcelSerial(n: number): RocDateResult {
  if (!Number.isFinite(n) || n < 1 || n > 100000) {
    return { ok: false, error: '無法解析的 Excel 日期序號' };
  }
  // Excel's epoch quirk: day 1 = 1899-12-31 in the 1900 system used by exceljs/openpyxl data_only.
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const dt = new Date(utc);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  if (!ymdValid(y, m, d)) return { ok: false, error: 'Excel 日期序號無效' };
  return { ok: true, iso: `${y}-${pad2(m)}-${pad2(d)}`, source: 'excel_serial' };
}

/**
 * Parse a cell that should be a calendar date.
 * Accepts 民國 (e.g. 107/12/28、107.12.28、107年12月28日), ISO (2018-12-28),
 * or a numeric Excel serial. Empty → error (caller may treat blank separately).
 */
export function parseAssetDateCell(raw: unknown): RocDateResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: '日期空白' };
  }
  if (typeof raw === 'number') return fromExcelSerial(raw);
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = raw.getMonth() + 1;
    const d = raw.getDate();
    if (!ymdValid(y, m, d)) return { ok: false, error: '日期無效' };
    return { ok: true, iso: `${y}-${pad2(m)}-${pad2(d)}`, source: 'iso' };
  }

  const text = String(raw).trim();
  if (text === '') return { ok: false, error: '日期空白' };

  const iso = text.match(ISO_RE);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (!ymdValid(y, m, d)) return { ok: false, error: `日期無效：${text}` };
    return { ok: true, iso: `${y}-${pad2(m)}-${pad2(d)}`, source: 'iso' };
  }

  const roc = text.match(ROC_RE);
  if (roc) {
    const rocYear = Number(roc[1]);
    const m = Number(roc[2]);
    const d = Number(roc[3]);
    if (rocYear < 1 || rocYear > 200) {
      return { ok: false, error: `民國年不合理：${text}` };
    }
    const y = rocYear + 1911;
    if (!ymdValid(y, m, d)) return { ok: false, error: `日期無效：${text}` };
    return { ok: true, iso: `${y}-${pad2(m)}-${pad2(d)}`, source: 'roc' };
  }

  // Numeric string that looks like an Excel serial
  if (/^\d+(\.\d+)?$/.test(text)) {
    return fromExcelSerial(Number(text));
  }

  return { ok: false, error: `無法解析日期（請用民國或 YYYY-MM-DD）：${text}` };
}

/** Format ISO date as 民國 YYY/MM/DD for display. */
export function formatRocDate(iso: string): string | null {
  const m = iso.match(ISO_RE);
  if (!m) return null;
  const y = Number(m[1]) - 1911;
  if (y < 1) return null;
  return `${y}/${m[2]}/${m[3]}`;
}
