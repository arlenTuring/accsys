import { createAppDb } from '@/lib/db/app-client';
import { canReadForm } from '@/lib/authz/forms';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { FORM_TYPES, FORM_TABLE, FORM_LABELS, type FormType } from '@/lib/procurement/form-registry';

export type CaseFormStatus = {
  formType: FormType;
  label: string;
  itemCode: string;
  exists: boolean;
  /** The form exists but the caller may not open it (id/status withheld). */
  restricted: boolean;
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

/**
 * Only participants see a case: at least one of its forms must be readable by
 * the caller. Forms they cannot open are shown as restricted, without id or
 * status.
 */
export async function getCaseOverview(caseNumber: string): Promise<CaseOverview | null> {
  const actor = await getCurrentEmployee();
  if (!actor) return null;
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
    const readable = data ? await canReadForm(actor, formType, data.id) : false;
    let hasAttachments = false;
    if (data && readable) {
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
      restricted: !!data && !readable,
      id: readable ? data!.id : null,
      status: readable ? data!.status : null,
      hasAttachments,
    });
  }
  if (!forms.some((f) => f.exists && !f.restricted)) return null;
  return { caseNumber: pcase.case_number, forms };
}
