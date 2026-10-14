import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCopySources, getFormBuilderList } from '@/lib/form-builder/queries';
import { STATUS_BADGE } from './builder-ui';
import { NewFormPanel } from './new-form-panel';

export default async function FormBuilderListPage() {
  const data = await getFormBuilderList();
  if (!data) redirect('/dashboard');
  const sources = await getCopySources();
  return (
    <main className="page-shell space-y-5">
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">表單設計器</h1>
        <p className="page-subtitle">
          設計表單欄位與簽核流程，發佈後就會出現在「申請表單」選單。每次發佈都會產生新版本；已送出的單據永遠依送出時的版本顯示與簽核。修改需 1 小時內登入過，所有變更都會記錄稽核。
        </p>
      </section>

      <NewFormPanel categories={data.categories} sources={sources} />

      <section className="card !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-td-border bg-slate-50 text-left text-xs text-td-muted">
                <th className="px-4 py-2.5 font-semibold">表單</th>
                <th className="px-4 py-2.5 font-semibold">分類</th>
                <th className="px-4 py-2.5 font-semibold">狀態</th>
                <th className="px-4 py-2.5 font-semibold">目前版本</th>
                <th className="px-4 py-2.5 font-semibold">單據（簽核中）</th>
                <th className="px-4 py-2.5 font-semibold">最後修改</th>
              </tr>
            </thead>
            <tbody>
              {data.forms.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-td-muted">
                    還沒有設計器表單，從上方「新增表單」開始。
                  </td>
                </tr>
              )}
              {data.forms.map((f) => (
                <tr key={f.id} className="border-b border-td-border last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/form-builder/${f.id}`} className="font-semibold text-td-blue hover:underline">
                      {f.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-td-muted">{f.key}</span>
                  </td>
                  <td className="px-4 py-3">{f.categoryTitle}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[f.status].cls}>{STATUS_BADGE[f.status].label}</span>
                    {f.hasDraft && f.publishedVersion !== null && <span className="badge ml-1 bg-amber-50 text-amber-800">有未發佈的修改</span>}
                  </td>
                  <td className="px-4 py-3">{f.publishedVersion === null ? '—' : `第 ${f.publishedVersion} 版`}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {f.submissionCount}（{f.openCount}）
                  </td>
                  <td className="px-4 py-3 text-xs text-td-muted">{f.updatedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
