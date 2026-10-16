import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/authz/permissions';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getCopySources, getFormBuilderList } from '@/lib/form-builder/queries';
import { FormTable } from './form-table';
import { NewFormPanel } from './new-form-panel';

export default async function FormBuilderListPage() {
  const employee = await getCurrentEmployee();
  const data = await getFormBuilderList();
  if (!data) redirect('/dashboard');
  const sources = await getCopySources();
  const forms = data.forms.map(({ updatedAt, ...f }) => ({ ...f, updatedLabel: updatedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) }));
  const canDelete = Boolean(employee && hasPermission(employee.permissions, 'forms.delete'));
  return (
    <main className="page-shell space-y-5">
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">表單設計器</h1>
        <p className="page-subtitle">
          設計欄位與簽核並發佈。版本、暫停、刪除等規則見{' '}
          <a href="/admin/guide#forms" className="font-semibold text-td-blue underline">
            系統操作教學
          </a>
          。
        </p>
      </section>

      <NewFormPanel categories={data.categories} sources={sources} />

      <FormTable forms={forms} canDelete={canDelete} />
    </main>
  );
}
