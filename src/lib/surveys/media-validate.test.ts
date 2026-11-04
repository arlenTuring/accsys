import { describe, expect, it } from 'vitest';
import { sniffSurveyMediaType, sanitizeSurveyMediaFileName, surveyMediaKind } from './media-validate';

describe('survey media validate', () => {
  it('sniffs jpeg / png / webp', () => {
    expect(sniffSurveyMediaType(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(
      sniffSurveyMediaType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))
    ).toBe('image/png');
    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffSurveyMediaType(webp)).toBe('image/webp');
  });

  it('sniffs webm and mp4, rejects heic brands', () => {
    expect(sniffSurveyMediaType(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0))).toBe('video/webm');
    const mp4 = new Uint8Array(16);
    mp4.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ftyp isom
    expect(sniffSurveyMediaType(mp4)).toBe('video/mp4');
    const heic = new Uint8Array(16);
    heic.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]); // ftyp heic
    expect(sniffSurveyMediaType(heic)).toBeNull();
  });

  it('sanitizes names and classifies kind', () => {
    expect(sanitizeSurveyMediaFileName('a/b.png', 'image/png')).toBe('b.png');
    expect(sanitizeSurveyMediaFileName('clip', 'video/mp4')).toBe('clip.mp4');
    expect(surveyMediaKind('video/webm')).toBe('video');
    expect(surveyMediaKind('image/jpeg')).toBe('image');
  });
});
