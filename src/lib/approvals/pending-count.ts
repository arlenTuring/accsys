import { getMyApprovalQueueAll } from '@/lib/approvals/queue';

export async function getPendingApprovalCount(): Promise<number> {
  return (await getMyApprovalQueueAll()).length;
}
