import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RegulationEditorForm } from '@/app/admin/regulations/regulation-editor-form';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canManageRegulations, REGULATION_CATEGORIES } from '@/lib/regulations/service';

export const dynamic = 'force-dynamic';

const CODE_PREFIX_BY_CAT: Record<string, string> = {
  hr_attendance: 'TD-HR-',
  hr_compensation: 'TD-HR-',
  hr_talent: 'TD-HR-',
  hr_welfare_safety: 'TD-HR-',
  finance_procurement: 'TD-FIN-',
  admin_legal: 'TD-ADM-',
};

export default async function NewRegulationPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageRegulations(employee))) redirect('/regulations');

  const sp = await searchParams;
  const rawCat = typeof sp.cat === 'string' ? sp.cat.trim() : '';
  const validCat = REGULATION_CATEGORIES.some((c) => c.key === rawCat)
    ? rawCat
    : 'hr_attendance';
  const codePrefix = CODE_PREFIX_BY_CAT[validCat] ?? 'TD-REG-';

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">新增公司規章</h1>
        </div>
        <Link href="/admin/regulations" className="text-sm font-medium text-td-blue hover:underline">
          ← 返回規章管理列表
        </Link>
      </section>

      <RegulationEditorForm
        mode="create"
        initial={{
          code: `${codePrefix}NEW`,
          title: '',
          category: validCat,
          versionLabel: '1.0',
          effectiveDate: new Date().toISOString().slice(0, 10),
          ownerDepartment: '管理部',
          approverTitle: '董事長',
          summary: '',
          body: '',
          relatedForms: [],
          driveUrl: '',
          driveFileName: '',
          status: 'published',
          pinned: false,
          sortOrder: 50,
        }}
      />
    </main>
  );
}
