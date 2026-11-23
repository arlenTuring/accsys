import {
  getDetailQueueNavigation,
  type DetailQueueNavigation,
} from '@/lib/applications/my-applications';
import { DetailQueueNavClient } from './detail-queue-nav-client';

export async function DetailQueueNav({
  currentId,
  currentCaseNumber,
  currentFormLabel,
  preloadedNav,
  secondaryBackHref,
  secondaryBackLabel,
}: {
  currentId: string;
  currentCaseNumber: string;
  currentFormLabel?: string;
  preloadedNav?: DetailQueueNavigation;
  secondaryBackHref?: string;
  secondaryBackLabel?: string;
}) {
  const nav = preloadedNav ?? (await getDetailQueueNavigation(currentId));
  return (
    <DetailQueueNavClient
      currentId={currentId}
      currentCaseNumber={currentCaseNumber}
      currentFormLabel={currentFormLabel}
      nav={nav}
      secondaryBackHref={secondaryBackHref}
      secondaryBackLabel={secondaryBackLabel}
    />
  );
}
