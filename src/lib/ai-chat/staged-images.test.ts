import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES } from '@/lib/attachments/policy';
import { AI_IMAGE_ALLOWED_MIME, AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_COUNT } from './staged-images';

describe('staged image limits', () => {
  it('allows jpeg/png/webp/heic/pdf (not gif)', () => {
    expect(AI_IMAGE_ALLOWED_MIME.has('image/jpeg')).toBe(true);
    expect(AI_IMAGE_ALLOWED_MIME.has('image/png')).toBe(true);
    expect(AI_IMAGE_ALLOWED_MIME.has('image/webp')).toBe(true);
    expect(AI_IMAGE_ALLOWED_MIME.has('image/heic')).toBe(true);
    expect(AI_IMAGE_ALLOWED_MIME.has('application/pdf')).toBe(true);
    expect(AI_IMAGE_ALLOWED_MIME.has('image/gif')).toBe(false);
  });

  it('aligns size/count with unified attachment policy', () => {
    expect(AI_IMAGE_MAX_BYTES).toBe(MAX_FILE_SIZE_BYTES);
    expect(AI_IMAGE_MAX_COUNT).toBeGreaterThanOrEqual(4);
    expect(AI_IMAGE_MAX_COUNT).toBeLessThanOrEqual(50);
  });
});
