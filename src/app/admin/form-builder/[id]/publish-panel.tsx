'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { FlowDef } from '@/lib/approval/flow/types';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { deleteDraftDefinitionAction, discardDraftAction, publishDraftAction, setArchivedAction } from '@/lib/form-builder/actions';
import { changeSummary, hasChanges } from '@/lib/form-builder/diff';
import type { BuilderStatus, BuilderVersion } from '@/lib/form-builder/queries';
import { dangerBtn, smallBtn } from '../../org/org-ui';
import { STATUS_BADGE } from '../builder-ui';

type Notify = (m: { kind: 'ok' | 'error'; text: string; reauth?: boolean }) => void;
type Result = { ok: true } | { ok: false; code: string; error: string };

export function PublishPanel({
  id,
  status,
  rowVersion,
  dirty,
  hasDraft,
  save,
  problems,
  draft,
  published,
  versions,
  notify,
  reload,
}: {
  id: string;
  status: BuilderStatus;
  rowVersion: number;
  dirty: boolean;
  hasDraft: boolean;
  /** Saves the editor's draft; the new row version, or null when it failed (already reported). */
  save: () => Promise<number | null>;
  problems: string[];
  draft: { schema: FormSchema; flow: FlowDef } | null;
  published: { version: number; schema: FormSchema; flow: FlowDef } | null;
  versions: BuilderVersion[];
  notify: Notify;
  reload: () => void;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, start] = useTransition();
  const summary = draft ? changeSummary(published, draft) : null;
  const nothingToPublish = !dirty && !hasDraft;
  const canPublish = problems.length === 0 && !nothingToPublish && confirmed && (summary === null || hasChanges(summary));

  const act = (fn: () => Promise<Result | null>, success: string, after: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if (r === null) return;
        if (r.ok) {
          notify({ kind: 'ok', text: success });
          after();
        } else {
          notify({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
        }
      } catch {
        notify({ kind: 'error', text: '連線失敗，請稍後再試' });
      }
    });

  const publish = () =>
    act(
      async () => {
        const version = dirty ? await save() : rowVersion;
        if (version === null) return null;
        const r = await publishDraftAction(id, version);
        return r.ok ? { ok: true as const } : r;
      },
      `已發佈第 ${(published?.version ?? 0) + 1} 版，新送出的單據會使用這個版本`,
      reload
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-4">
        <section className="card space-y-3">
          <h2 className="text-base font-semibold text-td-blue-dark">發佈新版本</h2>
          <p className="text-sm">
            目前狀態：<span className={STATUS_BADGE[status].cls}>{STATUS_BADGE[status].label}</span>
            {published && <span className="ml-2 text-td-muted">生效中：第 {published.version} 版</span>}
          </p>
          {nothingToPublish ? (
            <p className="text-sm text-td-muted">沒有尚未發佈的修改。</p>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-td-blue-dark">發佈前檢查</p>
                {problems.length === 0 ? (
                  <p className="mt-1 text-sm text-emerald-700">✓ 欄位與流程設定完整。發佈時伺服器會再檢查一次（含流程指定的員工、部門、職務、群組是否仍在職或啟用）。</p>
                ) : (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-red-700">
                    {problems.slice(0, 12).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                    {problems.length > 12 && <li>另有 {problems.length - 12} 項</li>}
                  </ul>
                )}
              </div>
              {summary && (
                <div>
                  <p className="text-sm font-semibold text-td-blue-dark">{published ? `與第 ${published.version} 版相比` : '第一次發佈'}</p>
                  {!hasChanges(summary) ? (
                    <p className="mt-1 text-sm text-td-muted">內容與目前生效的版本相同。</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {summary.added.length > 0 && <li>新增欄位：{summary.added.join('、')}</li>}
                      {summary.removed.length > 0 && <li className="text-amber-800">移除欄位：{summary.removed.join('、')}（舊單據仍會顯示）</li>}
                      {summary.modified.length > 0 && <li>修改欄位：{summary.modified.join('、')}</li>}
                      {published && summary.sectionsChanged && <li>區段或欄位順序有調整</li>}
                      {summary.onBehalfChanged && <li>{draft?.schema.onBehalf ? '開啟' : '關閉'}「允許代為申請」</li>}
                      {summary.assetRegisterChanged && <li>{draft?.schema.assetRegister ? '調整' : '關閉'}「財產清冊串接」</li>}
                      {published && summary.flowChanged && <li>簽核流程有變更（只影響發佈後新送出的單據）</li>}
                    </ul>
                  )}
                </div>
              )}
              {dirty && <p className="text-xs text-td-muted">畫面上有尚未儲存的修改，發佈時會先儲存草稿。</p>}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                我已確認以上變更；已送出的單據不受影響
              </label>
              <button type="button" className="btn-primary" disabled={!canPublish || pending} onClick={publish}>
                {pending ? '處理中…' : '發佈'}
              </button>
            </>
          )}
        </section>

        <section className="card space-y-3">
          <h2 className="text-base font-semibold text-td-blue-dark">其他操作</h2>
          <div className="flex flex-wrap gap-2">
            {hasDraft && published && (
              <button
                type="button"
                className={smallBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`捨棄所有尚未發佈的修改，回到第 ${published.version} 版？`)) return;
                  act(() => discardDraftAction(id, rowVersion), '已捨棄草稿', reload);
                }}
              >
                捨棄草稿，回到生效版本
              </button>
            )}
            {status === 'published' && (
              <button
                type="button"
                className={dangerBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm('下架後選單不再出現這張表單，也不能新填；已送出的單據照常簽核。確定下架？')) return;
                  act(() => setArchivedAction(id, true, rowVersion), '已下架', reload);
                }}
              >
                下架
              </button>
            )}
            {status === 'archived' && (
              <button type="button" className={smallBtn} disabled={pending} onClick={() => act(() => setArchivedAction(id, false, rowVersion), '已重新上架', reload)}>
                重新上架
              </button>
            )}
            {status === 'draft' && versions.length === 0 && (
              <button
                type="button"
                className={dangerBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm('刪除這張尚未發佈的表單？')) return;
                  act(() => deleteDraftDefinitionAction(id, rowVersion), '已刪除', () => router.push('/admin/form-builder'));
                }}
              >
                刪除表單
              </button>
            )}
          </div>
          <p className="text-xs text-td-muted">發佈過的表單不能刪除（保留舊單據的版本），可以下架。</p>
        </section>
      </div>

      <section className="card h-fit space-y-2 !p-3">
        <h2 className="text-sm font-semibold text-td-blue-dark">版本紀錄</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-td-muted">尚未發佈。</p>
        ) : (
          <ol className="space-y-1 text-sm">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center gap-2 rounded border border-td-border px-2 py-1.5">
                <span className="font-semibold text-td-blue-dark">第 {v.version} 版</span>
                {v.current && <span className="badge-approved">生效中</span>}
                <span className="ml-auto text-right text-xs text-td-muted">
                  {v.publishedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}・{v.publishedByName}
                  <span className="block">單據 {v.submissionCount} 張</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
