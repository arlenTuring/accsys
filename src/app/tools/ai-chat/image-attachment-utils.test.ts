import { describe, expect, it } from 'vitest';
import {
  buildImageCandidates,
  canAttachToDraft,
  canSendToModel,
  planAcceptedAttachments,
  statusAfterInvoiceCheck,
  statusLabel,
} from './image-attachment-utils';

describe('image-attachment-utils', () => {
  it('labels scanned as security complete (AI starts automatically)', () => {
    expect(statusLabel('scanned')).toContain('安全檢查完成');
    expect(statusLabel('scanned')).not.toContain('尚未送 AI');
    expect(statusLabel('checking')).toContain('AI 檢查中');
    expect(statusLabel('processing')).toContain('壓縮');
  });

  it('allows attach after scan even with business reminder status', () => {
    expect(canAttachToDraft('scanned')).toBe(true);
    expect(canAttachToDraft('checking')).toBe(true);
    expect(canAttachToDraft('ready')).toBe(true);
    expect(canAttachToDraft('needs_confirm')).toBe(true);
    expect(canAttachToDraft('uploading')).toBe(false);
    expect(canAttachToDraft('blocked')).toBe(false);
  });

  it('maps invoice reminders without blocking attach path', () => {
    // Reminder statuses still surface as needs_confirm for UI copy, but canAttachToDraft stays true.
    expect(statusAfterInvoiceCheck({ status: 'mismatch', summary: '統編不符' })).toBe('needs_confirm');
    expect(canAttachToDraft('needs_confirm')).toBe(true);
    expect(statusAfterInvoiceCheck({ status: 'match', summary: 'ok' })).toBe('ready');
    expect(canSendToModel('checking')).toBe(true);
  });

  it('plans attachment slots', () => {
    const { candidates } = buildImageCandidates([
      new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }),
    ]);
    expect(candidates[0]?.status).toBe('processing');
    const planned = planAcceptedAttachments(0, candidates, 8);
    expect(planned.accepted).toHaveLength(1);
  });
});
