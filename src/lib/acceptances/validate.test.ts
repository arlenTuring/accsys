import { describe, expect, it } from 'vitest';
import { validateAcceptanceInput } from './validate';

describe('validateAcceptanceInput', () => {
  it('accepts a non-empty item list', () => {
    expect(validateAcceptanceInput({ items: [{ passFail: 'pass' }] })).toEqual({ ok: true });
  });

  it('accepts a mix of pass and fail', () => {
    expect(
      validateAcceptanceInput({ items: [{ passFail: 'pass' }, { passFail: 'fail' }] })
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    expect(validateAcceptanceInput({ items: [] })).toEqual({
      ok: false,
      error: '驗收單至少需要一個明細項次',
    });
  });
});
