import { inflateRawSync } from 'node:zlib';

/**
 * Pre-check of an .xlsx (ZIP) before handing it to the parser. The central
 * directory is checked for entry count, declared size and compression ratio,
 * then every entry is actually inflated with a hard output cap: declared sizes
 * are attacker-controlled, and the parser (JSZip) inflates entries without a
 * limit. ZIP64 and encrypted entries are not needed for spreadsheets and are
 * rejected.
 */
export type ZipLimits = { maxEntries: number; maxUncompressedBytes: number; maxRatio: number };

export const XLSX_LIMITS: ZipLimits = { maxEntries: 2000, maxUncompressedBytes: 50 * 1024 * 1024, maxRatio: 200 };

type ZipCheck = { ok: true } | { ok: false; reason: string };

function inflatedSize(data: Uint8Array, method: number, cap: number): number | null {
  if (method === 0) return data.length;
  if (method !== 8) return null;
  try {
    return inflateRawSync(data, { maxOutputLength: Math.max(cap, 1) }).length;
  } catch {
    return null;
  }
}

export function checkZipArchive(buf: Uint8Array, limits: ZipLimits = XLSX_LIMITS): ZipCheck {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const minEocd = 22;
  if (buf.length < minEocd) return { ok: false, reason: 'not_zip' };

  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: 'not_zip' };

  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, reason: 'zip64' };
  if (entries > limits.maxEntries) return { ok: false, reason: 'too_many_entries' };
  if (cdOffset + cdSize > eocd) return { ok: false, reason: 'corrupt' };

  type Entry = { flags: number; method: number; compressed: number; uncompressed: number; localOffset: number };
  const list: Entry[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) return { ok: false, reason: 'corrupt' };
    const compressed = view.getUint32(p + 20, true);
    const uncompressed = view.getUint32(p + 24, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) return { ok: false, reason: 'zip64' };
    total += uncompressed;
    if (total > limits.maxUncompressedBytes) return { ok: false, reason: 'too_large' };
    if (uncompressed > 1024 * 1024 && uncompressed / Math.max(compressed, 1) > limits.maxRatio) {
      return { ok: false, reason: 'ratio' };
    }
    list.push({
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressed,
      uncompressed,
      localOffset: view.getUint32(p + 42, true),
    });
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }

  for (const entry of list) {
    if (entry.flags & 0x1) return { ok: false, reason: 'encrypted' };
    const lh = entry.localOffset;
    if (lh + 30 > cdOffset || view.getUint32(lh, true) !== 0x04034b50) return { ok: false, reason: 'corrupt' };
    const start = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
    if (start + entry.compressed > cdOffset) return { ok: false, reason: 'corrupt' };
    const size = inflatedSize(buf.subarray(start, start + entry.compressed), entry.method, entry.uncompressed);
    if (size !== entry.uncompressed) return { ok: false, reason: 'size_mismatch' };
  }
  return { ok: true };
}
