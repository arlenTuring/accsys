import { createSupabaseServerClient } from '@/lib/supabase/server';

export type CaseFormType = 'purchase_request' | 'purchase_order' | 'acceptance' | 'expense_request';

export type CaseFormStatus = {
  formType: CaseFormType;
  label: string;
  itemCode: string;
  exists: boolean;
  id: string | null;
  status: string | null;
};

export type CaseOverview = {
  caseNumber: string;
  forms: CaseFormStatus[];
};

const FORM_DEFS: { formType: CaseFormType; table: string; label: string; itemCode: string }[] = [
  { formType: 'purchase_request', table: 'purchase_requests', label: '請購單', itemCode: 'A1' },
  { formType: 'purchase_order', table: 'purchase_orders', label: '採購單', itemCode: 'B1' },
  { formType: 'acceptance', table: 'acceptances', label: '驗收單', itemCode: 'C1' },
  { formType: 'expense_request', table: 'expense_requests', label: '費用申請單', itemCode: 'D1' },
];

export async function getCaseOverview(caseNumber: string): Promise<CaseOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data: pcase } = await supabase
    .from('procurement_cases')
    .select('id, case_number')
    .eq('case_number', caseNumber)
    .maybeSingle();
  if (!pcase) return null;

  const forms: CaseFormStatus[] = [];
  for (const def of FORM_DEFS) {
    const { data } = await supabase
      .from(def.table)
      .select('id, status')
      .eq('procurement_case_id', pcase.id)
      .maybeSingle();
    forms.push({
      formType: def.formType,
      label: def.label,
      itemCode: def.itemCode,
      exists: !!data,
      id: data?.id ?? null,
      status: data?.status ?? null,
    });
  }
  return { caseNumber: pcase.case_number, forms };
}
