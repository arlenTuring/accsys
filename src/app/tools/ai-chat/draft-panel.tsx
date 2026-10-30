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
  today: string;
  files: DraftAttachedFile[];
};

export function DraftPanel({
  draftId,
  refreshKey = 0,
  onSubmitted,
  onVersionChange,
  onDirtyChange,
  onLoadState,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
    async (opts?: { soft?: boolean; fromRemote?: boolean }) => {
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
        const wasDirty = dirtyRef.current;
        setPanel({
          draft: res.draft,
          formKey: res.formKey,
          name: res.name,
          description: res.description,
          schema: res.schema,
          options: res.options,
          currentEmployeeId: res.currentEmployeeId,
          versionMismatch: res.versionMismatch,
          today: res.today,
          files: res.files,
        });
        // Always remount the form with server `data` — soft reload used to update
        // panel state only, leaving CustomForm's empty local `values` in place.
        setFormMountId((n) => n + 1);
        setSaveState('idle');
        setDirty(false);
        onDirtyChange?.(false);
        onLoadState?.('ready');
        onVersionChange?.(res.draft);
        if (opts?.fromRemote && wasDirty) {
          setRemoteNotice('已套用對話中的草稿更新（會覆蓋此面板尚未儲存的手動修改）。');
        } else if (opts?.fromRemote) {
          setRemoteNotice(null);
        }
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

  if (loading && !panel) {
    return <p className="p-4 text-sm text-td-muted">載入草稿…</p>;
  }
  if (error || !panel) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-amber-800">{error ?? '無法載入草稿'}</p>
        <button type="button" className="btn-secondary text-sm" onClick={() => void reload()}>
          重試載入
        </button>
      </div>
    );
  }

  if (panel.draft.status === 'submitted') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-td-muted">
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
      {remoteNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
          {remoteNotice}
          <button type="button" className="ml-2 underline" onClick={() => setRemoteNotice(null)}>
            知道了
          </button>
        </div>
      )}
      {panel.versionMismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          表單已發布新版本。請重新整理草稿內容後再送出，系統不會把舊預覽默默套到新 schema。
        </div>
      )}
      {!panel.schema.sections.some((s) => s.fields.some((f) => f.type === 'attachments')) && (
        <DraftAttachedFiles draftId={panel.draft.id} files={panel.files} />
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
          attachedFiles: panel.files,
          saveState,
          onSave: async (data, expectedVersion) => {
            setSaveState('saving');
            const res = await saveDraftAction({
              draftId: panel.draft.id,
              expectedVersion,
              data,
            });
            if (!res.ok) {
              setSaveState('error');
              if (res.draft) {
                setPanel((prev) => (prev ? { ...prev, draft: res.draft! } : prev));
                onVersionChange?.(res.draft);
              }
              throw new Error(res.error);
            }
            setSaveState('saved');
            setPanel((prev) => (prev ? { ...prev, draft: res.draft } : prev));
            onVersionChange?.(res.draft);
          },
          onSubmitDocument: async (data, expectedVersion, files) => {
            const saved = await saveDraftAction({
              draftId: panel.draft.id,
              expectedVersion,
              data,
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
            onDirtyChange?.(false);
            onSubmitted?.({
              formNumber: res.formNumber,
              href: res.href,
              submissionId: res.submissionId,
              formKey: res.formKey,
            });
            await reload({ soft: false });
          },
        }}
      />
    </div>
  );
}
