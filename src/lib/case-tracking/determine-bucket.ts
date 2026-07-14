import type { FormType } from '@/lib/procurement/form-registry';

export type CaseFormState = {
  formType: FormType;
  exists: boolean;
  status: string | null;
};

export type CaseBucket = 'in_progress' | 'completed';

export function determineCaseBucket(forms: CaseFormState[]): CaseBucket {
  const allApproved = forms.every((form) => form.exists && form.status === 'approved');
  return allApproved ? 'completed' : 'in_progress';
}
