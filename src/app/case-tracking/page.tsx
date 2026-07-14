import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
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
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');
  if (employee.role !== 'finance') redirect('/dashboard');

  const tab: CaseBucket = params.tab === 'completed' ? 'completed' : 'in_progress';
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
  const visibleRows = allRows.filter((r) => r.bucket === tab);

  const baseParams = {
    department: filters.departmentCode,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    q: filters.keyword,
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">簽核追蹤</h1>

      <nav className="flex gap-4 border-b">
        <Link
          href={buildQuery({ ...baseParams, tab: 'in_progress' })}
          className={
            tab === 'in_progress'
              ? 'border-b-2 border-blue-600 pb-2 font-semibold'
              : 'pb-2 text-gray-500'
          }
        >
          簽核中（{inProgressCount}）
        </Link>
        <Link
          href={buildQuery({ ...baseParams, tab: 'completed' })}
          className={
            tab === 'completed'
              ? 'border-b-2 border-blue-600 pb-2 font-semibold'
              : 'pb-2 text-gray-500'
          }
        >
          已完成（{completedCount}）
        </Link>
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col">
          部門
          <select name="department" defaultValue={filters.departmentCode ?? ''} className="border p-1">
            <option value="">全部</option>
            {departmentOptions.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          建立日期（起）
          <input type="date" name="dateFrom" defaultValue={filters.dateFrom ?? ''} className="border p-1" />
        </label>
        <label className="flex flex-col">
          建立日期（迄）
          <input type="date" name="dateTo" defaultValue={filters.dateTo ?? ''} className="border p-1" />
        </label>
        <label className="flex flex-col">
          關鍵字（案號／申請人）
          <input type="text" name="q" defaultValue={filters.keyword ?? ''} className="border p-1" />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-1 text-white">
          套用篩選
        </button>
      </form>

      {visibleRows.length === 0 ? (
        <p className="text-gray-500">目前沒有符合篩選條件的案件</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">案號</th>
              <th className="p-2">部門</th>
              <th className="p-2">申請人</th>
              {FORM_TYPES.map((formType) => (
                <th key={formType} className="p-2">
                  {FORM_LABELS[formType]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.caseNumber} className="border-b">
                <td className="p-2">
                  <Link href={`/cases/${row.caseNumber}`} className="text-blue-600 underline">
                    {row.caseNumber}
                  </Link>
                </td>
                <td className="p-2">{row.department?.name ?? '—'}</td>
                <td className="p-2">{row.applicant ?? '—'}</td>
                {row.forms.map((f) => (
                  <td key={f.formType} className="p-2">
                    {f.exists ? (STATUS_LABELS[f.status ?? ''] ?? f.status) : '尚未建立'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
