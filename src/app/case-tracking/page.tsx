import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  getDepartmentFilterOptions,
  getFinanceCaseTracking,
  type CaseTrackingFilters,
} from '@/lib/case-tracking/queries';
import { FORM_TYPES, FORM_LABELS } from '@/lib/procurement/form-registry';
import type { CaseBucket } from '@/lib/case-tracking/determine-bucket';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export default async function CaseTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    department?: string;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
  }>;
}) {
  const params = await searchParams;
    const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (employee.role !== 'finance' && employee.role !== 'admin') redirect('/dashboard');

  const tab: CaseBucket =
    params.tab === 'completed' ? 'completed' : params.tab === 'withdrawn' ? 'withdrawn' : 'in_progress';
  const filters: CaseTrackingFilters = {
    departmentCode: params.department || undefined,
    dateFrom: params.dateFrom || undefined,
    dateTo: params.dateTo || undefined,
    keyword: params.q || undefined,
  };

  const [allRows, departmentOptions] = await Promise.all([
    getFinanceCaseTracking(filters),
    getDepartmentFilterOptions(),
  ]);

  const inProgressCount = allRows.filter((r) => r.bucket === 'in_progress').length;
  const completedCount = allRows.filter((r) => r.bucket === 'completed').length;
  const withdrawnCount = allRows.filter((r) => r.bucket === 'withdrawn').length;
  const visibleRows = allRows.filter((r) => r.bucket === tab);

  const baseParams = {
    department: filters.departmentCode,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    q: filters.keyword,
  };

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">財會</p>
        <h1 className="page-title">簽核追蹤</h1>
      </section>

      <nav className="flex flex-wrap gap-2 border-b border-td-border pb-2">
        <Link
          href={buildQuery({ ...baseParams, tab: 'in_progress' })}
          className={
            tab === 'in_progress'
              ? 'rounded-md bg-td-blue px-3 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3 py-1.5 text-sm text-td-muted hover:bg-td-blue-light'
          }
        >
          簽核中（{inProgressCount}）
        </Link>
        <Link
          href={buildQuery({ ...baseParams, tab: 'completed' })}
          className={
            tab === 'completed'
              ? 'rounded-md bg-td-blue px-3 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3 py-1.5 text-sm text-td-muted hover:bg-td-blue-light'
          }
        >
          已完成（{completedCount}）
        </Link>
        <Link
          href={buildQuery({ ...baseParams, tab: 'withdrawn' })}
          className={
            tab === 'withdrawn'
              ? 'rounded-md bg-td-blue px-3 py-1.5 text-sm font-semibold text-white'
              : 'rounded-md px-3 py-1.5 text-sm text-td-muted hover:bg-td-blue-light'
          }
        >
          已撤回（{withdrawnCount}）
        </Link>
      </nav>

      <form method="get" className="card flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col gap-1">
          <span className="text-td-muted">部門</span>
          <select name="department" defaultValue={filters.departmentCode ?? ''} className="rounded-md border border-td-border px-2 py-1.5">
            <option value="">全部</option>
            {departmentOptions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-td-muted">建立日期（起）</span>
          <input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ''} className="rounded-md border border-td-border px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-td-muted">建立日期（迄）</span>
          <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ''} className="rounded-md border border-td-border px-2 py-1.5" />
        </label>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <span className="text-td-muted">關鍵字（案號／申請人）</span>
          <input type="text" name="q" defaultValue={filters.keyword ?? ''} className="rounded-md border border-td-border px-2 py-1.5" />
        </label>
        <button type="submit" className="btn-primary">
          套用篩選
        </button>
      </form>

      {visibleRows.length === 0 ? (
        <div className="card text-sm text-td-muted">目前沒有符合篩選條件的案件</div>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-td-border bg-td-surface text-left">
                <th className="p-3">案號</th>
                <th className="p-3">部門</th>
                <th className="p-3">申請人</th>
                {FORM_TYPES.map((formType) => (
                  <th key={formType} className="p-3">
                    {FORM_LABELS[formType]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.caseNumber} className="border-b border-td-border">
                  <td className="p-3">
                    <Link href={`/cases/${row.caseNumber}`} className="mono-case hover:underline">
                      {row.caseNumber}
                    </Link>
                  </td>
                  <td className="p-3">{row.department?.name ?? '—'}</td>
                  <td className="p-3">{row.applicant ?? '—'}</td>
                  {row.forms.map((f) => (
                    <td key={f.formType} className="p-3">
                      {f.exists ? (STATUS_LABELS[f.status ?? ''] ?? f.status) : '尚未建立'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
