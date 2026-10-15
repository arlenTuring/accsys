import { redirect } from 'next/navigation';
import { getCopySources, getFormBuilderList } from '@/lib/form-builder/queries';
import { FormTable } from './form-table';
import { NewFormPanel } from './new-form-panel';

export default async function FormBuilderListPage() {
  const data = await getFormBuilderList();
  if (!data) redirect('/dashboard');
  const sources = await getCopySources();
  const forms = data.forms.map(({ updatedAt, ...f }) => ({ ...f, updatedLabel: updatedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) }));
  return (
    <main className="page-shell space-y-5">
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">表單設計器</h1>
        <p className="page-subtitle">
          設計表單欄位與簽核流程，發佈後就會出現在「申請表單」選單。每次發佈都會產生新版本；已送出的單據永遠依送出時的版本顯示與簽核。修改需 1 小時內登入過，所有變更都會記錄稽核。
        </p>
        <p className="page-subtitle">
          不再使用的表單可以「暫停」（選單隱藏、不能新填，已送出的單據照常簽核），之後可重新發佈或刪除；刪除時已送出的單據會保留。「複製」會建立一份內容相同的草稿。
        </p>
      </section>

      <NewFormPanel categories={data.categories} sources={sources} />

      <FormTable forms={forms} />
    </main>
  );
}
