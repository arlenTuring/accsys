export type PurchaseRequestItemInput = {
  budgetCodeId: string;
  budgetOwnerEmployeeId: string;
  itemCategory: string;
  description: string;
  quantity: number;
  estimatedAmount: number;
};

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validatePurchaseRequestInput(
  items: PurchaseRequestItemInput[]
): ValidationResult {
  if (items.length === 0) {
    return { ok: false, error: '請購單至少需要一個明細項次' };
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const lineNo = i + 1;
    if (item.description.trim() === '') {
      return { ok: false, error: `第 ${lineNo} 項的說明不可空白` };
    }
    if (item.quantity <= 0) {
      return { ok: false, error: `第 ${lineNo} 項的數量必須大於 0` };
    }
    if (item.estimatedAmount <= 0) {
      return { ok: false, error: `第 ${lineNo} 項的預估費用必須大於 0` };
    }
  }
  const owners = new Set(items.map((item) => item.budgetOwnerEmployeeId));
  if (owners.size > 1) {
    return { ok: false, error: '一張請購單的所有預算編號必須屬於同一位預算負責人' };
  }
  return { ok: true };
}
