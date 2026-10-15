'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { FlowDef } from '@/lib/approval/flow/types';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { parseFormSchema, type FormSchema } from '@/lib/custom-forms/schema';
import { saveDraftAction } from '@/lib/form-builder/actions';
import { fieldTypeConflicts } from '@/lib/form-builder/diff';
import { someApprover } from '@/lib/form-builder/flow-tree';
import type { DesignerData } from '@/lib/form-builder/queries';
import { ActionMessage } from '../../org/org-ui';
import { STATUS_BADGE } from '../builder-ui';
import { FieldsEditor, type FieldSelection } from './fields-editor';
import { FlowEditor, type FlowSelection } from './flow-editor';
import { PreviewPanel } from './preview-panel';
import { PublishPanel } from './publish-panel';
import { SettingsPanel } from './settings-panel';
import { isModKey, isTextEntry, KEEP_SELECTION } from './shortcuts';
import { StepNav, TABS, type Tab } from './step-nav';

type Msg = { kind: 'ok' | 'error'; text: string; reauth?: boolean } | null;
type Snapshot = { schema: FormSchema; flow: FlowDef };

const HISTORY_LIMIT = 100;
/** Edits closer together than this (typing, dragging a number) undo as one step. */
const COALESCE_MS = 800;
/** Quiet time after the last edit before the draft is saved automatically. */
const AUTOSAVE_MS = 3000;
const NOTICE_MS = 6000;

/** Keeps the tab and the last message while the editor reloads after publishing / discarding. */
export function DesignerRoot({ data }: { data: DesignerData }) {
  const [tab, setTab] = useState<Tab>('fields');
  const [msg, setMsg] = useState<Msg>(null);
  // Saving the first draft must not reset the editor; discarding the draft must.
  const [prevHasDraft, setPrevHasDraft] = useState(data.hasDraft);
  const [discards, setDiscards] = useState(0);
  if (data.hasDraft !== prevHasDraft) {
    setPrevHasDraft(data.hasDraft);
    if (!data.hasDraft) setDiscards(discards + 1);
  }
  return (
    <Designer key={`${data.published?.version ?? 0}:${data.status}:${discards}`} data={data} tab={tab} setTab={setTab} msg={msg} setMsg={setMsg} />
  );
}

