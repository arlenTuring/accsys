'use server';

import { revalidatePath } from 'next/cache';
import { approveAcceptanceStep, returnAcceptanceStep } from '@/lib/acceptances/actions';
import { getFormApprovalSnapshot } from '@/lib/ai-chat/approval-snapshot';
import { approveAssetTransferStep, returnAssetTransferStep } from '@/lib/asset-transfers/actions';
import { approveContractSealStep, returnContractSealStep } from '@/lib/contract-seals/actions';
import { approveCustomFormStep, returnCustomFormStep } from '@/lib/custom-forms/actions';
import { approveExpenseClaimStep, returnExpenseClaimStep } from '@/lib/expense-claims/actions';
import { approveExpenseRequestStep, returnExpenseRequestStep } from '@/lib/expense-requests/actions';
import { approveGeneralSealStep, returnGeneralSealStep } from '@/lib/general-seals/actions';
import { approveInvoiceSealStep, returnInvoiceSealStep } from '@/lib/invoice-seals/actions';
import type { FormType } from '@/lib/procurement/form-registry';
import { approvePurchaseOrderStep, returnPurchaseOrderStep } from '@/lib/purchase-orders/actions';
import { approvePurchaseRequestStep, returnPurchaseRequestStep } from '@/lib/purchase-requests/actions';
import { approveTravelExpenseStep, returnTravelExpenseStep } from '@/lib/travel-expenses/actions';
import { fail, type ActionResult } from '@/lib/workflow/tx';

function refreshHub() {
  revalidatePath('/applications');
  revalidatePath('/approvals');
  revalidatePath('/dashboard');
}

export async function quickApproveFormAction(
  formType: FormType,
  formId: string,
  expectedVersion?: number
): Promise<ActionResult> {
  const version =
    typeof expectedVersion === 'number' && Number.isFinite(expectedVersion)
      ? expectedVersion
      : ((await getFormApprovalSnapshot(formType, formId))?.version ?? 1);

  let result: ActionResult;
  switch (formType) {
    case 'custom':
      result = await approveCustomFormStep(formId, version);
      break;
    case 'purchase_request':
      result = await approvePurchaseRequestStep(formId, version);
      break;
    case 'purchase_order':
      result = await approvePurchaseOrderStep(formId, version);
      break;
    case 'acceptance':
      result = await approveAcceptanceStep(formId, version);
      break;
    case 'expense_request':
      result = await approveExpenseRequestStep(formId, version);
      break;
    case 'travel_expense':
      result = await approveTravelExpenseStep(formId, version);
      break;
    case 'department_expense':
      result = await approveExpenseClaimStep('department', formId, version);
      break;
    case 'project_expense':
      result = await approveExpenseClaimStep('project', formId, version);
      break;
    case 'revenue_expense':
      result = await approveExpenseClaimStep('revenue', formId, version);
      break;
    case 'minor_expense':
      result = await approveExpenseClaimStep('minor', formId, version);
      break;
    case 'contract_seal_request':
      result = await approveContractSealStep(formId, version);
      break;
    case 'general_seal_request':
      result = await approveGeneralSealStep(formId, version);
      break;
    case 'invoice_seal_request':
      result = await approveInvoiceSealStep(formId, version);
      break;
    case 'asset_transfer':
      result = await approveAssetTransferStep(formId, version);
      break;
    default:
      return fail('validation', '不支援的表單類型');
  }

  refreshHub();
  return result;
}

export async function quickReturnFormAction(
  formType: FormType,
  formId: string,
  reason: string,
  expectedVersion?: number
): Promise<ActionResult> {
  const trimmed = reason.trim() || '請補充說明後重送';
  const version =
    typeof expectedVersion === 'number' && Number.isFinite(expectedVersion)
      ? expectedVersion
      : ((await getFormApprovalSnapshot(formType, formId))?.version ?? 1);

  let result: ActionResult;
  switch (formType) {
    case 'custom':
      result = await returnCustomFormStep(formId, trimmed, version);
      break;
    case 'purchase_request':
      result = await returnPurchaseRequestStep(formId, trimmed, version);
      break;
    case 'purchase_order':
      result = await returnPurchaseOrderStep(formId, trimmed, version);
      break;
    case 'acceptance':
      result = await returnAcceptanceStep(formId, trimmed, version);
      break;
    case 'expense_request':
      result = await returnExpenseRequestStep(formId, trimmed, version);
      break;
    case 'travel_expense':
      result = await returnTravelExpenseStep(formId, trimmed, version);
      break;
    case 'department_expense':
      result = await returnExpenseClaimStep('department', formId, trimmed, version);
      break;
    case 'project_expense':
      result = await returnExpenseClaimStep('project', formId, trimmed, version);
      break;
    case 'revenue_expense':
      result = await returnExpenseClaimStep('revenue', formId, trimmed, version);
      break;
    case 'minor_expense':
      result = await returnExpenseClaimStep('minor', formId, trimmed, version);
      break;
    case 'contract_seal_request':
      result = await returnContractSealStep(formId, trimmed, version);
      break;
    case 'general_seal_request':
      result = await returnGeneralSealStep(formId, trimmed, version);
      break;
    case 'invoice_seal_request':
      result = await returnInvoiceSealStep(formId, trimmed, version);
      break;
    case 'asset_transfer':
      result = await returnAssetTransferStep(formId, trimmed, version);
      break;
    default:
      return fail('validation', '不支援的表單類型');
  }

  refreshHub();
  return result;
}
