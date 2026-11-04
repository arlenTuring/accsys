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

export default async function RegulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; q?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const sp = await searchParams;
  const activeCat = typeof sp.cat === 'string' && sp.cat.trim() ? sp.cat.trim() : 'all';
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';

  const [allPublished, filtered, canManage] = await Promise.all([
    listRegulations({ manage: false }),
    listRegulations({
      category: activeCat === 'all' ? undefined : activeCat,
      query: query || undefined,
      manage: false,
    }),
    canManageRegulations(employee),
  ]);

  const countByCat = new Map<string, number>();
  for (const r of allPublished) {
    countByCat.set(r.category, (countByCat.get(r.category) ?? 0) + 1);
  }

  // Group filtered regulations by category in canonical category order
  const categoryOrder = REGULATION_CATEGORIES.map((c) => c.key as string);
  const groupedSections = REGULATION_CATEGORIES.map((cat) => ({
    cat,
    items: filtered.filter((r) => r.category === cat.key),
  })).filter((section) => section.items.length > 0);

  // Any regulations with custom/unlisted category keys
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
          <p className="section-title">公司資訊</p>
          <h1 className="page-title">公司規章與管理辦法</h1>
          <p className="mt-1 text-sm text-td-muted">
            依職能領域分類彙整台灣智慧駕駛各項內控辦法、出勤差旅、採購核銷、薪酬考核與法務用印規範。您也可直接在 AI 助手詢問任何規章條文。
          </p>
        </div>
        {canManage && (
          <Link href="/admin/regulations" className="btn-secondary text-sm">
            管理公司規章 →
          </Link>
        )}
      </section>

      {/* Search & Category Filter Bar */}
      <section className="card space-y-4 p-4">
        <form method="get" className="flex flex-wrap gap-2">
          {activeCat !== 'all' && <input type="hidden" name="cat" value={activeCat} />}
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="搜尋規章名稱、文號、條文關鍵字（如：出差住宿、電動車里程、採購比價、特休、用印）…"
            className="min-w-[16rem] flex-1 rounded-lg border border-td-border px-3.5 py-2 text-sm focus:border-td-blue focus:outline-none"
          />
          <button type="submit" className="btn-primary text-sm">
            搜尋規章
          </button>
          {(query || activeCat !== 'all') && (
            <Link href="/regulations" className="btn-secondary text-sm">
              清除篩選
            </Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2">
          <Link
            href={query ? `/regulations?q=${encodeURIComponent(query)}` : '/regulations'}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              activeCat === 'all'
                ? 'border-td-blue bg-td-blue text-white'
                : 'border-td-border bg-white text-td-text hover:bg-slate-50'
            }`}
          >
            全部分類總覽
            <span className={activeCat === 'all' ? 'text-white/80' : 'text-td-muted'}>
              ({allPublished.length})
            </span>
          </Link>
          {REGULATION_CATEGORIES.map((cat) => {
            const count = countByCat.get(cat.key) ?? 0;
            const isActive = activeCat === cat.key;
            const href = query
              ? `/regulations?cat=${cat.key}&q=${encodeURIComponent(query)}`
              : `/regulations?cat=${cat.key}`;
            return (
              <Link
                key={cat.key}
                href={href}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? 'border-td-blue bg-td-blue text-white'
                    : 'border-td-border bg-white text-td-text hover:bg-slate-50'
                }`}
              >
                {cat.label}
                <span className={isActive ? 'text-white/80' : 'text-td-muted'}>({count})</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Grouped Category Sections */}
      {groupedSections.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-td-muted">找不到符合條件的公司規章。</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groupedSections.map(({ cat, items }) => (
            <section key={cat.key} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-td-border pb-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span
                    className={`rounded-full border px-3 py-0.5 text-xs font-bold ${cat.badgeClass}`}
                  >
                    {cat.label}
                  </span>
                  <h2 className="text-base font-bold text-td-blue-dark">
                    {cat.description}
                  </h2>
                </div>
                <span className="text-xs font-medium text-td-muted">
                  共 {items.length} 份規章
                </span>
              </div>

              <ul className="grid gap-4 md:grid-cols-2">
                {items.map((reg) => (
                  <li
                    key={reg.id}
                    className="card flex flex-col justify-between gap-3 p-5 transition hover:border-td-blue/40 hover:shadow-sm"
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-700">
                            {reg.code}
                          </span>
                          {reg.pinned && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              核心必讀
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-td-muted">
                          版次 v{reg.versionLabel}
                          {reg.effectiveDate ? ` · 核定 ${reg.effectiveDate}` : ''}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-td-blue-dark">
                        <Link
                          href={`/regulations/${reg.id}`}
                          className="hover:text-td-blue hover:underline"
                        >
                          {reg.title}
                        </Link>
                      </h3>

                      <p className="line-clamp-3 text-sm leading-relaxed text-td-muted">
                        {reg.summary || reg.body.slice(0, 160)}
                      </p>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      {reg.relatedForms && reg.relatedForms.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-medium text-td-muted">適用表單：</span>
                          {reg.relatedForms.map((f) => (
                            <span
                              key={f}
                              className="rounded-md bg-blue-50/80 px-2 py-0.5 text-xs font-medium text-td-blue-dark"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-td-muted">
                          權責單位：{reg.ownerDepartment} · 核決：{reg.approverTitle}
                        </span>
                        <div className="flex items-center gap-3">
                          {reg.driveUrl && (
                            <a
                              href={reg.driveUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-slate-600 hover:text-td-blue hover:underline"
                            >
                              原始 PDF ↗
                            </a>
                          )}
                          <Link
                            href={`/regulations/${reg.id}`}
                            className="font-semibold text-td-blue hover:underline"
                          >
                            閱讀完整條文 →
                          </Link>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
