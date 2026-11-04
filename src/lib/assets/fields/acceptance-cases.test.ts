import { describe, expect, it } from 'vitest';
import { ASSET_FIELD_TYPES, ASSET_FIELD_SECTIONS } from './types';
import { PROPERTY_REGISTER_COLUMNS, classifyFieldCounts } from '@/lib/assets/field-catalog';
import { parseAssetDateCell, formatRocDate } from '@/lib/assets/roc-date';
import { recognizePurgeFromBackup, PURGE_BACKUP_KIND } from './purge-backup';

/**
 * Automated slice of the asset-field acceptance matrix.
 * Screenshot / device cases remain manual (see docs/evidence).
 */
describe('asset field acceptance (automated)', () => {
  it('1–11: every supported field type is declared once', () => {
    expect(ASSET_FIELD_TYPES).toHaveLength(11);
    expect(new Set(ASSET_FIELD_TYPES).size).toBe(11);
  });

  it('12: sections cover Excel ownership buckets', () => {
    expect(ASSET_FIELD_SECTIONS).toEqual(
      expect.arrayContaining(['basic', 'accounting', 'custody', 'status_qty', 'notes', 'inventory', 'custom'])
    );
  });

  it('13: 23 Excel columns map with zero unmatched ownership', () => {
    expect(PROPERTY_REGISTER_COLUMNS).toHaveLength(23);
    const counts = classifyFieldCounts();
    expect(counts.total).toBe(23);
    expect(counts.core + counts.assetField + counts.inventory).toBe(23);
  });

  it('14: ROC date round-trip for 取得時間', () => {
    const parsed = parseAssetDateCell('107/12/28');
    expect(parsed).toEqual({ ok: true, iso: '2018-12-28', source: 'roc' });
    expect(formatRocDate('2018-12-28')).toBe('107/12/28');
  });

  it('15: voucher-like text must not be coerced (catalog help)', () => {
    const voucher = PROPERTY_REGISTER_COLUMNS.find((c) => c.binding.kind === 'asset_field' && c.binding.stableKey === 'voucher_no');
    expect(voucher?.binding).toMatchObject({ kind: 'asset_field', fieldType: 'text' });
    expect(voucher?.help).toMatch(/文字/);
  });

  it('16: purge backup format is recognizable before completion', () => {
    const r = recognizePurgeFromBackup({
      kind: PURGE_BACKUP_KIND,
      exportedAt: '2026-11-01T00:00:00.000Z',
      field: { id: '11111111-1111-1111-1111-111111111111', label: '專案' },
      assetValues: [],
      inventoryValues: [],
    });
    expect(r.recognized).toBe(true);
    expect(r.purgeCompleted).toBe(false);
  });

  it('17: completed purge marker is recognizable for restore', () => {
    const r = recognizePurgeFromBackup({
      kind: PURGE_BACKUP_KIND,
      exportedAt: '2026-11-01T00:00:00.000Z',
      field: { id: '11111111-1111-1111-1111-111111111111', label: '專案' },
      assetValues: [],
      inventoryValues: [],
      purge: {
        jobId: '22222222-2222-2222-2222-222222222222',
        completedAt: '2026-11-01T01:00:00.000Z',
        assetFilledCount: 0,
        inventoryFilledCount: 0,
      },
    });
    expect(r.purgeCompleted).toBe(true);
  });

  it('18: foreign JSON is not treated as purge backup', () => {
    expect(recognizePurgeFromBackup({ assets: [] }).recognized).toBe(false);
  });
});
