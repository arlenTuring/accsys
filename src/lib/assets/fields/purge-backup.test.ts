import { describe, expect, it } from 'vitest';
import { PURGE_BACKUP_KIND, isFieldPurgeBackup, recognizePurgeFromBackup } from './purge-backup';

describe('purge backup recognition', () => {
  it('rejects unrelated JSON', () => {
    const r = recognizePurgeFromBackup({ kind: 'other' });
    expect(r.recognized).toBe(false);
  });

  it('recognizes pre-purge backup', () => {
    const doc = {
      kind: PURGE_BACKUP_KIND,
      exportedAt: '2026-11-01T00:00:00.000Z',
      field: { id: '11111111-1111-1111-1111-111111111111', label: '測試欄' },
      assetValues: [],
      inventoryValues: [],
    };
    expect(isFieldPurgeBackup(doc)).toBe(true);
    const r = recognizePurgeFromBackup(doc);
    expect(r.recognized).toBe(true);
    expect(r.purgeCompleted).toBe(false);
    expect(r.label).toBe('測試欄');
    expect(r.message).toContain('尚未標記');
  });

  it('recognizes completed purge marker', () => {
    const r = recognizePurgeFromBackup({
      kind: PURGE_BACKUP_KIND,
      exportedAt: '2026-11-01T00:00:00.000Z',
      field: { id: '11111111-1111-1111-1111-111111111111', label: '測試欄' },
      assetValues: [{ assetId: 'a', tag: 'T1', value: 'x' }],
      inventoryValues: [],
      purge: {
        jobId: '22222222-2222-2222-2222-222222222222',
        completedAt: '2026-11-01T01:00:00.000Z',
        assetFilledCount: 1,
        inventoryFilledCount: 0,
      },
    });
    expect(r.purgeCompleted).toBe(true);
    expect(r.message).toContain('已辨識永久刪除備份');
    expect(r.jobId).toBe('22222222-2222-2222-2222-222222222222');
  });
});
