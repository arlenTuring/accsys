'use client';

import Link from 'next/link';
import { deleteDefinitionAction, setArchivedAction } from '@/lib/form-builder/actions';
import type { BuilderListItem } from '@/lib/form-builder/queries';
import { ActionMessage, dangerBtn, smallBtn, useOrgAction } from '../org/org-ui';
import { STATUS_BADGE } from './builder-ui';

export type FormTableRow = Omit<BuilderListItem, 'updatedAt'> & { updatedLabel: string };

/** Why a form cannot be deleted (the server checks again, including other forms that use it as 關聯單據 source). */
function deleteBlocker(f: FormTableRow): string | null {
  if (f.submissionCount > 0) return `已有 ${f.submissionCount} 張單據，不能刪除；不再使用請按「暫停」`;
  if (f.replacesLegacy) return '已取代舊版系統表單，不能刪除；不再使用請按「暫停」';
  return null;
}

function deleteQuestion(f: FormTableRow): string {
  if (f.publishedVersion === null) return `刪除「${f.name}」？草稿與設定會一併刪除，無法復原。`;
  return `刪除「${f.name}」？\n\n這張表單已發佈（第 ${f.publishedVersion} 版），還沒有人填寫過。刪除後選單與連結會消失，所有版本一併刪除，無法復原。`;
}

export function FormTable({ forms }: { forms: FormTableRow[] }) {
  const { pending, msg, run } = useOrgAction();

  const pause = (f: FormTableRow) => {
    if (!window.confirm(`暫停「${f.name}」？\n\n暫停後選單不再出現這張表單，也不能新填；已送出的單據照常簽核、修改與重送。之後可以重新發佈。`)) return;
    run(() => setArchivedAction(f.id, true, f.rowVersion), `已暫停「${f.name}」`);
  };
  const resume = (f: FormTableRow) => {
    if (!window.confirm(`以第 ${f.publishedVersion} 版重新發佈「${f.name}」？選單會再出現這張表單。`)) return;
    run(() => setArchivedAction(f.id, false, f.rowVersion), `已重新發佈「${f.name}」`);
  };
  const remove = (f: FormTableRow) => {
    if (!window.confirm(deleteQuestion(f))) return;
    run(() => deleteDefinitionAction(f.id, f.rowVersion), `已刪除「${f.name}」`);
  };

  return (
    <section className="space-y-3">
      <ActionMessage msg={msg} />
      <div className="card !p-0">
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
                <th className="px-4 py-2.5 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody>
              {forms.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-td-muted">
                    還沒有設計器表單，從上方「新增表單」開始。
                  </td>
                </tr>
              )}
              {forms.map((f) => {
                const blocker = deleteBlocker(f);
                return (
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
                    <td className="px-4 py-3 text-xs text-td-muted">{f.updatedLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        <Link href={`/admin/form-builder/${f.id}`} className={smallBtn}>
                          編輯
                        </Link>
                        {f.status === 'published' && (
                          <button type="button" className={smallBtn} disabled={pending} onClick={() => pause(f)}>
                            暫停
                          </button>
                        )}
                        {f.status === 'archived' && (
                          <button type="button" className={smallBtn} disabled={pending} onClick={() => resume(f)}>
                            重新發佈
                          </button>
                        )}
                        <span title={blocker ?? undefined}>
                          <button type="button" className={dangerBtn} disabled={pending || blocker !== null} onClick={() => remove(f)}>
                            刪除
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
