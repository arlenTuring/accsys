'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import type { FlowDef } from '@/lib/approval/flow/types';
import { parseDefinition } from '@/lib/custom-forms/definition';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { saveDraftAction } from '@/lib/form-builder/actions';
import { fieldTypeConflicts } from '@/lib/form-builder/diff';
import type { DesignerData } from '@/lib/form-builder/queries';
import { ActionMessage } from '../../org/org-ui';
import { STATUS_BADGE } from '../builder-ui';
import { FieldsEditor, type FieldSelection } from './fields-editor';
import { FlowEditor, type FlowSelection } from './flow-editor';
import { PreviewPanel } from './preview-panel';
import { PublishPanel } from './publish-panel';
import { SettingsPanel } from './settings-panel';

type Tab = 'fields' | 'flow' | 'settings' | 'preview' | 'publish';
type Msg = { kind: 'ok' | 'error'; text: string; reauth?: boolean } | null;

const TABS: { id: Tab; label: string }[] = [
  { id: 'fields', label: '欄位設計' },
  { id: 'flow', label: '簽核流程' },
  { id: 'settings', label: '發佈設定' },
  { id: 'preview', label: '預覽' },
  { id: 'publish', label: '版本與發佈' },
];

/** Keeps the tab and the last message while the editor reloads after publishing / discarding. */
export function DesignerRoot({ data }: { data: DesignerData }) {
  const [tab, setTab] = useState<Tab>('fields');
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Designer key={`${data.published?.version ?? 0}:${data.hasDraft}:${data.status}`} data={data} tab={tab} setTab={setTab} msg={msg} setMsg={setMsg} />
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
  const [settings, setSettings] = useState(data.settings);
  const [rowVersion, setRowVersion] = useState(data.rowVersion);
  const [saved, setSaved] = useState(() => JSON.stringify({ schema: data.schema, flow: data.flow }));
  const [hasDraft, setHasDraft] = useState(data.hasDraft);
  const [fieldSel, setFieldSel] = useState<FieldSelection>(null);
  const [flowSel, setFlowSel] = useState<FlowSelection>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, startSave] = useTransition();

  const current = JSON.stringify({ schema, flow });
  const dirty = current !== saved;
  const parsed = useMemo(() => parseDefinition(schema, flow), [schema, flow]);
  const problems = useMemo(
    () => [...(parsed.ok ? [] : parsed.errors), ...fieldTypeConflicts(schema, data.publishedTypes)],
    [parsed, schema, data.publishedTypes]
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async (): Promise<number | null> => {
    try {
      const r = await saveDraftAction(data.id, { schema, flow }, rowVersion);
      if (!r.ok) {
        setMsg({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
        return null;
      }
      setRowVersion(r.version);
      setSaved(current);
      setHasDraft(true);
      setMsg({ kind: 'ok', text: '草稿已儲存（尚未發佈，申請人看不到）' });
      return r.version;
    } catch {
      setMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
      return null;
    }
  };

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProblems((v) => !v)}
            className={`rounded border px-3 py-1.5 text-sm font-semibold ${problems.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
            aria-expanded={showProblems}
          >
            {problems.length ? `待修正 ${problems.length}` : '✓ 可以發佈'}
          </button>
          <button type="button" className="btn-secondary !py-1.5" disabled={!dirty || saving} onClick={() => startSave(async () => void (await save()))}>
            {saving ? '儲存中…' : '儲存草稿'}
          </button>
          <button type="button" className="btn-primary !py-1.5" onClick={() => setTab('publish')}>
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
            onClick={() => setTab(t.id)}
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
          setSchema={setSchema}
          flow={flow}
          selection={fieldSel}
          setSelection={setFieldSel}
          publishedTypes={data.publishedTypes}
          options={data.options}
          sourceForms={data.sourceForms}
        />
      )}
      {tab === 'flow' && (
        <FlowEditor
          flow={flow}
          setFlow={setFlow}
          schema={schema}
          org={data.org}
          options={data.options}
          selection={flowSel}
          setSelection={setFlowSel}
          formKey={settings.key}
          valid={parsed.ok}
          today={data.today}
          defaultApplicantId={data.currentEmployeeId}
        />
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
            setRowVersion(version);
            setSettings(next);
          }}
        />
      )}
      {tab === 'preview' && (
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
      )}
      {tab === 'publish' && (
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
      )}
    </main>
  );
}
