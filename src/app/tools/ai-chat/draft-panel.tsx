'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CustomForm } from '@/app/f/custom-form';
import {
  getDraftPanelAction,
  saveDraftAction,
  submitDraftAction,
} from '@/lib/ai-chat/actions';
import type { ApplicationDraft } from '@/lib/ai-chat/drafts';
import type { FormSchema } from '@/lib/custom-forms/schema';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { DraftAttachedFiles, type DraftAttachedFile } from './draft-attached-files';

type Props = {
  draftId: string;
  conversationId: string;
  /** Change this when the server draft version advances (e.g. after AI patch). */
  refreshKey?: number | string;
  /** @deprecated Remote writes always remount; kept for call-site compatibility. */
  allowRemoteRefresh?: boolean;
  onSubmitted?: (info: { formNumber: string; href: string; submissionId: string; formKey: string }) => void;
  onVersionChange?: (draft: ApplicationDraft) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLoadState?: (state: 'loading' | 'ready' | 'error', error?: string) => void;
};

type PanelState = {
  draft: ApplicationDraft;
  formKey: string;
  name: string;
  description: string | null;
  schema: FormSchema;
  options: PickerOptions;
  currentEmployeeId: string;
  versionMismatch: boolean;
  resubmit: { formNumber: string; href: string; reason: string | null } | null;
  today: string;
  files: DraftAttachedFile[];
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '（空白）';
  if (typeof v === 'object') return 'rows' in (v as object) ? `${((v as { rows?: unknown[] }).rows ?? []).length} 列明細` : JSON.stringify(v);
  return String(v).replace('T', ' ');
}

