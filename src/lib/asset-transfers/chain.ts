import type { ApprovalChainStep, AssetTransferRole } from '@/lib/approval/chain';
import type { AssetTransferType } from '@/lib/asset-transfers/constants';

export type AssetTransferParties = {
  applicantEmployeeId: string;
  originalCustodianEmployeeId: string;
  newCustodianEmployeeId: string;
  otherCustodianEmployeeId: string | null;
  originalManagerEmployeeId: string;
  newManagerEmployeeId: string;
  otherManagerEmployeeId: string | null;
  transferTypes?: readonly AssetTransferType[];
};

const NON_CUSTODIAN_TYPES: readonly AssetTransferType[] = ['lend', 'merge', 'sell', 'scrap', 'other'];

export function isNonCustodianTransfer(transferTypes?: readonly AssetTransferType[]): boolean {
  if (!transferTypes || transferTypes.length === 0) return false;
  return transferTypes.some((t) => NON_CUSTODIAN_TYPES.includes(t));
}

/**
 * 資產異動的兩種流程（第 36、37 條）：
 * 1. 單純保管人異動（移轉／調撥）：原保管人 → 原保管單位主管 → 新保管人 → 新保管單位主管（含其他保管人及其主管）。
 * 2. 借出、合併、出售、報廢、其他（處分）：原保管人 → 新保管人 → 其他保管人 → 原保管單位主管 → 新保管單位主管 → 其他保管單位主管（後續固定加簽總經理）。
 * The applicant and anyone already in the chain are skipped (one signature per person).
 */
export function generateAssetTransferChain(p: AssetTransferParties): ApprovalChainStep[] {
  const candidates: [string | null, AssetTransferRole][] = isNonCustodianTransfer(p.transferTypes)
    ? [
        [p.originalCustodianEmployeeId, 'original_custodian'],
        [p.newCustodianEmployeeId, 'new_custodian'],
        [p.otherCustodianEmployeeId, 'other_custodian'],
        [p.originalManagerEmployeeId, 'original_custodian_manager'],
        [p.newManagerEmployeeId, 'new_custodian_manager'],
        [p.otherManagerEmployeeId, 'other_custodian_manager'],
      ]
    : [
        [p.originalCustodianEmployeeId, 'original_custodian'],
        [p.originalManagerEmployeeId, 'original_custodian_manager'],
        [p.newCustodianEmployeeId, 'new_custodian'],
        [p.newManagerEmployeeId, 'new_custodian_manager'],
        [p.otherCustodianEmployeeId, 'other_custodian'],
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
 * - For non-custodian transfers (借出、合併、出售、報廢、其他), 總經理 is always required;
 *   if every unit manager & 總經理 is the applicant, 董事長 signs as fallback.
 * - For pure custodian changes, when every unit manager is the applicant, no independent
 *   manager would sign; the general manager (or the chairman, when the applicant is the
 *   general manager) is added last.
 * Returns null when nobody can take that step.
 */
export function escalateIfSelfManaged(
  chain: ApprovalChainStep[],
  p: AssetTransferParties,
  top: { generalManagerEmployeeId: string | null; chairmanEmployeeId: string | null }
): ApprovalChainStep[] | null {
  const managers = [p.originalManagerEmployeeId, p.newManagerEmployeeId, p.otherManagerEmployeeId].filter((id): id is string => id !== null);
  const allManagersSelf = !managers.some((id) => id !== p.applicantEmployeeId);

  if (isNonCustodianTransfer(p.transferTypes)) {
    const gmId = top.generalManagerEmployeeId;
    if (!gmId) return null;
    const nextChain = [...chain];
    if (gmId !== p.applicantEmployeeId && !nextChain.some((s) => s.approverEmployeeId === gmId)) {
      nextChain.push({ approverEmployeeId: gmId, approverRole: 'general_manager' });
    }
    if (allManagersSelf && gmId === p.applicantEmployeeId) {
      const chId = top.chairmanEmployeeId;
      if (!chId || chId === p.applicantEmployeeId) return null;
      if (!nextChain.some((s) => s.approverEmployeeId === chId)) {
        nextChain.push({ approverEmployeeId: chId, approverRole: 'chairman' });
      }
    }
    return nextChain.length > 0 ? nextChain : null;
  }

  if (!allManagersSelf) return chain;
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
