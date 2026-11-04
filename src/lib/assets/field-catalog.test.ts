import { describe, expect, it } from 'vitest';
import { PROPERTY_REGISTER_COLUMNS, classifyFieldCounts, findColumnByHeader } from './field-catalog';

describe('property register field catalog', () => {
  it('covers exactly 23 source columns with explicit ownership', () => {
    expect(PROPERTY_REGISTER_COLUMNS).toHaveLength(23);
    const counts = classifyFieldCounts();
    expect(counts.total).toBe(23);
    expect(counts.core + counts.assetField + counts.inventory).toBe(23);
    expect(counts.inventory).toBeGreaterThanOrEqual(4);
  });

  it('keeps inventory questions off the permanent asset master binding', () => {
    const inv = PROPERTY_REGISTER_COLUMNS.filter((c) => c.binding.kind === 'inventory_field');
    expect(inv.map((c) => c.label)).toEqual(
      expect.arrayContaining(['實盤數量', '帳務是否與實際財產相符', '是否已不堪使用需報廢'])
    );
  });

  it('matches multiline excel headers', () => {
    expect(findColumnByHeader('帳務是否與\n實際財產相符\n(V/X)')?.binding).toMatchObject({
      kind: 'inventory_field',
      stableKey: 'inv_matches_books',
    });
  });

  it('uses stable keys that do not change when labels wrap', () => {
    const keys = PROPERTY_REGISTER_COLUMNS.map((c) =>
      c.binding.kind === 'core' ? c.binding.column : c.binding.stableKey
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
