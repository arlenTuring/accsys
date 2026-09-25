import { createAppDb } from '@/lib/db/app-client';
import { FORM_TYPES, FORM_TABLE, FORM_LABELS, type FormType } from '@/lib/procurement/form-registry';

export type CaseFormStatus = {
  formType: FormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
  hasAttachments: boolean;
};

export type CaseOverview = {
  caseNumber: string;
  forms: CaseFormStatus[];
};

const FORM_ITEM_CODES: Record<FormType, string> = {
  purchase_request: 'A1',
  purchase_order: 'B1',
  acceptance: 'C1',
  expense_request: 'D1',
};

export async function getCaseOverview(caseNumber: string): Promise<CaseOverview | null> {
  const supabase = createAppDb();
  const { data: pcase } = await supabase
    .from('procurement_cases')
    .select('id, case_number')
    .eq('case_number', caseNumber)
    .maybeSingle();
  if (!pcase) return null;

  const forms: CaseFormStatus[] = [];
  for (const formType of FORM_TYPES) {
    const { data } = await supabase
      .from(FORM_TABLE[formType])
      .select('id, status')
      .eq('procurement_case_id', pcase.id)
      .maybeSingle();
    let hasAttachments = false;
    if (data) {
      const { count } = await supabase
        .from('attachments')
        .select('id', { count: 'exact', head: true })
        .eq('form_type', formType)
        .eq('form_id', data.id);
      hasAttachments = (count ?? 0) > 0;
    }
    forms.push({
      formType,
      label: FORM_LABELS[formType],
      itemCode: FORM_ITEM_CODES[formType],
      exists: !!data,
      id: data?.id ?? null,
      status: data?.status ?? null,
      hasAttachments,
    });
  }
  return { caseNumber: pcase.case_number, forms };
}
