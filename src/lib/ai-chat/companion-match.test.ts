import { describe, expect, it } from 'vitest';
import { classifyCompanionMatch } from './companion-match';

const target = {
  targetStart: '2026-11-10',
  targetEnd: '2026-11-12',
  targetLocation: '台南',
  nearDays: 3,
};

describe('classifyCompanionMatch', () => {
  it('full overlap', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-10',
      candEnd: '2026-11-12',
      candLocation: '台南',
    });
    expect(r.kind).toBe('full_overlap');
  });

  it('partial — early arrival', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-09',
      candEnd: '2026-11-11',
      candLocation: '台南',
    });
    expect(r.kind).toBe('partial_overlap');
    expect(r.diff).toContain('提早');
  });

  it('partial — late leave', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-12',
      candEnd: '2026-11-14',
      candLocation: '台南',
    });
    expect(r.kind).toBe('partial_overlap');
  });

  it('near without overlap', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-14',
      candEnd: '2026-11-15',
      candLocation: '台南',
    });
    expect(r.kind).toBe('near');
  });

  it('same dates different location', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-10',
      candEnd: '2026-11-12',
      candLocation: '新竹',
    });
    expect(r.kind).toBe('same_dates_diff_project');
  });

  it('outside near window is skip', () => {
    const r = classifyCompanionMatch({
      ...target,
      candStart: '2026-11-25',
      candEnd: '2026-11-26',
      candLocation: '台南',
    });
    expect(r.kind).toBe('skip');
  });
});
