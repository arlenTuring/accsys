import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CaseTrackingClientList } from '@/app/case-tracking/case-tracking-client';
import {
  APPLICATION_CATEGORY_LABELS,
  type MyApplicationCategoryKey,
} from '@/lib/applications/my-applications';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import {
  getAllCompanyApprovalDocuments,
  type CompanyApprovalTrackingItem,
} from '@/lib/case-tracking/all-documents';
import { getDepartmentFilterOptions } from '@/lib/case-tracking/queries';

export const dynamic = 'force-dynamic';

const CATEGORY_KEYS: MyApplicationCategoryKey[] = [
  'procurement',
  'expense',
  'seal',
  'asset',
  'other',
];

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value !== 'all') usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/case-tracking?${qs}` : '/case-tracking';
}

export default async function CaseTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    cat?: string;
    formLabel?: string;
    department?: string;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
  }>;
}) {
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
  ) as Awaited<typeof searchParams>;

  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/case-tracking');

  const canAccess =
    employee.role === 'admin' ||
    employee.role === 'finance' ||
    employee.permissions.includes('finance.cases') ||
    employee.permissions.includes('forms.read_all') ||
    hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS);
  if (!canAccess) redirect('/dashboard');

  const [allDocuments, departmentOptions] = await Promise.all([
    getAllCompanyApprovalDocuments({ preloadDetailsLimit: 60 }),
    getDepartmentFilterOptions(),
  ]);

  // Normalize tab parameter (support both new and legacy tab query names)
  const rawTab = params.tab?.trim() || 'all';
  const activeTab =
    rawTab === 'in_progress' || rawTab === 'pending_approval'
      ? 'pending_approval'
      : rawTab === 'completed' || rawTab === 'approved'
        ? 'approved'
        : rawTab === 'returned'
          ? 'returned'
          : rawTab === 'withdrawn'
            ? 'withdrawn'
            : 'all';

  const activeCat =
    params.cat && CATEGORY_KEYS.includes(params.cat as MyApplicationCategoryKey)
      ? (params.cat as MyApplicationCategoryKey)
      : 'all';

  const activeDepartment = params.department?.trim() || '';
  const activeFormLabel = params.formLabel?.trim() || '';
  const dateFrom = params.dateFrom?.trim() || '';
  const dateTo = params.dateTo?.trim() || '';
  const keyword = params.q?.trim() || '';

  // Available form labels for dropdown filter
  const formLabelSet = new Set<string>();
  for (const doc of allDocuments) {
    formLabelSet.add(doc.formLabel);
  }
  const formLabelOptions = Array.from(formLabelSet).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant')
  );

  // Filter by department, formLabel, date range, and keyword first so tab/category counts reflect current filter
  const baseFiltered = allDocuments.filter((doc) => {
    if (activeDepartment && doc.departmentCode !== activeDepartment) return false;
    if (activeFormLabel && doc.formLabel !== activeFormLabel) return false;
    if (dateFrom && doc.dateIso < dateFrom) return false;
    if (dateTo && doc.dateIso > dateTo) return false;
    if (keyword) {
      const q = keyword.toLowerCase();
      const haystack = [
        doc.caseNumber,
        doc.procurementCaseNumber ?? '',
        doc.formLabel,
        doc.categoryLabel,
        doc.applicantName,
        doc.departmentName,
        doc.departmentCode,
        doc.summary,
        doc.currentNodeLabel ?? '',
        ...doc.pendingApproverNames,
        ...(doc.progress?.steps.map((s) => `${s.label} ${s.name ?? ''}`) ?? []),
        ...(doc.detail?.fields.map((f) => `${f.label} ${f.value}`) ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Counts by status (respecting activeCat)
  const catFilteredForStatus = baseFiltered.filter(
    (doc) => activeCat === 'all' || doc.categoryKey === activeCat
  );
  const totalCount = catFilteredForStatus.length;
  const pendingCount = catFilteredForStatus.filter(
    (d) => d.status === 'pending_approval'
  ).length;
  const returnedCount = catFilteredForStatus.filter((d) => d.status === 'returned').length;
  const approvedCount = catFilteredForStatus.filter((d) => d.status === 'approved').length;
  const withdrawnCount = catFilteredForStatus.filter(
    (d) => d.status === 'withdrawn'
  ).length;

  // Counts by category (respecting activeTab)
  const tabFilteredForCat = baseFiltered.filter(
    (doc) => activeTab === 'all' || doc.status === activeTab
  );
  const countByCat = new Map<MyApplicationCategoryKey, number>();
  for (const doc of tabFilteredForCat) {
    countByCat.set(doc.categoryKey, (countByCat.get(doc.categoryKey) ?? 0) + 1);
  }

  // Final visible items
  const visibleItems = baseFiltered.filter((doc) => {
    if (activeTab !== 'all' && doc.status !== activeTab) return false;
    if (activeCat !== 'all' && doc.categoryKey !== activeCat) return false;
    return true;
  });

  const groupedByCategory = CATEGORY_KEYS.map((catKey) => ({
    categoryKey: catKey,
    categoryLabel: APPLICATION_CATEGORY_LABELS[catKey],
    items: visibleItems.filter((i) => i.categoryKey === catKey),
  })).filter((g) => g.items.length > 0);

  const filterParams = {
    cat: activeCat !== 'all' ? activeCat : undefined,
    department: activeDepartment || undefined,
    formLabel: activeFormLabel || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    q: keyword || undefined,
  };

  const statusTabs = [
    { key: 'all', label: `全部單據（${totalCount}）` },
    { key: 'pending_approval', label: `簽核中（${pendingCount}）` },
    { key: 'returned', label: `已退回（待修改）（${returnedCount}）` },
    { key: 'approved', label: `已核准（已完成）（${approvedCount}）` },
    { key: 'withdrawn', label: `已撤回／作廢（${withdrawnCount}）` },
  ] as const;

  return (
    <main className="page-shell space-y-5">
      {/* Header */}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">簽核追蹤（全公司單據紀錄追蹤）</h1>
          <p className="mt-1 text-sm text-td-muted">
            涵蓋全公司所有簽核表單（採購流程、費用與差旅報支、用印申請、資產異動、預算與其他表單），可展開檢視單據完整內文與各關卡簽核狀況紀錄（僅供系統追蹤查閱，不於此處執行簽核）。
          </p>
        </div>
      </section>

      {/* Filter Card: Status Tabs + Category Pills + Search & Filters */}
      <div className="card space-y-3.5 !p-4">
        {/* Row 1: Status Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3">
          {statusTabs.map((tItem) => {
            const isActive = activeTab === tItem.key;
            return (
              <Link
                key={tItem.key}
                href={buildQuery({ ...filterParams, tab: tItem.key })}
                className={
                  isActive
                    ? 'rounded-lg bg-td-blue px-3 py-1.5 text-xs font-semibold text-white shadow-2xs'
                    : 'rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-td-text hover:bg-td-blue-light'
                }
              >
                {tItem.label}
              </Link>
            );
          })}
        </div>

        {/* Row 2: Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 pb-3">
          <span className="mr-1 text-xs font-semibold text-td-muted">單據大類：</span>
          <Link
            href={buildQuery({ ...filterParams, tab: activeTab, cat: 'all' })}
            className={
              activeCat === 'all'
                ? 'rounded-full border border-td-blue bg-td-blue-light/50 px-3 py-1 text-xs font-semibold text-td-blue-dark'
                : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300'
            }
          >
            全部分類 ({tabFilteredForCat.length})
          </Link>
          {CATEGORY_KEYS.map((ck) => {
            const c = countByCat.get(ck) ?? 0;
            const isActive = activeCat === ck;
            return (
              <Link
                key={ck}
                href={buildQuery({ ...filterParams, tab: activeTab, cat: ck })}
                className={
                  isActive
                    ? 'rounded-full border border-td-blue bg-td-blue-light/50 px-3 py-1 text-xs font-semibold text-td-blue-dark'
                    : 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300'
                }
              >
                {APPLICATION_CATEGORY_LABELS[ck]} ({c})
              </Link>
            );
          })}
        </div>

        {/* Row 3: Form Filter Bar */}
        <form method="get" action="/case-tracking" className="flex flex-wrap items-end gap-3 text-xs">
          {activeTab !== 'all' && <input type="hidden" name="tab" value={activeTab} />}
          {activeCat !== 'all' && <input type="hidden" name="cat" value={activeCat} />}

          <label className="flex flex-col gap-1">
            <span className="font-semibold text-td-muted">部門</span>
            <select
              name="department"
              defaultValue={activeDepartment}
              className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">全部部門</option>
              {departmentOptions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold text-td-muted">表單種類</span>
            <select
              name="formLabel"
              defaultValue={activeFormLabel}
              className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs"
            >
              <option value="">全部表單種類</option>
              {formLabelOptions.map((fl) => (
                <option key={fl} value={fl}>
                  {fl}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold text-td-muted">申請日期（起）</span>
            <input
              type="date"
              name="dateFrom"
              defaultValue={dateFrom}
              className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-semibold text-td-muted">申請日期（迄）</span>
            <input
              type="date"
              name="dateTo"
              defaultValue={dateTo}
              className="rounded-lg border border-td-border bg-white px-2.5 py-1.5 text-xs"
            />
          </label>

          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="font-semibold text-td-muted">
              關鍵字（單號／案號／表單名稱／申請人／簽核人／事由）
            </span>
            <input
              type="text"
              name="q"
              defaultValue={keyword}
              placeholder="輸入單號、申請人、簽核人或內文關鍵字…"
              className="rounded-lg border border-td-border bg-white px-3 py-1.5 text-xs focus:border-td-blue focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-lg bg-td-blue px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-td-blue-dark"
            >
              套用篩選
            </button>
            {(activeDepartment || activeFormLabel || dateFrom || dateTo || keyword || activeCat !== 'all') && (
              <Link
                href={buildQuery({ tab: activeTab })}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                清除條件
              </Link>
            )}
          </div>
        </form>
      </div>

      {/* Results List */}
      {visibleItems.length === 0 ? (
        <div className="card py-10 text-center text-sm text-td-muted">
          目前沒有符合篩選條件的簽核單據
        </div>
      ) : (
        <CaseTrackingClientList
          items={visibleItems as CompanyApprovalTrackingItem[]}
          groupedByCategory={groupedByCategory}
        />
      )}
    </main>
  );
}
