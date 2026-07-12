import { describe, expect, it } from 'vitest';
import { validateExpenseRequestInput } from './validate';

describe('validateExpenseRequestInput', () => {
  it('accepts a supplier payee with a chosen supplier and at least one item', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: 'S1',
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: true });
  });

  it('accepts an employee payee with a bank account and at least one item', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'employee',
        payeeSupplierId: null,
        bankAccount: '1234567890',
        includedItemCount: 1,
      })
    ).toEqual({ ok: true });
  });

  it('rejects zero included items', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: 'S1',
        bankAccount: null,
        includedItemCount: 0,
      })
    ).toEqual({ ok: false, error: '費用申請單至少需要一個明細項次' });
  });

  it('rejects a supplier payee with no supplier chosen', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'supplier',
        payeeSupplierId: null,
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: false, error: '付款對象為廠商時必須選擇廠商' });
  });

  it('rejects an employee payee with no bank account', () => {
    expect(
      validateExpenseRequestInput({
        payeeType: 'employee',
        payeeSupplierId: null,
        bankAccount: null,
        includedItemCount: 1,
      })
    ).toEqual({ ok: false, error: '付款對象為員工時必須填寫銀行帳號' });
  });
});
