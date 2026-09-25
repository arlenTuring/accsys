import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { loadWorkbook, readRows, toCellPrimitive } from './read-rows';

describe('toCellPrimitive', () => {
  it('passes plain values through', () => {
    expect(toCellPrimitive('a')).toBe('a');
    expect(toCellPrimitive(12.5)).toBe(12.5);
    expect(toCellPrimitive(true)).toBe(true);
    expect(toCellPrimitive(null)).toBeNull();
    expect(toCellPrimitive(undefined)).toBeNull();
  });

  it('uses the cached formula result and never the formula text', () => {
    expect(toCellPrimitive({ formula: 'A1*2', result: 42 })).toBe(42);
    expect(toCellPrimitive({ formula: 'A1*2' })).toBeNull();
    expect(toCellPrimitive({ sharedFormula: 'B2', result: 'x' })).toBe('x');
  });

  it('flattens rich text and hyperlinks to their text', () => {
    expect(toCellPrimitive({ richText: [{ text: '台北' }, { text: '辦公室' }] })).toBe('台北辦公室');
    expect(toCellPrimitive({ text: 'a@example.test', hyperlink: 'mailto:a@example.test' })).toBe(
      'a@example.test'
    );
  });

  it('turns Excel error cells into null', () => {
    expect(toCellPrimitive({ error: '#N/A' })).toBeNull();
  });
});

describe('readRows', () => {
  it('returns real Excel row numbers, skips empty rows and fills gaps with null', async () => {
    const source = new ExcelJS.Workbook();
    const sheet = source.addWorksheet('s');
    sheet.getCell('A1').value = 'h';
    sheet.getCell('A3').value = 'x';
    sheet.getCell('C3').value = 3;
    const workbook = await loadWorkbook(Buffer.from(await source.xlsx.writeBuffer()));
    expect(readRows(workbook.worksheets[0])).toEqual([
      { rowNumber: 1, cells: ['h'] },
      { rowNumber: 3, cells: ['x', null, 3] },
    ]);
  });

  it('returns no rows for a missing worksheet', () => {
    expect(readRows(undefined)).toEqual([]);
  });
});
