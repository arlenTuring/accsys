import { describe, expect, it } from 'vitest';
import { sanitizeAnnouncementText } from '@/lib/announcements/service';

describe('sanitizeAnnouncementText', () => {
  it('strips control characters and trims', () => {
    expect(sanitizeAnnouncementText('  hello\u0000world  ', 200)).toBe('helloworld');
  });
});
