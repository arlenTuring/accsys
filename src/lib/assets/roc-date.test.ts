import { describe, expect, it } from 'vitest';
import { formatRocDate, parseAssetDateCell } from './roc-date';

describe('parseAssetDateCell', () => {
  it('parses ROC slash dates', () => {
    expect(parseAssetDateCell('107/12/28')).toEqual({
      ok: true,
      iso: '2018-12-28',
      source: 'roc',
    });
  });

  it('parses ROC dotted and chinese forms', () => {
    expect(parseAssetDateCell('108.03.28')).toMatchObject({ ok: true, iso: '2019-03-28' });
    expect(parseAssetDateCell('108年10月4日')).toMatchObject({ ok: true, iso: '2019-10-04' });
  });

  it('parses ISO', () => {
    expect(parseAssetDateCell('2020-01-02')).toEqual({ ok: true, iso: '2020-01-02', source: 'iso' });
  });

  it('rejects garbage without guessing', () => {
    expect(parseAssetDateCell('昨天').ok).toBe(false);
    expect(parseAssetDateCell('13/40/99').ok).toBe(false);
  });

  it('formats ROC for display', () => {
    expect(formatRocDate('2018-12-28')).toBe('107/12/28');
  });
});
