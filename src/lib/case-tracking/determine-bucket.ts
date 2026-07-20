import type { FormType } from '@/lib/procurement/form-registry';

export type CaseFormState = {
  formType: FormType;
  exists: boolean;
  status: string | null;
};

export type CaseType = 'standard' | 'standalone_expense';
export type CaseBucket = 'in_progress' | 'completed' | 'withdrawn';

export function determineCaseBucket(forms: CaseFormState[], caseType: CaseType): CaseBucket {
  const anyWithdrawn = forms.some((form) => form.exists && form.status === 'withdrawn');
  if (anyWithdrawn) return 'withdrawn';

  if (caseType === 'standalone_expense') {
    const expenseForm = forms.find((f) => f.formType === 'expense_request');
    const complete = !!expenseForm && expenseForm.exists && expenseForm.status === 'approved';
    return complete ? 'completed' : 'in_progress';
  }
  const allApproved = forms.every((form) => form.exists && form.status === 'approved');
  return allApproved ? 'completed' : 'in_progress';
}
