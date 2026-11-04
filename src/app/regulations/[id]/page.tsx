import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { listRegulationAttachments } from '@/lib/regulations/attachments';
import {
  canManageRegulations,
  getRegulationById,
  getRegulationCategoryMeta,
} from '@/lib/regulations/service';

export const dynamic = 'force-dynamic';

export default async function RegulationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const { id } = await params;
  const canManage = await canManageRegulations(employee);
  const reg = await getRegulationById({ id, manage: canManage });
  if (!reg) notFound();

  const files = await listRegulationAttachments(reg.id);
  const catMeta = getRegulationCategoryMeta(reg.category);

  return (
    <main className="page-shell space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/regulations" className="text-sm font-medium text-td-blue hover:underline">
          ← 返回公司規章列表
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {reg.driveUrl && (
            <a
              href={reg.driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary text-xs"
            >
              開啟 Google Drive 原始文件 ({reg.driveFileName || 'PDF'}) ↗
            </a>
          )}
          {canManage && (
            <Link href={`/admin/regulations/${reg.id}/edit`} className="btn-primary text-xs">
              編輯此規章
            </Link>
          )}
        </div>
      </div>

      <article className="card space-y-6 p-6 md:p-8">
        <header className="space-y-3 border-b border-td-border pb-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
              {reg.code}
            </span>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${catMeta.badgeClass}`}
            >
              {catMeta.label}
            </span>
            {reg.pinned && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                核心必讀規章
              </span>
            )}
            {reg.status !== 'published' && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
                狀態：{reg.status === 'draft' ? '草稿' : '已封存'}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-bold text-td-blue-dark">{reg.title}</h1>

          <dl className="grid gap-3 pt-2 text-xs text-td-muted sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="font-medium text-slate-500">規章版次</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">v{reg.versionLabel}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="font-medium text-slate-500">核定／生效日期</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">{reg.effectiveDate || '—'}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="font-medium text-slate-500">制定／權責單位</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">{reg.ownerDepartment}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="font-medium text-slate-500">核決層級</dt>
              <dd className="mt-0.5 font-semibold text-slate-800">{reg.approverTitle}</dd>
            </div>
          </dl>
        </header>

        {reg.summary && (
          <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-td-blue-dark">
              重點摘要
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{reg.summary}</p>
          </section>
        )}

        {reg.relatedForms && reg.relatedForms.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-td-muted">
              相關使用表單與單據
            </h2>
            <div className="flex flex-wrap gap-2">
              {reg.relatedForms.map((f) => (
                <span
                  key={f}
                  className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-1 text-xs font-semibold text-td-blue-dark"
                >
                  {f}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-td-muted">
            規章條文全文
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white p-5 font-sans text-sm leading-7 text-slate-800 whitespace-pre-wrap">
            {reg.body}
          </div>
        </section>

        {(files.length > 0 || reg.driveUrl) && (
          <section className="space-y-3 border-t border-td-border pt-5">
            <h2 className="text-sm font-bold text-td-blue-dark">規章附件與原始表單下載</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {reg.driveUrl && (
                <li className="flex items-center justify-between rounded-lg border border-td-border bg-slate-50 px-3.5 py-2.5 text-sm">
                  <div className="truncate pr-2">
                    <span className="font-semibold text-td-blue-dark">
                      {reg.driveFileName || `${reg.title}.pdf`}
                    </span>
                    <span className="ml-2 text-xs text-td-muted">（Google Drive 雲端正本）</span>
                  </div>
                  <a
                    href={reg.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-semibold text-td-blue hover:underline"
                  >
                    開啟 ↗
                  </a>
                </li>
              )}
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded-lg border border-td-border bg-white px-3.5 py-2.5 text-sm"
                >
                  <div className="truncate pr-2">
                    <span className="font-medium text-slate-800">{f.fileName}</span>
                    <span className="ml-2 text-xs text-td-muted">
                      ({Math.max(1, Math.round(f.fileSizeBytes / 1024))} KB)
                    </span>
                  </div>
                  <a
                    href={`/api/regulations/${reg.id}/attachments/${f.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 font-semibold text-td-blue hover:underline"
                  >
                    下載
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </main>
  );
}
