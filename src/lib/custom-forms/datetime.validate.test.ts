import { describe, expect, it } from 'vitest';
import { parseFormSchema } from './schema';
import { isValidDateTime, validateSubmission } from './validate';

const TODAY = '2026-10-13';

function schemaWithDatetime() {
  const r = parseFormSchema({
    version: 1,
    sections: [
      {
        id: 's',
        fields: [
          { id: 'start', type: 'datetime', label: '起', required: true, width: 2 },
          {
            id: 'end',
            type: 'datetime',
            label: '迄',
            required: true,
            width: 2,
            rules: [{ check: { kind: 'compare', op: 'gte', field: 'start' }, message: '結束不可早於開始' }],
          },
        ],
      },
    ],
  });
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r.schema;
}

describe('datetime validation', () => {
  it('accepts YYYY-MM-DDTHH:mm wall time', () => {
    expect(isValidDateTime('2026-10-05T09:30')).toBe(true);
    expect(isValidDateTime('2026-02-30T12:00')).toBe(false);
    expect(isValidDateTime('2026-10-05T25:00')).toBe(false);
    expect(isValidDateTime('2026-10-05')).toBe(false);
  });

  it('validates via validateSubmission and compare rules', () => {
    const schema = schemaWithDatetime();
    const ok = validateSubmission(schema, { start: '2026-10-05T08:00', end: '2026-10-05T18:00' }, TODAY);
    expect(ok.ok).toBe(true);

    const bad = validateSubmission(schema, { start: '2026-10-05T18:00', end: '2026-10-05T08:00' }, TODAY);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.end).toContain('結束不可早於開始');
  });
});
