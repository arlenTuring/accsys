export type ApprovalRole =
  | 'department_manager'
  | 'budget_owner'
  | 'general_manager'
  | 'chairman';

export type ApprovalChainStep = {
  approverEmployeeId: string;
  approverRole: ApprovalRole;
};

export type ApprovalChainInput = {
  applicantEmployeeId: string;
  departmentManagerEmployeeId: string;
  budgetOwnerEmployeeId: string;
  generalManagerEmployeeId: string;
  chairmanEmployeeId: string;
  totalAmount: number;
};

const CHAIRMAN_THRESHOLD = 100000;

export function generateApprovalChain(input: ApprovalChainInput): ApprovalChainStep[] {
  const candidates: ApprovalChainStep[] = [
    { approverEmployeeId: input.departmentManagerEmployeeId, approverRole: 'department_manager' },
    { approverEmployeeId: input.budgetOwnerEmployeeId, approverRole: 'budget_owner' },
    { approverEmployeeId: input.generalManagerEmployeeId, approverRole: 'general_manager' },
  ];
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
