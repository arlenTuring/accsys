import { describe, expect, it } from 'vitest';
import { validatePurchaseRequestInput } from './validate';

const item = {
  budgetCodeId: 'B1',
  budgetOwnerEmployeeId: 'O1',
  itemCategory: '材料',
  description: '材料A',
  quantity: 1,
  estimatedAmount: 65000,
};

describe('validatePurchaseRequestInput', () => {
  it('accepts a single valid item', () => {
    expect(validatePurchaseRequestInput([item])).toEqual({ ok: true });
  });

  it('accepts multiple items sharing one budget owner', () => {
    expect(
      validatePurchaseRequestInput([item, { ...item, budgetCodeId: 'B2', description: '材料B' }])
    ).toEqual({ ok: true });
  });

  it('rejects an empty item list', () => {
    const result = validatePurchaseRequestInput([]);
    expect(result).toEqual({ ok: false, error: '請購單至少需要一個明細項次' });
  });

  it('rejects an item with a blank description', () => {
    const result = validatePurchaseRequestInput([{ ...item, description: '   ' }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的說明不可空白' });
  });

  it('rejects an item with non-positive quantity', () => {
    const result = validatePurchaseRequestInput([{ ...item, quantity: 0 }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的數量必須大於 0' });
  });

  it('rejects an item with non-positive estimated amount', () => {
    const result = validatePurchaseRequestInput([{ ...item, estimatedAmount: 0 }]);
    expect(result).toEqual({ ok: false, error: '第 1 項的預估費用必須大於 0' });
  });

  it('rejects items spanning more than one budget owner', () => {
    const result = validatePurchaseRequestInput([
      item,
      { ...item, budgetCodeId: 'B2', budgetOwnerEmployeeId: 'O2', description: '材料B' },
    ]);
    expect(result).toEqual({
      ok: false,
      error: '一張請購單的所有預算編號必須屬於同一位預算負責人',
    });
  });
});
