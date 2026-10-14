export type AssetTransferRole =
  | 'original_custodian'
  | 'new_custodian'
  | 'other_custodian'
  | 'original_custodian_manager'
  | 'new_custodian_manager'
  | 'other_custodian_manager';

export type ApprovalRole =
  | 'department_manager'
  | 'budget_owner'
  | 'general_manager'
  | 'chairman'
  /** The named applicant agrees to a form someone else filed for them. */
  | 'applicant_confirmation'
  | AssetTransferRole;

export type ApprovalChainStep = {
  approverEmployeeId: string;
  approverRole: ApprovalRole;
};

export type ApprovalChainInput = {
  applicantEmployeeId: string;
  departmentManagerEmployeeId: string;
  /** null for forms without a budget source (e.g. seal requests). */
  budgetOwnerEmployeeId: string | null;
  generalManagerEmployeeId: string;
  chairmanEmployeeId: string;
  totalAmount: number;
};

export const CHAIRMAN_THRESHOLD = 100000;

/** Someone who filed a form for another employee does not approve it either. */
export function withoutFiler(chain: ApprovalChainStep[], filerEmployeeId: string): ApprovalChainStep[] {
  return chain.filter((s) => s.approverEmployeeId !== filerEmployeeId);
}

export function generateApprovalChain(input: ApprovalChainInput): ApprovalChainStep[] {
  const candidates: ApprovalChainStep[] = [
    { approverEmployeeId: input.departmentManagerEmployeeId, approverRole: 'department_manager' },
  ];
  if (input.budgetOwnerEmployeeId) {
    candidates.push({ approverEmployeeId: input.budgetOwnerEmployeeId, approverRole: 'budget_owner' });
  }
  candidates.push({ approverEmployeeId: input.generalManagerEmployeeId, approverRole: 'general_manager' });
  if (input.totalAmount > CHAIRMAN_THRESHOLD) {
    candidates.push({ approverEmployeeId: input.chairmanEmployeeId, approverRole: 'chairman' });
  }

  const seen = new Set<string>();
  const chain: ApprovalChainStep[] = [];
  for (const step of candidates) {
    if (step.approverEmployeeId === input.applicantEmployeeId) continue;
    if (seen.has(step.approverEmployeeId)) continue;
    seen.add(step.approverEmployeeId);
    chain.push(step);
  }
  return chain;
}
