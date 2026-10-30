import { describe, expect, it } from 'vitest';
import {
  type ClientImageAttachment,
  planAcceptedAttachments,
  statusLabel,
} from './image-attachment-utils';

function stub(id: string): ClientImageAttachment {
  return {
    clientAttachmentId: id,
    fileName: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 100,
    previewUrl: `blob:${id}`,
    status: 'selected',
  };
}

describe('planAcceptedAttachments', () => {
  it('respects remaining room against current count', () => {
    const { accepted, overLimit } = planAcceptedAttachments(2, [stub('a'), stub('b'), stub('c')], 3);
    expect(accepted.map((a) => a.clientAttachmentId)).toEqual(['a']);
    expect(overLimit).toBe(2);
  });

  it('accepts none when already at max', () => {
    const { accepted, overLimit } = planAcceptedAttachments(3, [stub('a')], 3);
    expect(accepted).toHaveLength(0);
    expect(overLimit).toBe(1);
  });
});

describe('statusLabel', () => {
  it('does not invent a separate scan phase label', () => {
    expect(statusLabel('uploading')).toBe('上傳與檢查中');
    expect(statusLabel('scanning')).toBe('上傳與檢查中');
  });
});
