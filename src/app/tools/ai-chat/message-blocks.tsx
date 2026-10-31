'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { AiMessageBlock } from '@/lib/ai-chat/blocks';
import {
  answerChoiceAction,
  attachApprovedPdfAction,
  confirmChangeAction,
  confirmNudgeAction,
  listRecentProjectsAction,
  refreshCardAction,
  searchProjectsAction,
  selectProjectAction,
  submitFieldFormAction,
} from '@/lib/ai-chat/actions';
import type { OpenResourceEvent } from '@/lib/ai-chat/open-resource';
import { SafeMarkdown } from './safe-markdown';

type Props = {
  blocks: AiMessageBlock[];
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onDraftOpened?: (draftId: string, meta?: { title?: string; version?: number; formKey?: string; status?: string }) => void;
  onOpenResources?: (events: OpenResourceEvent[]) => void;
  onIntent?: (intent: string) => void;
  onRefresh?: () => void;
  /** Send text as the person's own message (choice answers stay equivalent to typing). */
  onSendText?: (text: string) => void;
};

export function MessageBlocks({
  blocks,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: Props) {
  if (!blocks.length) return null;
  return (
    <div className="mt-3 space-y-3">
      {blocks.map((b) => (
        <BlockView
          key={b.id}
          block={b}
          conversationId={conversationId}
          boundDraftId={boundDraftId}
          boundDraftVersion={boundDraftVersion}
          onDraftOpened={onDraftOpened}
          onOpenResources={onOpenResources}
          onIntent={onIntent}
          onRefresh={onRefresh}
          onSendText={onSendText}
        />
      ))}
    </div>
  );
}

function BlockView({
  block,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: {
  block: AiMessageBlock;
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onDraftOpened?: Props['onDraftOpened'];
  onOpenResources?: Props['onOpenResources'];
  onIntent?: Props['onIntent'];
  onRefresh?: () => void;
  onSendText?: Props['onSendText'];
}) {
  switch (block.kind) {
    case 'text':
      return <SafeMarkdown className="text-sm" text={block.text} />;
    case 'choice':
      return (
        <ChoiceBlock
          block={block}
          conversationId={conversationId}
          onDraftOpened={onDraftOpened}
          onOpenResources={onOpenResources}
          onIntent={onIntent}
          onRefresh={onRefresh}
          onSendText={onSendText}
        />
      );
    case 'project_picker':
      return <ProjectPickerBlock block={block} conversationId={conversationId} onOpenResources={onOpenResources} onRefresh={onRefresh} />;
    case 'field_form':
      return <FieldFormBlock block={block} conversationId={conversationId} onOpenResources={onOpenResources} onRefresh={onRefresh} />;
    case 'change_confirm':
      return <ChangeConfirmBlock block={block} conversationId={conversationId} onOpenResources={onOpenResources} onRefresh={onRefresh} />;
    case 'draft_reference':
      return (
        <button
          type="button"
          className="w-full rounded-lg border border-td-blue/30 bg-td-blue-light/40 px-3 py-2 text-left text-sm"
          onClick={() =>
            onDraftOpened?.(block.draftId, {
              title: block.formName,
              version: block.version,
              formKey: block.formKey,
              status: block.status,
            })
          }
        >
          <span className="font-semibold text-td-blue-dark">草稿：{block.formName}</span>
          <span className="mt-0.5 block text-xs text-td-muted">
            {block.formKey} · v{block.version} · {block.status}
          </span>
        </button>
      );
    case 'action_result':
      return (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            block.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <p>{block.message}</p>
          {block.href && (
            <a href={block.href} className="mt-1 inline-block text-xs font-medium underline">
              查看單據 {block.formNumber}
            </a>
          )}
        </div>
      );
    case 'nudge_confirm':
      return <NudgeBlock block={block} conversationId={conversationId} onRefresh={onRefresh} />;
    case 'document_picker':
      return (
        <DocumentPickerBlock
          block={block}
          conversationId={conversationId}
          boundDraftId={boundDraftId}
          boundDraftVersion={boundDraftVersion}
          onOpenResources={onOpenResources}
          onRefresh={onRefresh}
        />
      );
    case 'approved_pdf_card':
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <p className="font-medium">核准 PDF：{block.formNumber}</p>
          <p className="text-xs">{block.fileName}</p>
          <a href={block.previewHref} className="mt-1 inline-block text-xs underline" target="_blank" rel="noreferrer">
            預覽／下載
          </a>
        </div>
      );
    case 'attachment_status':
      return (
        <StagedImageThumb block={block} />
      );
    case 'document_summary':
      return (
        <div className="rounded-lg border border-td-border bg-white px-3 py-2 text-sm">
          <p className="font-semibold">{block.title}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {block.fields.map((f, i) => (
              <li key={`${f.label}-${i}`}>
                <span className="text-td-muted">{f.label}</span>：{f.value}
                <span className="ml-1 text-[10px] text-td-muted">[{f.source}]</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'field_question':
      return <p className="text-sm text-td-muted">{block.prompt}</p>;
    default:
      return null;
  }
}

function ChoiceBlock({
  block,
  conversationId,
  onDraftOpened,
  onOpenResources,
  onIntent,
  onRefresh,
  onSendText,
}: {
  block: Extract<AiMessageBlock, { kind: 'choice' }>;
  conversationId: string;
  onDraftOpened?: Props['onDraftOpened'];
  onOpenResources?: Props['onOpenResources'];
  onIntent?: Props['onIntent'];
  onRefresh?: () => void;
  onSendText?: Props['onSendText'];
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(block.status !== 'open');
  const [error, setError] = useState<string | null>(null);

  if (done || block.status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-sm text-td-muted">
        {block.prompt}
        <p className="mt-1 text-xs">
          {block.selectedOptionId
            ? `已選擇：${block.options.find((o) => o.id === block.selectedOptionId)?.label ?? block.selectedOptionId}`
            : '選項已失效或已回答'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-sm font-medium text-td-blue-dark">{block.prompt}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {block.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const res = await answerChoiceAction({
                  conversationId,
                  blockId: block.id,
                  optionId: o.id,
                  optionValue: o.value,
                  optionLabel: o.label,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setDone(true);
                if (res.intent) onIntent?.(res.intent);
                if (res.openResources?.length) onOpenResources?.(res.openResources);
                else if (res.draftId) onDraftOpened?.(res.draftId);
                if (res.sendText) onSendText?.(res.sendText);
                else onRefresh?.();
              });
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ProjectPickerBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'project_picker' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<Array<{ id: string; code: string; name: string; source: string }>>([]);
  const [results, setResults] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState(block.selectedLabel ?? null);
  const [error, setError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    void listRecentProjectsAction().then((res) => {
      if (res.ok) setRecent(res.projects);
    });
  }, []);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const seq = ++reqSeq.current;
    const t = setTimeout(() => {
      start(async () => {
        const res = await searchProjectsAction({ query });
        if (seq !== reqSeq.current) return; // drop stale
        if (res.ok) setResults(res.projects);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (block.status !== 'open' || selected) {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-sm">
        {selected ?? (block.status === 'expired' ? '草稿已更新，這張專案卡片已過期。' : '專案選取已完成或已失效')}
      </div>
    );
  }

  const pick = (id: string) => {
    setError(null);
    start(async () => {
      const res = await selectProjectAction({ conversationId, blockId: block.id, projectId: id });
      if (!res.ok) {
        setError(res.error);
        onRefresh?.();
        return;
      }
      setSelected(res.receipt);
      if (res.openResources?.length) onOpenResources?.(res.openResources);
      onRefresh?.();
    });
  };

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-sm font-medium text-td-blue-dark">{block.prompt}</p>
      <input
        className="mt-2 w-full rounded-lg border border-td-border px-3 py-2 text-sm"
        placeholder="輸入專案代碼或名稱搜尋…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
        {query.trim().length < 1 &&
          recent.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-td-blue-light/50"
              disabled={pending}
              onClick={() => pick(p.id)}
            >
              <span className="font-medium">{p.code}</span> {p.name}
              <span className="ml-2 text-[10px] text-td-muted">
                {p.source === 'recent_used' ? '最近使用' : '近期建立'}
              </span>
            </button>
          ))}
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-td-blue-light/50"
            disabled={pending}
            onClick={() => pick(p.id)}
          >
            <span className="font-medium">{p.code}</span> {p.name}
          </button>
        ))}
        {query.trim() && results.length === 0 && !pending && (
          <p className="px-2 py-1 text-xs text-td-muted">沒有符合的專案</p>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function NudgeBlock({
  block,
  conversationId,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'nudge_confirm' }>;
  conversationId: string;
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(block.status);
  const [msg, setMsg] = useState<string | null>(null);

  if (status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-sm text-td-muted">
        催簽：{block.caseNumber}
        {status === 'already_today' && ' — 今日已催簽'}
        {status === 'notified' && ' — 站內通知已建立'}
        {status === 'queued' && ' — 已排入通知'}
        {status === 'failed' && ' — 寄送失敗'}
        {msg && <p className="mt-1 text-xs">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm">
      <p className="font-medium text-amber-950">提醒簽核：{block.caseNumber}</p>
      <p className="mt-1 text-xs text-amber-900">
        收件對象：{block.recipientNames.length ? block.recipientNames.join('、') : '（無待簽核人）'}
      </p>
      <p className="mt-1 text-[11px] text-amber-800">每張單依 Asia/Taipei 曆日全系統每天最多一次。</p>
      <button
        type="button"
        className="btn-primary mt-2 text-sm"
        disabled={pending || block.recipientNames.length === 0}
        onClick={() => {
          start(async () => {
            const res = await confirmNudgeAction({
              formType: block.formType,
              formId: block.formId,
              conversationId,
            });
            if (!res.ok) {
              setStatus('failed');
              setMsg(res.error);
              return;
            }
            setStatus(res.status === 'already_today' ? 'already_today' : 'notified');
            setMsg(res.message);
            onRefresh?.();
          });
        }}
      >
        {pending ? '處理中…' : '確認提醒簽核'}
      </button>
    </div>
  );
}

function StagedImageThumb({ block }: { block: Extract<AiMessageBlock, { kind: 'attachment_status' }> }) {
  const stagedId = block.detail?.startsWith('staged:') ? block.detail.slice('staged:'.length) : null;
  return (
    <div className="flex items-center gap-2 text-xs text-td-muted">
      {stagedId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/ai-chat/staged/${stagedId}`}
          alt={block.fileName}
          className="h-14 w-14 rounded border object-cover"
        />
      ) : null}
      <span>
        圖片 {block.fileName}：{block.state}
        {!stagedId && block.detail ? `（${block.detail}）` : ''}
      </span>
    </div>
  );
}

function DocumentPickerBlock({
  block,
  conversationId,
  boundDraftId,
  boundDraftVersion,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'document_picker' }>;
  conversationId: string;
  boundDraftId?: string | null;
  boundDraftVersion?: number | null;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const draftId = block.targetDraftId || boundDraftId || null;
  const draftVersion = block.targetDraftVersion ?? boundDraftVersion ?? null;

  if (block.status !== 'open') {
    return <p className="text-sm text-td-muted">{block.prompt}（已關閉）</p>;
  }

  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3">
      <p className="text-sm font-medium text-td-blue-dark">{block.prompt}</p>
      {!draftId && (
        <p className="mt-1 text-xs text-amber-800">請先綁定或開啟報支草稿，才能附加核准 PDF。</p>
      )}
      <ul className="mt-2 space-y-2">
        {block.items.map((item) => (
          <li key={item.formId} className="rounded-lg border border-td-border px-3 py-2 text-sm">
            <div className="font-medium text-td-blue-dark">
              {item.formName} · {item.formNumber}
            </div>
            <div className="text-xs text-td-muted">
              {item.summary}
              {item.approvedAt
                ? ` · 核准 ${new Date(item.approvedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`
                : ''}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a className="underline" href={`/f/${item.formKey || '_'}/${item.formId}`}>
                預覽單據
              </a>
              <button
                type="button"
                className="underline"
                disabled={pending || !draftId || draftVersion == null || doneId === item.formId}
                onClick={() => {
                  if (!draftId || draftVersion == null) return;
                  setError(null);
                  start(async () => {
                    const res = await attachApprovedPdfAction({
                      sourceFormId: item.formId,
                      draftId,
                      expectedVersion: draftVersion,
                      conversationId,
                    });
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    setDoneId(item.formId);
                    onOpenResources?.([
                      {
                        type: 'open_resource',
                        resourceType: 'application_draft',
                        resourceId: draftId,
                        title: '報支草稿',
                        version: res.draftVersion,
                        operation: 'updated',
                      },
                    ]);
                    onRefresh?.();
                  });
                }}
              >
                {doneId === item.formId ? '已附加' : '附加核准 PDF'}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {block.items.length === 0 && <p className="mt-2 text-sm text-td-muted">沒有可選的已核准單據。</p>}
      {error && <p className="mt-2 text-sm text-amber-800">{error}</p>}
    </div>
  );
}

function CardOutcome({ block }: { block: { status: string; outcome?: string } }) {
  return (
    <p className={`mt-2 text-xs ${block.status === 'expired' ? 'text-amber-800' : 'text-emerald-800'}`}>
      {block.outcome ?? (block.status === 'expired' ? '這張卡片已過期，沒有寫入。' : '已完成')}
    </p>
  );
}

/** Small form for missing fields; native controls, so every input is keyboard reachable. */
function FieldFormBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'field_form' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ status: string; outcome?: string }>({ status: block.status, outcome: block.outcome });
  const [error, setError] = useState<string | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectHits, setProjectHits] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const hasProject = block.fields.some((f) => f.type === 'project');

  useEffect(() => {
    if (!hasProject || projectQuery.trim().length < 1) return;
    const t = setTimeout(() => {
      void searchProjectsAction({ query: projectQuery }).then((r) => r.ok && setProjectHits(r.projects));
    }, 250);
    return () => clearTimeout(t);
  }, [projectQuery, hasProject]);

  const head = (
    <p className="text-sm font-medium text-td-blue-dark">
      {block.prompt}
      <span className="ml-1 text-xs font-normal text-td-muted">（{block.formName} v{block.draftVersion}）</span>
    </p>
  );

  if (state.status !== 'open') {
    return (
      <div className="rounded-lg border border-td-border bg-slate-50 px-3 py-2 text-sm">
        {head}
        <CardOutcome block={state} />
        {state.status === 'expired' && (
          <button
            type="button"
            className="btn-secondary mt-2 text-xs"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await refreshCardAction({ conversationId, blockId: block.id });
                if (!res.ok) setError(res.error);
                onRefresh?.();
              })
            }
          >
            以最新版本重新填寫
          </button>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const input = 'mt-1 w-full rounded-lg border border-td-border px-2 py-1.5 text-sm';
  return (
    <form
      className="space-y-2 rounded-lg border border-td-border bg-white px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        setError(null);
        start(async () => {
          const res = await submitFieldFormAction({ conversationId, blockId: block.id, values });
          const b = res.block;
          if (b && (b.kind === 'field_form' || b.kind === 'change_confirm')) setState({ status: b.status, outcome: b.outcome });
          if (!res.ok) setError(res.error);
          else if (res.openResources?.length) onOpenResources?.(res.openResources);
          onRefresh?.();
        });
      }}
    >
      {head}
      {block.fields.map((f) => {
        const id = `${block.id}_${f.id}`;
        const set = (v: string) => setValues((prev) => ({ ...prev, [f.id]: v }));
        return (
          <div key={f.id}>
            <label htmlFor={id} className="text-xs font-semibold text-td-blue-dark">
              {f.label}
              {f.required && <span className="text-red-600"> *</span>}
              {f.current && <span className="ml-1 font-normal text-td-muted">目前：{f.current.replace('T', ' ')}</span>}
            </label>
            {f.type === 'select' || f.type === 'employee' ? (
              <select id={id} className={input} value={values[f.id] ?? ''} onChange={(e) => set(e.target.value)}>
                <option value="">請選擇</option>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'project' ? (
              <div>
                <input
                  id={id}
                  className={input}
                  placeholder="輸入專案代碼或名稱搜尋…"
                  value={projectQuery}
                  onChange={(e) => {
                    setProjectQuery(e.target.value);
                    if (!e.target.value.trim()) setProjectHits([]);
                    set('');
                  }}
                />
                {projectHits.length > 0 && !values[f.id] && (
                  <div role="listbox" aria-label="專案搜尋結果" className="mt-1 max-h-40 overflow-y-auto rounded border border-td-border">
                    {projectHits.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="block w-full px-2 py-1 text-left text-sm hover:bg-td-blue-light/50"
                        onClick={() => {
                          set(p.id);
                          setProjectQuery(`${p.code} ${p.name}`);
                        }}
                      >
                        {p.code} {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : f.type === 'textarea' ? (
              <textarea id={id} className={input} rows={2} value={values[f.id] ?? ''} onChange={(e) => set(e.target.value)} />
            ) : (
              <input
                id={id}
                className={input}
                type={f.type === 'datetime' ? 'datetime-local' : f.type === 'date' ? 'date' : f.type === 'money' || f.type === 'number' ? 'number' : 'text'}
                value={values[f.id] ?? ''}
                onChange={(e) => set(e.target.value)}
              />
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-secondary text-sm" disabled={pending}>
          {pending ? '儲存中…' : '存入草稿'}
        </button>
        <span className="text-xs text-td-muted">只存入草稿，不會送出單據。</span>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

function ChangeConfirmBlock({
  block,
  conversationId,
  onOpenResources,
  onRefresh,
}: {
  block: Extract<AiMessageBlock, { kind: 'change_confirm' }>;
  conversationId: string;
  onOpenResources?: Props['onOpenResources'];
  onRefresh?: () => void;
}) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ status: string; outcome?: string }>({ status: block.status, outcome: block.outcome });
  const [error, setError] = useState<string | null>(null);
  const act = (accept: boolean) =>
    start(async () => {
      setError(null);
      const res = await confirmChangeAction({ conversationId, blockId: block.id, accept });
      const b = res.block;
      if (b && (b.kind === 'field_form' || b.kind === 'change_confirm')) setState({ status: b.status, outcome: b.outcome });
      if (!res.ok) setError(res.error);
      else if (res.openResources?.length) onOpenResources?.(res.openResources);
      onRefresh?.();
    });
  return (
    <div className="rounded-lg border border-td-border bg-white px-3 py-3 text-sm">
      <p className="font-medium text-td-blue-dark">
        {block.prompt}
        <span className="ml-1 text-xs font-normal text-td-muted">（{block.formName} v{block.draftVersion}）</span>
      </p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-td-muted">
            <th className="py-1">欄位</th>
            <th>原值</th>
            <th>新值</th>
          </tr>
        </thead>
        <tbody>
          {block.changes.map((c) => (
            <tr key={c.field} className="border-t border-td-border">
              <td className="py-1">{c.label}</td>
              <td className="text-td-muted line-through">{c.from}</td>
              <td className="font-semibold">{c.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.status === 'open' ? (
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-secondary text-sm" disabled={pending} onClick={() => act(true)}>
            確認修改
          </button>
          <button type="button" className="text-sm underline" disabled={pending} onClick={() => act(false)}>
            取消
          </button>
        </div>
      ) : (
        <CardOutcome block={state} />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