function Designer({
  data,
  tab,
  setTab,
  msg,
  setMsg,
}: {
  data: DesignerData;
  tab: Tab;
  setTab: (t: Tab) => void;
  msg: Msg;
  setMsg: (m: Msg) => void;
}) {
  const router = useRouter();
  const [schema, setSchema] = useState<FormSchema>(data.schema);
  const [flow, setFlow] = useState<FlowDef>(data.flow);
  const [history, setHistory] = useState<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [settings, setSettings] = useState(data.settings);
  const [rowVersion, setRowVersion] = useState(data.rowVersion);
  const [saved, setSaved] = useState(() => JSON.stringify({ schema: data.schema, flow: data.flow }));
  const [hasDraft, setHasDraft] = useState(data.hasDraft);
  const [fieldSel, setFieldSel] = useState<FieldSelection>(null);
  const [flowSel, setFlowSel] = useState<FlowSelection>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, startSave] = useTransition();
  const [autoSaved, setAutoSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const lastEdit = useRef(0);
  const versionRef = useRef(data.rowVersion);
  const inflight = useRef<Promise<number | null> | null>(null);

  const current = JSON.stringify({ schema, flow });
  const dirty = current !== saved;
  const parsed = useMemo(() => parseDefinition(schema, flow), [schema, flow]);
  const noLevels = data.org.levels.length === 0;
  const problems = useMemo(
    () => [
      ...(noLevels && someApprover(flow.blocks, (b) => b.source.kind === 'org_chain')
        ? ['簽核流程用到「組織層級」，但系統還沒有建立組織層級：請到「組織與簽核設定 → 組織層級」建立，或把該關改成「部門主管」']
        : []),
      ...(parsed.ok ? [] : parsed.errors),
      ...fieldTypeConflicts(schema, data.publishedTypes),
    ],
    [parsed, schema, flow, noLevels, data.publishedTypes]
  );
  const fieldCount = schema.sections.reduce((n, s) => n + s.fields.length, 0);
  const schemaOk = useMemo(() => parseFormSchema(schema).ok, [schema]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Every schema / flow edit goes through here so it can be undone. */
  const commit = (next: Snapshot) => {
    const now = Date.now();
    const merge = now - lastEdit.current < COALESCE_MS;
    lastEdit.current = now;
    setHistory((h) => ({ past: merge && h.past.length > 0 ? h.past : [...h.past.slice(1 - HISTORY_LIMIT), { schema, flow }], future: [] }));
    setSchema(next.schema);
    setFlow(next.flow);
  };
  const editSchema = (s: FormSchema) => commit({ schema: s, flow });
  const editFlow = (f: FlowDef) => commit({ schema, flow: f });

  const undo = () => {
    const prev = history.past[history.past.length - 1];
    if (!prev) return;
    setHistory({ past: history.past.slice(0, -1), future: [{ schema, flow }, ...history.future].slice(0, HISTORY_LIMIT) });
    setSchema(prev.schema);
    setFlow(prev.flow);
    lastEdit.current = 0;
    setNotice(null);
  };
  const redo = () => {
    const next = history.future[0];
    if (!next) return;
    setHistory({ past: [...history.past, { schema, flow }], future: history.future.slice(1) });
    setSchema(next.schema);
    setFlow(next.flow);
    lastEdit.current = 0;
  };

  /** Saves what is on screen now; one save at a time so the row version stays in step. */
  const save = async (quiet = false): Promise<number | null> => {
    while (inflight.current) await inflight.current;
    const snapshot = current;
    const job = (async () => {
      try {
        const r = await saveDraftAction(data.id, { schema, flow }, versionRef.current);
        if (!r.ok) {
          setMsg({ kind: 'error', text: quiet ? `自動儲存失敗：${r.error}` : r.error, reauth: r.code === 'reauth_required' });
          return null;
        }
        versionRef.current = r.version;
        setRowVersion(r.version);
        setSaved(snapshot);
        setHasDraft(true);
        if (quiet) setAutoSaved(new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }));
        else setMsg({ kind: 'ok', text: '草稿已儲存（尚未發佈，申請人看不到）' });
        return r.version;
      } catch {
        setMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
        return null;
      }
    })();
    inflight.current = job;
    try {
      return await job;
    } finally {
      if (inflight.current === job) inflight.current = null;
    }
  };

  const latest = useRef({ save, undo, redo, dirty });
  useEffect(() => {
    latest.current = { save, undo, redo, dirty };
  });

  // A failed autosave waits for the next edit instead of retrying in a loop.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void latest.current.save(true), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [current, dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isModKey(e) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (latest.current.dirty) startSave(async () => void (await latest.current.save()));
        return;
      }
      if (isTextEntry(e.target)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        latest.current.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        latest.current.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const announce = (text: string) => setNotice({ text, at: Date.now() });

  const goTo = (t: Tab) => {
    if (dirty) void save(true);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const fieldsBlocked = fieldCount === 0 ? '請先加入至少一個欄位' : !schemaOk ? '欄位設定還有問題，請看上方「待修正」' : null;
  const flowBlocked = problems.length > 0 ? `還有 ${problems.length} 個待修正項目：${problems[0]}` : null;

  const reload = () => router.refresh();

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-6 sm:px-6">
      <section className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/admin/form-builder" className="text-xs font-semibold text-td-blue hover:underline">
            ← 表單設計器
          </Link>
          <h1 className="page-title flex flex-wrap items-center gap-2">
            {settings.name}
            <span className={STATUS_BADGE[data.status].cls}>{STATUS_BADGE[data.status].label}</span>
            {data.published && <span className="badge bg-slate-100 text-slate-700">生效中：第 {data.published.version} 版</span>}
            {hasDraft && data.published && !dirty && <span className="badge bg-amber-50 text-amber-800">草稿未發佈</span>}
            {dirty && <span className="badge bg-amber-100 text-amber-900">有未儲存的修改</span>}
          </h1>
          <p className="font-mono text-xs text-td-muted">/f/{settings.key}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-td-muted" aria-live="polite">
            {dirty ? '稍候自動儲存…' : autoSaved ? `已自動儲存 ${autoSaved}` : ''}
          </span>
          <button
            type="button"
            className="rounded border border-td-border bg-white px-2 py-1.5 text-sm font-semibold text-td-blue hover:bg-td-blue-light disabled:opacity-40"
            disabled={history.past.length === 0}
            onClick={undo}
            title="復原（Ctrl/⌘+Z）"
            aria-label="復原"
          >
            ↶
          </button>
          <button
            type="button"
            className="rounded border border-td-border bg-white px-2 py-1.5 text-sm font-semibold text-td-blue hover:bg-td-blue-light disabled:opacity-40"
            disabled={history.future.length === 0}
            onClick={redo}
            title="重做（Ctrl/⌘+Shift+Z）"
            aria-label="重做"
          >
            ↷
          </button>
          <button
            type="button"
            onClick={() => setShowProblems((v) => !v)}
            className={`rounded border px-3 py-1.5 text-sm font-semibold ${problems.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
            aria-expanded={showProblems}
          >
            {problems.length ? `待修正 ${problems.length}` : '✓ 可以發佈'}
          </button>
          <button
            type="button"
            className="btn-secondary !py-1.5"
            disabled={!dirty || saving}
            onClick={() => startSave(async () => void (await save()))}
            title="儲存草稿（Ctrl/⌘+S）"
          >
            {saving ? '儲存中…' : '儲存草稿'}
          </button>
          <button type="button" className="btn-primary !py-1.5" onClick={() => goTo('publish')}>
            發佈…
          </button>
        </div>
      </section>

      {data.replacesLegacy && (
        <p className="rounded border border-td-blue/30 bg-td-blue-light/40 px-3 py-2 text-sm text-td-blue-dark">
          {data.status === 'published'
            ? `這張表單已取代舊版「${data.replacesLegacy}」：選單入口指向這裡，舊版不再受理新申請（已送出的舊單仍可簽核與查閱）。下架這張表單會恢復舊版入口。`
            : `發佈後會取代舊版「${data.replacesLegacy}」：選單入口改指向這張表單，舊版不再受理新申請（已送出的舊單仍可簽核與查閱）。發佈前請先用「預覽」與「模擬」確認欄位與簽核流程。`}
        </p>
      )}
      {data.draftUnreadable && (
        <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          儲存的草稿格式無法讀取，已改從目前生效的版本開始編輯；儲存草稿會覆蓋舊草稿。
        </p>
      )}
      {showProblems && problems.length > 0 && (
        <ul className="list-disc space-y-1 rounded border border-amber-200 bg-amber-50 py-2 pl-8 pr-3 text-sm text-amber-900">
          {problems.slice(0, 20).map((p) => (
            <li key={p}>{p}</li>
          ))}
          {problems.length > 20 && <li>另有 {problems.length - 20} 項</li>}
        </ul>
      )}
      <ActionMessage msg={msg} />

      <nav aria-label="表單設計" className="flex flex-wrap gap-1 border-b border-td-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => goTo(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? 'border-td-blue text-td-blue-dark' : 'border-transparent text-td-muted hover:text-td-blue-dark'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'fields' && (
        <FieldsEditor
          name={settings.name}
          description={settings.description}
          schema={schema}
          setSchema={editSchema}
          flow={flow}
          selection={fieldSel}
          setSelection={setFieldSel}
          publishedTypes={data.publishedTypes}
          options={data.options}
          sourceForms={data.sourceForms}
          announce={announce}
          footer={<StepNav tab="fields" goTo={goTo} blocked={fieldsBlocked} />}
        />
      )}
      {tab === 'flow' && (
        <>
          <FlowEditor
            flow={flow}
            setFlow={editFlow}
            schema={schema}
            org={data.org}
            options={data.options}
            selection={flowSel}
            setSelection={setFlowSel}
            formKey={settings.key}
            valid={parsed.ok}
            today={data.today}
            defaultApplicantId={data.currentEmployeeId}
            announce={announce}
          />
          <div className="card !py-3">
            <StepNav tab="flow" goTo={goTo} blocked={flowBlocked} />
          </div>
        </>
      )}
      {tab === 'settings' && (
        <SettingsPanel
          id={data.id}
          initial={settings}
          keyEditable={data.keyEditable}
          published={data.published !== null}
          categories={data.categories}
          org={data.org}
          rowVersion={rowVersion}
          onSaved={(version, next) => {
            versionRef.current = version;
            setRowVersion(version);
            setSettings(next);
          }}
          goTo={goTo}
        />
      )}
      {tab === 'preview' && (
        <>
          <PreviewPanel
            formKey={settings.key}
            name={settings.name}
            description={settings.description}
            schema={schema}
            flow={flow}
            flowValid={parsed.ok}
            options={data.options}
            sourceForms={data.sourceForms}
            today={data.today}
            defaultApplicantId={data.currentEmployeeId}
          />
          <div className="card !py-3">
            <StepNav tab="preview" goTo={goTo} blocked={null} />
          </div>
        </>
      )}
      {tab === 'publish' && (
        <>
          <PublishPanel
            id={data.id}
            status={data.status}
            rowVersion={rowVersion}
            dirty={dirty}
            hasDraft={hasDraft}
            save={save}
            problems={problems}
            draft={parsed.ok ? { schema: parsed.schema, flow: parsed.flow } : null}
            published={data.published}
            versions={data.versions}
            notify={setMsg}
            reload={reload}
          />
          <div className="card !py-3">
            <StepNav tab="publish" goTo={goTo} blocked={null} />
          </div>
        </>
      )}

      {notice && (
        <div
          {...KEEP_SELECTION}
          role="status"
          className="fixed left-1/2 top-24 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-td-blue-dark px-4 py-2 text-sm text-white shadow-lg"
        >
          <span>{notice.text}</span>
          <button type="button" className="font-semibold text-td-apex hover:underline" onClick={undo}>
            復原（Ctrl/⌘+Z）
          </button>
          <button type="button" className="text-white/60 hover:text-white" aria-label="關閉" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}
    </main>
  );
}
