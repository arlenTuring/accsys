import { UnifiedApplicationsAndApprovalsView } from '@/app/applications/page';

export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cat?: string; q?: string }>;
}) {
  return <UnifiedApplicationsAndApprovalsView basePath="/approvals" searchParams={searchParams} />;
}