export function DraftPanel({
  draftId,
  conversationId,
  refreshKey = 0,
  onSubmitted,
  onVersionChange,
  onDirtyChange,
  onLoadState,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveNote, setSaveNote] = useState<string | null>(null);
  /** Server data the form was loaded from (merge base for the next save). */
  const baseRef = useRef<{ version: number; data: Record<string, unknown> } | null>(null);
  /** Version this panel itself just saved (a reload of it is not news). */
  const savedRef = useRef<{ version: number; at: string } | null>(null);
  /** One formal submit at a time: repeated clicks never start a second save + submit. */
  const submittingRef = useRef(false);
  /** Formal submit waits for an explicit 確認送出 (sending a chat message never submits). */
  const [confirming, setConfirming] = useState<{ resolve: (ok: boolean) => void; rows: { label: string; value: string }[] } | null>(null);
  /** Newer server version that arrived while the panel had unsaved edits. */
  const [pendingRemote, setPendingRemote] = useState<{ version: number; fields: string[] } | null>(null);
  const [conflict, setConflict] = useState<{
    latest: ApplicationDraft;
    items: { field: string; label: string; mine: unknown; theirs: unknown }[];
    mine: Record<string, unknown>;
  } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [remoteNotice, setRemoteNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState | null>(null);
  /** Bumps on every successful fetch so CustomForm remounts (it only reads `initial` once). */
  const [formMountId, setFormMountId] = useState(0);
  const lastRefreshKey = useRef(refreshKey);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;

  const reload = useCallback(
    async (opts?: { soft?: boolean; fromRemote?: boolean; discardLocal?: boolean }) => {
      const requestDraftId = draftIdRef.current;
      const soft = Boolean(opts?.soft);
      if (!soft) {
        setLoading(true);
        onLoadState?.('loading');
      }
      setError(null);
      try {
        const res = await getDraftPanelAction(requestDraftId);
        // Ignore stale responses if the user switched tabs mid-flight.
        if (draftIdRef.current !== requestDraftId) return;
        if (!res.ok) {
          setError(res.error);
          setPanel(null);
          onLoadState?.('error', res.error);
          return;
        }
        if (opts?.fromRemote && dirtyRef.current && !opts.discardLocal) {
          // Unsaved manual edits: keep them on screen, say what changed remotely.
          const base = baseRef.current?.data ?? {};
          const keys = new Set([...Object.keys(base), ...Object.keys(res.draft.data)]);
          const labels = new Map(res.schema.sections.flatMap((sec) => sec.fields.map((f) => [f.id, f.label] as const)));
          const fields = [...keys]
            .filter((k) => JSON.stringify(base[k] ?? null) !== JSON.stringify(res.draft.data[k] ?? null))
            .map((k) => labels.get(k) ?? k);
          if (res.draft.version !== baseRef.current?.version) setPendingRemote({ version: res.draft.version, fields });
          onVersionChange?.(res.draft);
          return;
        }
        setPanel({
          draft: res.draft,
          formKey: res.formKey,
          name: res.name,
          description: res.description,
          schema: res.schema,
          options: res.options,
          currentEmployeeId: res.currentEmployeeId,
          versionMismatch: res.versionMismatch,
          resubmit: res.resubmit,
          today: res.today,
          files: res.files,
        });
        baseRef.current = { version: res.draft.version, data: res.draft.data };
        setPendingRemote(null);
        setConflict(null);
        // Remount the form with server `data` (CustomForm reads `initial` once).
        setFormMountId((n) => n + 1);
        setSaveState('idle');
        setSaveNote(
          savedRef.current?.version === res.draft.version
            ? `已儲存 v${res.draft.version} · ${savedRef.current.at}`
            : `已載入 v${res.draft.version}`
        );
        setDirty(false);
        onDirtyChange?.(false);
        onLoadState?.('ready');
        onVersionChange?.(res.draft);
        setRemoteNotice(opts?.fromRemote && opts.discardLocal ? '已載入最新版本，先前未儲存的修改已放棄。' : null);
      } catch (err) {
        if (draftIdRef.current !== requestDraftId) return;
        const msg = err instanceof Error ? err.message : '載入草稿失敗';
        setError(msg);
        setPanel(null);
        onLoadState?.('error', msg);
      } finally {
        if (!soft && draftIdRef.current === requestDraftId) setLoading(false);
      }
    },
    [onDirtyChange, onLoadState, onVersionChange]
  );

  useEffect(() => {
    lastRefreshKey.current = refreshKey;
    setPanel(null);
    setFormMountId(0);
    void reload({ soft: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount load on draft identity
  }, [draftId]);

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    void reload({ soft: true, fromRemote: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /** Save with merge base; on failure the form keeps every typed value. */
  async function save(data: Record<string, unknown>, expectedVersion: number, baseData: Record<string, unknown> | null) {
    if (!panel) return;
    setSaveState('saving');
    setSaveNote('儲存中…');
    let res: Awaited<ReturnType<typeof saveDraftAction>>;
    try {
      res = await saveDraftAction({ draftId: panel.draft.id, expectedVersion, data, baseData });
    } catch {
      setSaveState('error');
      setSaveNote('連線中斷，尚未儲存。您的輸入仍保留在畫面上，恢復連線後再按「儲存草稿」。');
      throw new Error('連線中斷，尚未儲存。');
    }
    if (!res.ok) {
      setSaveState('error');
      if (res.code === 'conflict') {
        const mineChanged = Object.fromEntries(
          Object.keys({ ...(baseData ?? {}), ...data })
            .filter((k) => JSON.stringify(data[k] ?? null) !== JSON.stringify(baseData?.[k] ?? null))
            .map((k) => [k, data[k]])
        );
        setConflict({ latest: res.draft, items: res.conflicts, mine: mineChanged });
        setSaveNote('尚未儲存：有欄位衝突，請在上方選擇。');
      } else {
        setSaveNote(`尚未儲存：${res.error}`);
      }
      throw new Error(res.error);
    }
    setSaveState('saved');
    setPendingRemote(null);
    setConflict(null);
    setDirty(false);
    onDirtyChange?.(false);
    setPanel((prev) => (prev ? { ...prev, draft: res.draft } : prev));
    onVersionChange?.(res.draft);
    baseRef.current = { version: res.draft.version, data: res.draft.data };
    savedRef.current = { version: res.draft.version, at: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) };
    setSaveNote(`已儲存 v${res.draft.version} · ${savedRef.current.at}`);
    // Merged with someone else's changes: show the combined result.
    if (res.mergedFields) void reload({ soft: true });
  }

  if (loading && !panel) {
    return <p className="p-4 text-base text-td-muted">載入草稿…</p>;
  }
  if (error || !panel) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-base text-amber-800">{error ?? '無法載入草稿'}</p>
        <button type="button" className="btn-secondary text-base" onClick={() => void reload()}>
          重試載入
        </button>
      </div>
    );
  }

  if (panel.draft.status === 'submitted') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-base text-emerald-900">
        此草稿已送出
        {panel.draft.submissionId && (
          <a className="mt-2 block underline" href={`/f/${panel.formKey}/${panel.draft.submissionId}`}>
            查看單據
          </a>
        )}
      </div>
    );
  }

  const filledCount = Object.keys(panel.draft.data ?? {}).filter((k) => {
    const v = panel.draft.data[k];
    if (v == null || v === '') return false;
    if (typeof v === 'object' && v !== null && 'rows' in v) {
      return Array.isArray((v as { rows?: unknown[] }).rows) && (v as { rows: unknown[] }).rows.length > 0;
    }
    return true;
  }).length;

  return (
    <div
      className="space-y-3"
      onInput={() => {
        if (!dirty) {
          setDirty(true);
          onDirtyChange?.(true);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-td-muted">
        <span>
          資料庫欄位 {filledCount} 項 · v{panel.draft.version}
          {loading ? ' · 重新載入中…' : ''}
        </span>
        <button
          type="button"
          className="underline"
          disabled={loading}
          onClick={() => void reload({ soft: false, fromRemote: true })}
        >
          重新載入草稿
        </button>
      </div>
      {confirming && (
        <div ref={(el) => el?.scrollIntoView({ block: 'center' })} role="dialog" aria-modal="true" aria-labelledby="submit-confirm-title" className="rounded-lg border-2 border-td-blue bg-white px-4 py-3 text-base shadow">
          <p id="submit-confirm-title" className="font-semibold text-td-blue-dark">
            {panel?.resubmit ? `確認重新送出「${panel.name}」？` : `確認正式送出「${panel?.name}」？`}
          </p>
          <p className="mt-1 text-sm text-td-muted">
            {panel?.resubmit
              ? `會更新原單 ${panel.resubmit.formNumber} 並重新進入簽核，不會產生新單號。`
              : '送出後會建立正式單據並進入簽核，不能再以草稿修改。'}
          </p>
          {confirming.rows.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {confirming.rows.map((r) => (
                <li key={r.label}>
                  <span className="text-td-muted">{r.label}：</span>
                  {r.value}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary text-base" autoFocus onClick={() => confirming.resolve(true)}>
              {panel?.resubmit ? '確認重新送出' : '確認送出'}
            </button>
            <button type="button" className="btn-secondary text-base" onClick={() => confirming.resolve(false)}>
              返回修改
            </button>
          </div>
        </div>
      )}
      {pendingRemote && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-950">
          助手已把草稿更新到 v{pendingRemote.version}
          {pendingRemote.fields.length > 0 ? `（${pendingRemote.fields.join('、')}）` : ''}。您有尚未儲存的修改，畫面沒有自動套用。
          按「儲存草稿」會合併不同欄位；同一欄位兩邊都改時會請您選擇。
          <button type="button" className="ml-2 underline" onClick={() => void reload({ soft: true, fromRemote: true, discardLocal: true })}>
            放棄我的修改，載入 v{pendingRemote.version}
          </button>
        </div>
      )}
      {conflict && (
        <div role="alert" className="space-y-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-base text-red-950">
          <p>同一欄位已被修改（目前 v{conflict.latest.version}），尚未儲存：</p>
          <ul className="list-disc pl-5">
            {conflict.items.map((c) => (
              <li key={c.field}>
                {c.label}：您的值「{fmt(c.mine)}」／最新值「{fmt(c.theirs)}」
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-base"
              onClick={() => void save({ ...conflict.latest.data, ...conflict.mine }, conflict.latest.version, conflict.latest.data).catch(() => {})}
            >
              保留我的值並儲存
            </button>
            <button type="button" className="btn-secondary text-base" onClick={() => void reload({ soft: true, fromRemote: true, discardLocal: true })}>
              改用最新值（放棄我的修改）
            </button>
          </div>
        </div>
      )}
      {remoteNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-base text-sky-950">
          {remoteNotice}
          <button type="button" className="ml-2 underline" onClick={() => setRemoteNotice(null)}>
            知道了
          </button>
        </div>
      )}
      {panel.resubmit && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-950">
          <p className="font-medium">
            補件：原單{' '}
            <a className="underline" href={panel.resubmit.href} target="_blank" rel="noreferrer">
              {panel.resubmit.formNumber}
            </a>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">退回原因：{panel.resubmit.reason ?? '退回時未提供原因'}</p>
        </div>
      )}
      {panel.versionMismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-base text-amber-900">
          表單已發布新版本。請重新整理草稿內容後再送出，系統不會把舊預覽默默套到新 schema。
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-td-border pb-2">
        <a
          className="btn-secondary text-base"
          href={`/applications/drafts/${panel.draft.id}`}
          target="_blank"
          rel="noreferrer"
          onClick={async (e) => {
            if (dirty) {
              e.preventDefault();
              setSaveNote('請先儲存或捨棄未存修改，再開啟自行編輯。');
              setSaveState('error');
              return;
            }
            // Popup blockers: still leave a clickable link.
            const opened = window.open(`/applications/drafts/${panel.draft.id}`, '_blank', 'noopener,noreferrer');
            if (!opened) {
              e.preventDefault();
              setSaveNote('無法開啟新分頁，請點連結：自行編輯頁');
            }
          }}
        >
          自行編輯
        </a>
        <span className="text-sm text-td-muted">同一草稿開啟完整編輯頁（新分頁）</span>
      </div>
      {!panel.schema.sections.some((s) => s.fields.some((f) => f.type === 'attachments')) && (
        <DraftAttachedFiles
          draftId={panel.draft.id}
          draftVersion={panel.draft.version}
          conversationId={conversationId}
          files={panel.files}
          onChanged={() => void reload({ soft: true, fromRemote: true })}
        />
      )}
      <CustomForm
        key={`${panel.draft.id}:${formMountId}`}
        formKey={panel.formKey}
        name={panel.name}
        description={panel.description ?? ''}
        schema={panel.schema}
        options={panel.options}
        today={panel.today}
        currentEmployeeId={panel.currentEmployeeId}
        initial={panel.draft.data}
        mode={{
          kind: 'ai_draft',
          draftId: panel.draft.id,
          expectedVersion: panel.draft.version,
          conversationId,
          attachedFiles: panel.files,
          submitLabel: panel.resubmit ? '重新送出' : undefined,
          saveState,
          saveNote: saveNote ?? undefined,
          onFilesChanged: () => void reload({ soft: true, fromRemote: true }),
          onSave: async (data, expectedVersion) => {
            await save(data, expectedVersion, baseRef.current?.data ?? null);
          },
          onSubmitDocument: async (data, expectedVersion, files) => {
            if (submittingRef.current) return;
            submittingRef.current = true;
            try {
              await submitOnce(data, expectedVersion, files);
            } finally {
              submittingRef.current = false;
            }
          },
        }}
      />
    </div>
  );

  async function submitOnce(data: Record<string, unknown>, expectedVersion: number, files: File[]) {
    if (!panel) return;
    const rows = panel.schema.sections
      .flatMap((sec) => sec.fields)
      .filter((f) => f.showInHeader && data[f.id] !== undefined && data[f.id] !== null && data[f.id] !== '')
      .map((f) => {
        const v = data[f.id];
        // Show names for picked references, not ids.
        const pools: Partial<Record<string, { id: string; label: string }[]>> = {
          project: panel.options.projects,
          employee: panel.options.employees,
          department: panel.options.departments,
          budget_code: panel.options.budgetCodes,
          supplier: panel.options.suppliers,
        };
        const pool = pools[f.type];
        return { label: f.label, value: pool?.find((o) => o.id === v)?.label ?? fmt(v) };
      });
    const ok = await new Promise<boolean>((resolve) => setConfirming({ resolve, rows }));
    setConfirming(null);
    if (!ok) throw new Error('已取消送出，草稿未變更。');
    const saved = await saveDraftAction({
      draftId: panel.draft.id,
      expectedVersion,
      data,
      baseData: baseRef.current?.data ?? null,
    });
    if (!saved.ok) throw new Error(saved.error);
    const ver = saved.draft.version;
    setPanel((prev) => (prev ? { ...prev, draft: saved.draft } : prev));

    const res = await submitDraftAction({
      draftId: panel.draft.id,
      expectedVersion: ver,
      files,
    });
    if (!res.ok) throw new Error(res.error);
    if (res.warning) {
      setSaveNote(res.warning);
      setSaveState('error');
    }
    onDirtyChange?.(false);
    onSubmitted?.({
      formNumber: res.formNumber,
      href: res.href,
      submissionId: res.submissionId,
      formKey: res.formKey,
    });
    await reload({ soft: false });
  }
}
