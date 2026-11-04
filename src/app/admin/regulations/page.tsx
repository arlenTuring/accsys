import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  canManageRegulations,
  getRegulationCategoryMeta,
  listRegulations,
  REGULATION_CATEGORIES,
} from '@/lib/regulations/service';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  published: { label: '已發布', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  draft: { label: '草稿', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  archived: { label: '已封存', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default async function AdminRegulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageRegulations(employee))) redirect('/regulations');

  const sp = await searchParams;
  const activeCat = typeof sp.cat === 'string' && sp.cat.trim() ? sp.cat.trim() : 'all';
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';

  const [allManaged, filtered] = await Promise.all([
    listRegulations({ manage: true }),
    listRegulations({
      category: activeCat === 'all' ? undefined : activeCat,
      query: query || undefined,
      manage: true,
    }),
  ]);

  const countByCat = new Map<string, number>();
  for (const r of allManaged) {
    countByCat.set(r.category, (countByCat.get(r.category) ?? 0) + 1);
  }

  const categoryOrder = REGULATION_CATEGORIES.map((c) => c.key as string);
  const groupedSections = REGULATION_CATEGORIES.map((cat) => ({
    cat,
    items: filtered.filter((r) => r.category === cat.key),
  })).filter((section) =>
    activeCat === 'all' ? section.items.length > 0 || !query : section.cat.key === activeCat
  );

  const otherItems = filtered.filter((r) => !categoryOrder.includes(r.category));
  if (otherItems.length > 0) {
    groupedSections.push({
      cat: getRegulationCategoryMeta('general'),
      items: otherItems,
    });
  }

  return (
    <main className="page-shell space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">系統管理</p>
          <h1 className="page-title">公司規章管理</h1>
          <p className="mt-1 text-sm text-td-muted">
            依分類管理公司內部規章、管理辦法與 SOP 文件。儲存或發布規章時，系統會自動即時更新 AI 助手知識庫。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/regulations" className="btn-secondary text-sm">
            前往同仁閱覽頁 →
          </Link>
          <Link
            href={
              activeCat !== 'all'
                ? `/admin/regulations/new?cat=${encodeURIComponent(activeCat)}`
                : '/admin/regulations/new'
            }
            className="btn-primary text-sm"
          >
            + 新增公司規章
          </Link>
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <form method="get" className="flex flex-wrap gap-2">
          {activeCat !== 'all' && <input type="hidden" name="cat" value={activeCat} />}
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="搜尋規章編號、標題、條文關鍵字或適用表單…"
            className="min-w-[16rem] flex-1 rounded-lg border border-td-border px-3.5 py-2 text-sm"
          />
          <button type="submit" className="btn-secondary text-sm">
            搜尋
          </button>
          {(query || activeCat !== 'all') && (
            <Link href="/admin/regulations" className="btn-secondary text-sm">
              重置
            </Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/regulations"
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              activeCat === 'all'
                ? 'border-td-blue bg-td-blue text-white'
                : 'border-td-border bg-white text-td-text hover:bg-slate-50'
            }`}
          >
            全部分類 ({allManaged.length})
          </Link>
          {REGULATION_CATEGORIES.map((cat) => {
            const count = countByCat.get(cat.key) ?? 0;
            const isActive = activeCat === cat.key;
            return (
              <Link
                key={cat.key}
                href={`/admin/regulations?cat=${cat.key}`}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  isActive
                    ? 'border-td-blue bg-td-blue text-white'
                    : 'border-td-border bg-white text-td-text hover:bg-slate-50'
                }`}
              >
                {cat.label} ({count})
              </Link>
            );
          })}
        </div>
      </section>

      {/* Grouped Category Sections for Admin */}
      <div className="space-y-6">
        {groupedSections.map(({ cat, items }) => (
          <section
            key={cat.key}
            className="overflow-hidden rounded-xl border border-td-border bg-white shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-td-border bg-slate-50/80 px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${cat.badgeClass}`}
                >
                  {cat.label}
                </span>
                <span className="text-xs text-td-muted">{cat.description}</span>
                <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-semibold text-slate-700">
                  {items.length} 份
                </span>
              </div>
              <Link
                href={`/admin/regulations/new?cat=${encodeURIComponent(cat.key)}`}
                className="text-xs font-semibold text-td-blue hover:underline"
              >
                + 新增「{cat.label}」規章
              </Link>
            </div>

            {items.length === 0 ? (
              <p className="px-5 py-6 text-center text-xs text-td-muted">
                此分類目前尚無規章。
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-white text-xs font-semibold text-td-muted">
                  <tr>
                    <th className="w-36 px-5 py-2.5">編號</th>
                    <th className="px-4 py-2.5">規章名稱與摘要</th>
                    <th className="w-40 px-4 py-2.5">權責單位</th>
                    <th className="w-36 px-4 py-2.5">版次／核定日</th>
                    <th className="w-24 px-4 py-2.5">狀態</th>
                    <th className="w-28 px-5 py-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((r) => {
                    const st = STATUS_LABEL[r.status] ?? {
                      label: r.status,
                      cls: 'bg-slate-100 text-slate-700 border-slate-200',
                    };
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs font-semibold text-slate-700">
                          {r.code}
                          {r.pinned && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] font-bold text-amber-800">
                              必讀
                            </span>
                          )}
                        </td>
                        <td className="max-w-md px-4 py-3">
                          <Link
                            href={`/admin/regulations/${r.id}/edit`}
                            className="font-semibold text-td-blue-dark hover:text-td-blue hover:underline"
                          >
                            {r.title}
                          </Link>
                          <p className="mt-0.5 line-clamp-1 text-xs text-td-muted">{r.summary}</p>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                          {r.ownerDepartment}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-td-muted">
                          v{r.versionLabel}
                          {r.effectiveDate ? ` · ${r.effectiveDate}` : ''}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${st.cls}`}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-xs">
                          <div className="inline-flex items-center gap-3">
                            <Link
                              href={`/regulations/${r.id}`}
                              className="font-medium text-slate-600 hover:text-td-blue hover:underline"
                            >
                              預覽
                            </Link>
                            <Link
                              href={`/admin/regulations/${r.id}/edit`}
                              className="font-semibold text-td-blue hover:underline"
                            >
                              編輯
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
