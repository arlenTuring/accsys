export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateExpenseRequestInput(input: {
  payeeType: 'employee' | 'supplier';
  payeeSupplierId: string | null;
  bankAccount: string | null;
  includedItemCount: number;
}): ValidationResult {
  if (input.includedItemCount === 0) {
    return { ok: false, error: '費用申請單至少需要一個明細項次' };
  }
  if (input.payeeType === 'supplier' && !input.payeeSupplierId) {
    return { ok: false, error: '付款對象為廠商時必須選擇廠商' };
  }
  if (input.payeeType === 'employee' && !input.bankAccount) {
    return { ok: false, error: '付款對象為員工時必須填寫銀行帳號' };
  }
  return { ok: true };
}
