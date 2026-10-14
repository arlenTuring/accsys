import { getMyContractSealApprovalQueue, getMyContractSealRequests } from '@/lib/contract-seals/queries';
import { getMyGeneralSealApprovalQueue, getMyGeneralSealRequests } from '@/lib/general-seals/queries';
import { getMyInvoiceSealApprovalQueue, getMyInvoiceSealRequests } from '@/lib/invoice-seals/queries';
import type { SealListItem, SealQueueItem } from '@/lib/seal-requests/queries';

/** Every seal form where I am the applicant or the filer, newest first. */
export async function getMySealRequests(): Promise<SealListItem[]> {
  const lists = await Promise.all([getMyContractSealRequests(), getMyGeneralSealRequests(), getMyInvoiceSealRequests()]);
  return lists.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Every seal form waiting for my decision, oldest first per form. */
export async function getMySealApprovalQueue(): Promise<SealQueueItem[]> {
  const queues = await Promise.all([
    getMyContractSealApprovalQueue(),
    getMyGeneralSealApprovalQueue(),
    getMyInvoiceSealApprovalQueue(),
  ]);
  return queues.flat();
}
