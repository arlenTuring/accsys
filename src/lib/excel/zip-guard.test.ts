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
    const { deflateRawSync } = await import('node:zlib');
    const data = Buffer.alloc(5 * 1024 * 1024); // 5 MB of zeros compresses to a few KB
    const comp = deflateRawSync(data);
    const name = Buffer.from('xl/bomb.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    const cdOffset = local.length + name.length + comp.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, comp, central, name, eocd]);
    expect(checkZipArchive(zip)).toEqual({ ok: false, reason: 'ratio' });
  });
});
