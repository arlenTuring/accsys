import { describe, expect, it } from 'vitest';
import { canSeeRemittance, maskRemittance } from './mask';

describe('maskRemittance', () => {
  it('hides all digits but the last four, keeping the bank and account name', () => {
    expect(maskRemittance('台灣銀行(004) 林小明 0123-4567-8901')).toBe('台灣銀行(＊＊＊) 林小明 ＊＊＊＊-＊＊＊＊-8901');
  });

  it('masks full-width and mixed-width digits the same way', () => {
    expect(maskRemittance('台銀 ０１２３４５６７８９０１')).toBe('台銀 ＊＊＊＊＊＊＊＊８９０１');
    expect(maskRemittance('012３４５-6789')).toBe('＊＊＊＊＊＊-6789');
  });

  it('leaves text without an account number alone', () => {
    expect(maskRemittance('無')).toBe('無');
    expect(maskRemittance('末碼 12')).toBe('末碼 12');
  });
});

describe('canSeeRemittance', () => {
  it('shows the full account to the applicant, finance and admin only', () => {
    expect(canSeeRemittance({ id: 'A', role: 'staff' }, 'A')).toBe(true);
    expect(canSeeRemittance({ id: 'F', role: 'finance' }, 'A')).toBe(true);
    expect(canSeeRemittance({ id: 'X', role: 'admin' }, 'A')).toBe(true);
    expect(canSeeRemittance({ id: 'M', role: 'staff' }, 'A')).toBe(false);
    expect(canSeeRemittance(null, 'A')).toBe(false);
  });
});
