import { describe, expect, it } from 'vitest';
import { addCents, centsToDecimal, MAX_CENTS, multiplyCents, toCents } from './money';

describe('money', () => {
  it('parses numbers and decimal strings exactly', () => {
    expect(toCents(0.1)).toBe(10);
    expect(toCents(1234.5)).toBe(123450);
    expect(toCents('1234.56')).toBe(123456);
    expect(toCents('0.07')).toBe(7);
    expect(toCents('999999999999.99')).toBe(MAX_CENTS);
  });

  it('avoids floating point drift when summing', () => {
    expect(addCents(toCents(0.1), toCents(0.2))).toBe(30);
    expect(centsToDecimal(addCents(toCents(0.1), toCents(0.2)))).toBe('0.30');
  });

  it.each([12.345, '12.345', '1e3', 'abc', NaN, Infinity, null, '', '1000000000000.00', 1e13])(
    'rejects %s',
    (v) => {
      expect(() => toCents(v)).toThrow();
    }
  );

  it('guards multiplication overflow and bad quantities', () => {
    expect(multiplyCents(toCents('100.50'), 3)).toBe(30150);
    expect(() => multiplyCents(toCents('999999999999.99'), 2)).toThrow();
    expect(() => multiplyCents(toCents(1), 0)).toThrow();
    expect(() => multiplyCents(toCents(1), 1.5)).toThrow();
  });

  it('formats cents as numeric literals', () => {
    expect(centsToDecimal(toCents(5))).toBe('5.00');
    expect(centsToDecimal(toCents('-3.5'))).toBe('-3.50');
  });
});
