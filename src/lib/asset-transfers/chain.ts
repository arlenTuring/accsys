import type { ApprovalChainStep, AssetTransferRole } from '@/lib/approval/chain';

export type AssetTransferParties = {
  applicantEmployeeId: string;
  originalCustodianEmployeeId: string;
  newCustodianEmployeeId: string;
  otherCustodianEmployeeId: string | null;
  originalManagerEmployeeId: string;
  newManagerEmployeeId: string;
  otherManagerEmployeeId: string | null;
};

/**
 * Custodians sign first, then their unit managers. The applicant and anyone
 * already in the chain are skipped (one signature per person).
 */
export function generateAssetTransferChain(p: AssetTransferParties): ApprovalChainStep[] {
  const candidates: [string | null, AssetTransferRole][] = [
    [p.originalCustodianEmployeeId, 'original_custodian'],
    [p.newCustodianEmployeeId, 'new_custodian'],
    [p.otherCustodianEmployeeId, 'other_custodian'],
    [p.originalManagerEmployeeId, 'original_custodian_manager'],
    [p.newManagerEmployeeId, 'new_custodian_manager'],
    [p.otherManagerEmployeeId, 'other_custodian_manager'],
  ];
  const seen = new Set<string>([p.applicantEmployeeId]);
  const chain: ApprovalChainStep[] = [];
  for (const [id, role] of candidates) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    chain.push({ approverEmployeeId: id, approverRole: role });
  }
  return chain;
}

/**
 * When every unit manager is the applicant, no independent manager would sign;
 * the general manager (or the chairman, when the applicant is the general
 * manager) is added last. Returns null when nobody can take that step.
 */
export function escalateIfSelfManaged(
  chain: ApprovalChainStep[],
  p: AssetTransferParties,
  top: { generalManagerEmployeeId: string | null; chairmanEmployeeId: string | null }
): ApprovalChainStep[] | null {
  const managers = [p.originalManagerEmployeeId, p.newManagerEmployeeId, p.otherManagerEmployeeId].filter((id): id is string => id !== null);
  if (managers.some((id) => id !== p.applicantEmployeeId)) return chain;
  const steps: [string | null, 'general_manager' | 'chairman'][] = [
    [top.generalManagerEmployeeId, 'general_manager'],
    [top.chairmanEmployeeId, 'chairman'],
  ];
  for (const [id, role] of steps) {
    if (!id || id === p.applicantEmployeeId) continue;
    if (chain.some((s) => s.approverEmployeeId === id)) return chain;
    return [...chain, { approverEmployeeId: id, approverRole: role }];
  }
  return null;
}
