import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { checkZipArchive } from './zip-guard';

async function xlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('s').addRows([['a', 1]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('checkZipArchive', () => {
  it('accepts a normal workbook', async () => {
    expect(checkZipArchive(await xlsx())).toEqual({ ok: true });
  });

  it('rejects non-zip input', () => {
    expect(checkZipArchive(new TextEncoder().encode('<html>not a zip</html>'))).toMatchObject({ ok: false });
  });

  it('rejects archives declaring too much uncompressed data', async () => {
    expect(checkZipArchive(await xlsx(), { maxEntries: 2000, maxUncompressedBytes: 10, maxRatio: 200 })).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('rejects archives with too many entries', async () => {
    expect(checkZipArchive(await xlsx(), { maxEntries: 1, maxUncompressedBytes: 1e9, maxRatio: 200 })).toEqual({
      ok: false,
      reason: 'too_many_entries',
    });
  });

  it('detects a high-ratio entry (zip bomb pattern)', async () => {
    const data = Buffer.alloc(5 * 1024 * 1024); // 5 MB of zeros compresses to a few KB
    expect(checkZipArchive(singleEntryZip(deflateRawSync(data), data.length))).toEqual({ ok: false, reason: 'ratio' });
  });

  it('rejects an entry whose real inflated size exceeds the declared size', () => {
    // 200 MB of zeros declared as 1 KB: the central directory alone looks harmless.
    const comp = deflateRawSync(Buffer.alloc(200 * 1024 * 1024));
    expect(checkZipArchive(singleEntryZip(comp, 1024))).toEqual({ ok: false, reason: 'size_mismatch' });
  });

  it('rejects an entry that inflates to less than declared, or is not valid deflate', () => {
    const comp = deflateRawSync(Buffer.from('<x/>'));
    expect(checkZipArchive(singleEntryZip(comp, 10))).toEqual({ ok: false, reason: 'size_mismatch' });
    expect(checkZipArchive(singleEntryZip(Buffer.from('not deflate data'), 4))).toEqual({
      ok: false,
      reason: 'size_mismatch',
    });
  });

  it('rejects encrypted entries and unknown compression methods', () => {
    const comp = deflateRawSync(Buffer.from('<x/>'));
    expect(checkZipArchive(singleEntryZip(comp, 4, { flags: 1 }))).toEqual({ ok: false, reason: 'encrypted' });
    expect(checkZipArchive(singleEntryZip(comp, 4, { method: 12 }))).toEqual({ ok: false, reason: 'size_mismatch' });
  });
});

function singleEntryZip(comp: Buffer, declaredSize: number, opts: { flags?: number; method?: number } = {}): Buffer {
  const method = opts.method ?? 8;
  const flags = opts.flags ?? 0;
  const name = Buffer.from('xl/entry.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, comp, central, name, eocd]);
}
