import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CollapsibleSection,
  CompactMyApplicationRow,
  QuickPendingApprovalRow,
} from '@/app/applications/approval-hub-client';
import {
  APPLICATION_CATEGORY_LABELS,
  getMyApplicationsAll,
  getMyPendingApprovalsEnriched,
  type MyApplicationCategoryKey,
  type MyApplicationItem,
  type PendingApprovalRichItem,
} from '@/lib/applications/my-applications';
import { ensureDemoPendingApprovals } from '@/lib/applications/seed-pending-demo';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export const dynamic = 'force-dynamic';

async function generateDemoApprovalsAction() {
  'use server';
  await ensureDemoPendingApprovals({ force: true });
  revalidatePath('/applications');
  revalidatePath('/approvals');
  revalidatePath('/dashboard');
}

const STATUS_TABS = [
  { key: 'all', label: '全部' },
  { key: 'to_approve', label: '待我簽核' },
  { key: 'pending_approval', label: '簽核中' },
  { key: 'returned', label: '已退回' },
  { key: 'approved', label: '已核准' },
] as const;

const CATEGORY_KEYS: MyApplicationCategoryKey[] = [
  'procurement',
  'expense',
  'seal',
  'asset',
  'other',
];

function buildFilterHref(
  basePath: string,
  params: { status?: string; cat?: string; q?: string }
) {
  const usp = new URLSearchParams();
  if (params.status && params.status !== 'all') usp.set('status', params.status);
  if (params.cat && params.cat !== 'all') usp.set('cat', params.cat);
  if (params.q && params.q.trim()) usp.set('q', params.q.trim());
  const qs = usp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function UnifiedApplicationsAndApprovalsView({
  basePath,
  searchParams,
}: {
  basePath: '/applications' | '/approvals';
  searchParams: Promise<{ status?: string; cat?: string; q?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect(`/login?returnTo=${basePath}`);

  const sp = await searchParams;
  const activeStatus = typeof sp.status === 'string' && sp.status.trim() ? sp.status.trim() : 'all';
  const activeCat = typeof sp.cat === 'string' && sp.cat.trim() ? sp.cat.trim() : 'all';
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';

  await ensureDemoPendingApprovals();

  const [pendingApprovals, myItems] = await Promise.all([
    getMyPendingApprovalsEnriched(),
    getMyApplicationsAll(),
  ]);

  const countByStatus = new Map<string, number>();
  const countByCat = new Map<string, number>();

  for (const item of myItems) {
    countByStatus.set(item.status, (countByStatus.get(item.status) ?? 0) + 1);
    countByCat.set(item.categoryKey, (countByCat.get(item.categoryKey) ?? 0) + 1);
  }
  for (const q of pendingApprovals) {
    countByCat.set(q.categoryKey, (countByCat.get(q.categoryKey) ?? 0) + 1);
  }

  const toApproveCount = pendingApprovals.length;
  const totalCombinedCount = toApproveCount + myItems.length;

  const showApprovalsSection = activeStatus === 'all' || activeStatus === 'to_approve';
  const filteredApprovals = showApprovalsSection
    ? pendingApprovals.filter((item) => {
        if (activeCat !== 'all' && item.categoryKey !== activeCat) return false;
        if (query) {
          const q = query.toLowerCase();
          const haystack = [
            item.caseNumber,
            item.formLabel,
            item.categoryLabel,
            item.applicantName,
            item.summary,
            item.currentNodeLabel ?? '',
            ...(item.progress?.steps.map((s) => `${s.label} ${s.name ?? ''}`) ?? []),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
    : [];

  const showMyItemsSection = activeStatus !== 'to_approve';
  const filteredMyItems = showMyItemsSection
    ? myItems.filter((item) => {
        if (activeStatus !== 'all' && item.status !== activeStatus) return false;
        if (activeCat !== 'all' && item.categoryKey !== activeCat) return false;
        if (query) {
          const q = query.toLowerCase();
          const haystack = [
            item.caseNumber,
            item.formLabel,
            item.categoryLabel,
            item.summary,
            item.currentNodeLabel ?? '',
            ...item.pendingApproverNames,
            ...(item.progress?.steps.map((s) => `${s.label} ${s.name ?? ''}`) ?? []),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
    : [];

  // Group pending approvals by categoryKey
  const approvalsByCat = new Map<MyApplicationCategoryKey, PendingApprovalRichItem[]>();
  for (const item of filteredApprovals) {
    const list = approvalsByCat.get(item.categoryKey) ?? [];
    list.push(item);
    approvalsByCat.set(item.categoryKey, list);
  }

  // Group my applications by categoryKey
  const myItemsByCat = new Map<MyApplicationCategoryKey, MyApplicationItem[]>();
  for (const item of filteredMyItems) {
    const list = myItemsByCat.get(item.categoryKey) ?? [];
    list.push(item);
    myItemsByCat.set(item.categoryKey, list);
  }

  return (
    <main className="page-shell space-y-5">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-td-blue-dark">簽核管理</h1>
          <p className="text-xs text-td-muted">
            依表單群組歸類顯示；可獨立收合「待我簽核」、「我的申請」或各分類群組，並直接在卡片上快速簽核。
          </p>
        </div>
      </section>

      {/* Filter & Search Toolbar */}
      <section className="card space-y-2.5 !p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((tab) => {
              const count =
                tab.key === 'all'
                  ? totalCombinedCount
                  : tab.key === 'to_approve'
                    ? toApproveCount
                    : (countByStatus.get(tab.key) ?? 0);
              const isActive = activeStatus === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={buildFilterHref(basePath, { status: tab.key, cat: activeCat, q: query })}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-td-blue text-white'
                      : tab.key === 'to_approve' && count > 0
                        ? 'bg-amber-100 text-amber-900 hover:bg-amber-200/80'
                        : tab.key === 'returned' && count > 0
                          ? 'bg-rose-100 text-rose-800 hover:bg-rose-200/80'
                          : 'bg-slate-100 text-td-text hover:bg-slate-200/70'
                  }`}
                >
                  {tab.label} ({count})
                </Link>
              );
            })}
          </div>

          <form method="get" className="flex items-center gap-1.5">
            {activeStatus !== 'all' && <input type="hidden" name="status" value={activeStatus} />}
            {activeCat !== 'all' && <input type="hidden" name="cat" value={activeCat} />}
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="搜尋單號、申請人、事由…"
              className="w-48 rounded-md border border-td-border px-2.5 py-1.5 text-xs focus:border-td-blue focus:outline-none sm:w-56"
            />
            <button type="submit" className="btn-secondary !px-3 !py-1.5 text-xs">
              搜尋
            </button>
            {(activeStatus !== 'all' || activeCat !== 'all' || query) && (
              <Link href={basePath} className="px-1 text-xs text-td-muted hover:text-td-blue">
                重置
              </Link>
            )}
          </form>
        </div>

        {/* Category Quick Filter */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-xs font-medium text-td-muted">群組篩選：</span>
          <Link
            href={buildFilterHref(basePath, { status: activeStatus, cat: 'all', q: query })}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
              activeCat === 'all'
                ? 'border-td-blue-dark bg-td-blue-dark text-white'
                : 'border-td-border bg-white text-td-text hover:bg-slate-50'
            }`}
          >
            全部群組 ({totalCombinedCount})
          </Link>
          {CATEGORY_KEYS.map((catKey) => {
            const count = countByCat.get(catKey) ?? 0;
            if (count === 0 && activeCat !== catKey) return null;
            const isActive = activeCat === catKey;
            return (
              <Link
                key={catKey}
                href={buildFilterHref(basePath, { status: activeStatus, cat: catKey, q: query })}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                  isActive
                    ? 'border-td-blue-dark bg-td-blue-dark text-white'
                    : 'border-td-border bg-white text-td-text hover:bg-slate-50'
                }`}
              >
                {APPLICATION_CATEGORY_LABELS[catKey]} ({count})
              </Link>
            );
          })}
        </div>
      </section>

      {/* Section 1: Pending My Approval (grouped by Category) */}
      {showApprovalsSection && (
        <CollapsibleSection
          badgeText="待我簽核"
          badgeClass="bg-amber-100 text-amber-900"
          title="等待您審核簽核的表單"
          countText={`${filteredApprovals.length} 件`}
          defaultOpen
          headerActions={
            <form action={generateDemoApprovalsAction}>
              <button
                type="submit"
                className="rounded-md border border-td-border bg-white px-2.5 py-1 text-xs font-semibold text-td-blue hover:bg-slate-50"
              >
                + 補充待簽範例
              </button>
            </form>
          }
        >
          {filteredApprovals.length === 0 ? (
            <div className="card flex flex-wrap items-center justify-between gap-2 !py-4 text-xs text-td-muted">
              <span>目前沒有等待您簽核的表單。</span>
              {activeStatus === 'to_approve' && myItems.length > 0 && (
                <Link
                  href={buildFilterHref(basePath, { status: 'all', cat: activeCat, q: query })}
                  className="font-semibold text-td-blue hover:underline"
                >
                  顯示全部單據（{myItems.length} 件）→
                </Link>
              )}
            </div>
          ) : (
            CATEGORY_KEYS.map((catKey) => {
              const groupItems = approvalsByCat.get(catKey);
              if (!groupItems || groupItems.length === 0) return null;
              return (
                <CollapsibleSection
                  key={`pending-group-${catKey}`}
                  variant="group"
                  categoryKey={catKey}
                  title={APPLICATION_CATEGORY_LABELS[catKey]}
                  countText={`${groupItems.length} 件`}
                  defaultOpen
                >
                  {groupItems.map((item) => (
                    <QuickPendingApprovalRow key={`appr-${item.formType}-${item.id}`} item={item} />
                  ))}
                </CollapsibleSection>
              );
            })
          )}
        </CollapsibleSection>
      )}

      {/* Section 2: My Submitted Applications (grouped by Category) */}
      {showMyItemsSection && (
        <CollapsibleSection
          badgeText="我的申請"
          badgeClass="bg-blue-100 text-td-blue-dark"
          title="我送出的申請單據與簽核進度"
          countText={`${filteredMyItems.length} 件`}
          defaultOpen
        >
          {filteredMyItems.length === 0 ? (
            <div className="card !py-6 text-center text-xs text-td-muted">
              {myItems.length === 0
                ? '您目前還沒有送出過任何申請表單。'
                : '找不到符合篩選條件的申請紀錄。'}
            </div>
          ) : (
            CATEGORY_KEYS.map((catKey) => {
              const groupItems = myItemsByCat.get(catKey);
              if (!groupItems || groupItems.length === 0) return null;
              return (
                <CollapsibleSection
                  key={`mine-group-${catKey}`}
                  variant="group"
                  categoryKey={catKey}
                  title={APPLICATION_CATEGORY_LABELS[catKey]}
                  countText={`${groupItems.length} 件`}
                  defaultOpen
                >
                  {groupItems.map((item) => (
                    <CompactMyApplicationRow key={`mine-${item.formType}-${item.id}`} item={item} />
                  ))}
                </CollapsibleSection>
              );
            })
          )}
        </CollapsibleSection>
      )}
    </main>
  );
}

export default async function MyApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cat?: string; q?: string }>;
}) {
  return <UnifiedApplicationsAndApprovalsView basePath="/applications" searchParams={searchParams} />;
}
