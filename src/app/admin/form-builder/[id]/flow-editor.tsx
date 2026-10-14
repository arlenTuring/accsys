'use client';

import { useState, type DragEvent } from 'react';
import {
  APPROVER_SOURCE_KINDS,
  type ApproverBlock,
  type ApproverSourceKind,
  type FlowBlock,
  type FlowDef,
  type FlowOptions,
} from '@/lib/approval/flow/types';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { FormSchema } from '@/lib/custom-forms/schema';
import { newApprover, newCondition, newSource, SOURCE_LABELS, uniqueId } from '@/lib/form-builder/blank';
import { findBlock, flowIds, insertBlock, locate, moveBlock, removeBlock, updateBlock, updateCondition, type ListRef } from '@/lib/form-builder/flow-tree';
import type { BuilderOrg } from '@/lib/form-builder/queries';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { ConditionEditor, conditionSummary, type CondField } from './condition-editor';
import { flowCondFields } from './designer-model';
import { SimPanel } from './sim-panel';
import { SourceEditor, sourceSummary } from './source-editor';

export type FlowSelection =
  | { kind: 'block'; id: string }
  | { kind: 'branch'; conditionId: string; branchId: string }
  | { kind: 'otherwise'; conditionId: string }
  | { kind: 'options' }
  | null;

type Drag = { kind: 'new'; make: 'condition' | ApproverSourceKind } | { kind: 'move'; id: string } | null;

const KIND_COLORS: Record<ApproverSourceKind | 'condition', string> = {
  employee: 'border-l-sky-500',
  department_manager: 'border-l-indigo-500',
  department_members: 'border-l-violet-500',
  org_chain: 'border-l-blue-700',
  form_party: 'border-l-teal-500',
  employee_group: 'border-l-emerald-500',
  job_role: 'border-l-amber-500',
  condition: 'border-l-rose-500',
};

const OPTION_LABELS: Record<Exclude<keyof FlowOptions, 'whenEmpty'>, string> = {
  skipApplicant: '簽核人是申請人本人時，由系統代簽',
  skipFiler: '簽核人是代填人時，由系統代簽',
  collapseDuplicates: '同一人已負責前面的關卡時，由系統代簽',
};

function DropSlot({ active, onDrop }: { active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false);
  if (!active) return <div className="mx-auto h-4 w-px bg-td-border" />;
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`my-1 rounded border-2 border-dashed transition-all ${over ? 'h-10 border-td-blue bg-td-blue-light' : 'h-4 border-td-border'}`}
    />
  );
}

export function FlowEditor({
  flow,
  setFlow,
  schema,
  org,
  options,
  selection,
  setSelection,
  formKey,
  valid,
  today,
  defaultApplicantId,
}: {
  flow: FlowDef;
  setFlow: (f: FlowDef) => void;
  schema: FormSchema;
  org: BuilderOrg;
  options: PickerOptions;
  selection: FlowSelection;
  setSelection: (s: FlowSelection) => void;
  formKey: string;
  valid: boolean;
  today: string;
  defaultApplicantId: string;
}) {
  const [drag, setDrag] = useState<Drag>(null);
  const condFields = flowCondFields(schema, options, org);
  const setBlocks = (blocks: FlowBlock[]) => setFlow({ ...flow, blocks });

  const make = (what: 'condition' | ApproverSourceKind): FlowBlock => {
    const taken = flowIds(flow.blocks);
    return what === 'condition' ? newCondition(taken) : newApprover(what, taken);
  };

  /** Where a palette click lands: after the selected block, or at the end of the selected branch / the flow. */
  const clickTarget = (): { ref: ListRef; index: number } => {
    if (selection?.kind === 'block') {
      const at = locate(flow.blocks, selection.id);
      if (at) return { ref: at.ref, index: at.index + 1 };
    }
    if (selection?.kind === 'branch' || selection?.kind === 'otherwise') {
      const c = findBlock(flow.blocks, selection.conditionId);
      if (c?.type === 'condition') {
        const branchId = selection.kind === 'branch' ? selection.branchId : 'otherwise';
        const list = branchId === 'otherwise' ? c.otherwise.blocks : (c.branches.find((b) => b.id === branchId)?.blocks ?? []);
        return { ref: { conditionId: c.id, branchId }, index: list.length };
      }
    }
    return { ref: null, index: flow.blocks.length };
  };

  const add = (what: 'condition' | ApproverSourceKind, ref?: ListRef, index?: number) => {
    const block = make(what);
    const target = ref === undefined ? clickTarget() : { ref, index: index ?? 0 };
    setBlocks(insertBlock(flow.blocks, target.ref, target.index, block));
    setSelection({ kind: 'block', id: block.id });
  };

  const dropAt = (ref: ListRef, index: number) => {
    if (drag?.kind === 'new') add(drag.make, ref, index);
    if (drag?.kind === 'move') setBlocks(moveBlock(flow.blocks, drag.id, ref, index));
    setDrag(null);
  };

  const nudge = (id: string, delta: -1 | 1) => {
    const at = locate(flow.blocks, id);
    if (at) setBlocks(moveBlock(flow.blocks, id, at.ref, delta === -1 ? Math.max(0, at.index - 1) : at.index + 2));
  };

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d?.kind === 'move' ? d.id : (d?.make ?? ''));
    setDrag(d);
  };

  const renderList = (blocks: FlowBlock[], ref: ListRef) => (
    <div>
      <DropSlot active={drag !== null} onDrop={() => dropAt(ref, 0)} />
      {blocks.map((b, i) => (
        <div key={b.id}>
          {b.type === 'approver' ? renderApprover(b) : renderCondition(b)}
          <DropSlot active={drag !== null} onDrop={() => dropAt(ref, i + 1)} />
        </div>
      ))}
      {blocks.length === 0 && drag === null && <p className="rounded border border-dashed border-td-border px-3 py-2 text-center text-xs text-td-muted">（沒有關卡）</p>}
    </div>
  );

  const cardTools = (id: string) => (
    <span className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={smallBtn} aria-label="上移" onClick={() => nudge(id, -1)}>
        ↑
      </button>
      <button type="button" className={smallBtn} aria-label="下移" onClick={() => nudge(id, 1)}>
        ↓
      </button>
      <button
        type="button"
        className={dangerBtn}
        onClick={() => {
          const b = findBlock(flow.blocks, id);
          if (b?.type === 'condition' && !window.confirm(`刪除「${b.label}」會連同分支內的關卡一起刪除，確定？`)) return;
          setBlocks(removeBlock(flow.blocks, id));
          setSelection(null);
        }}
      >
        刪除
      </button>
    </span>
  );

  const renderApprover = (b: Extract<FlowBlock, { type: 'approver' }>) => {
    const selected = selection?.kind === 'block' && selection.id === b.id;
    return (
      <div
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'move', id: b.id })}
        onDragEnd={() => setDrag(null)}
        onClick={() => setSelection({ kind: 'block', id: b.id })}
        className={`flex cursor-pointer items-center gap-2 rounded border border-l-4 bg-white px-3 py-2 ${KIND_COLORS[b.source.kind]} ${
          selected ? 'border-td-blue ring-1 ring-td-blue' : 'border-td-border hover:border-td-blue'
        }`}
      >
        <span className="cursor-grab select-none text-td-muted" aria-hidden>
          ⋮⋮
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-td-blue-dark">{b.label || '（未命名關卡）'}</span>
          <span className="ml-2 text-xs text-td-muted">{SOURCE_LABELS[b.source.kind]}</span>
          <span className="block truncate text-xs text-td-blue-dark">{sourceSummary(b.source, org, schema)}</span>
          {b.fallbackFor && <span className="badge mr-1 mt-0.5 bg-amber-100 text-amber-800">升級關卡</span>}
          {b.onUnresolved === 'skip' && <span className="badge mt-0.5 bg-slate-100 text-slate-700">找不到人時略過</span>}
        </span>
        {cardTools(b.id)}
      </div>
    );
  };

  const renderCondition = (b: Extract<FlowBlock, { type: 'condition' }>) => {
    const selected = selection?.kind === 'block' && selection.id === b.id;
    return (
      <div className={`rounded border border-l-4 bg-rose-50/40 ${KIND_COLORS.condition} ${selected ? 'border-td-blue ring-1 ring-td-blue' : 'border-td-border'}`}>
        <div
          draggable
          onDragStart={(e) => startDrag(e, { kind: 'move', id: b.id })}
          onDragEnd={() => setDrag(null)}
          onClick={() => setSelection({ kind: 'block', id: b.id })}
          className="flex cursor-pointer items-center gap-2 px-3 py-2"
        >
          <span className="cursor-grab select-none text-td-muted" aria-hidden>
            ⋮⋮
          </span>
          <span className="flex-1">
            <span className="font-semibold text-td-blue-dark">{b.label || '（未命名條件式）'}</span>
            <span className="ml-2 text-xs text-td-muted">條件式・由上而下第一個符合的條件生效</span>
          </span>
          {cardTools(b.id)}
        </div>
        <div className="space-y-2 px-3 pb-3">
          {b.branches.map((br, i) => {
            const sel = selection?.kind === 'branch' && selection.branchId === br.id;
            return (
              <div key={br.id} className={`rounded border bg-white p-2 ${sel ? 'border-td-blue ring-1 ring-td-blue' : 'border-td-border'}`}>
                <button type="button" className="w-full text-left" onClick={() => setSelection({ kind: 'branch', conditionId: b.id, branchId: br.id })}>
                  <span className="text-xs font-semibold text-rose-700">條件順序 {i + 1}</span>
                  <span className="ml-2 text-sm font-semibold text-td-blue-dark">{br.label}</span>
                  <span className="block text-xs text-td-muted">{conditionSummary(br.when, condFields)}</span>
                </button>
                <div className="mt-1 border-l-2 border-dashed border-rose-200 pl-3">{renderList(br.blocks, { conditionId: b.id, branchId: br.id })}</div>
              </div>
            );
          })}
          <div className={`rounded border bg-white p-2 ${selection?.kind === 'otherwise' && selection.conditionId === b.id ? 'border-td-blue ring-1 ring-td-blue' : 'border-td-border'}`}>
            <button type="button" className="w-full text-left" onClick={() => setSelection({ kind: 'otherwise', conditionId: b.id })}>
              <span className="text-xs font-semibold text-slate-600">例外條件</span>
              <span className="ml-2 text-sm font-semibold text-td-blue-dark">{b.otherwise.label}</span>
              <span className="block text-xs text-td-muted">以上條件都不符合時</span>
            </button>
            <div className="mt-1 border-l-2 border-dashed border-slate-200 pl-3">{renderList(b.otherwise.blocks, { conditionId: b.id, branchId: 'otherwise' })}</div>
          </div>
          <button
            type="button"
            className={smallBtn}
            onClick={() => {
              const id = uniqueId('br', flowIds(flow.blocks));
              setBlocks(updateCondition(flow.blocks, b.id, (c) => ({ ...c, branches: [...c.branches, { id, label: `條件 ${c.branches.length + 1}`, when: { all: [] }, blocks: [] }] })));
              setSelection({ kind: 'branch', conditionId: b.id, branchId: id });
            }}
          >
            ＋ 條件順序
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_22rem]">
      <aside className="card h-fit space-y-2 !p-3 lg:sticky lg:top-4">
        <p className="text-xs text-td-muted">點一下加到選取位置之後，或拖曳到流程中。</p>
        {APPROVER_SOURCE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            draggable
            onDragStart={(e) => startDrag(e, { kind: 'new', make: k })}
            onDragEnd={() => setDrag(null)}
            onClick={() => add(k)}
            className={`w-full cursor-grab rounded border border-l-4 border-td-border bg-white px-2 py-1.5 text-left text-xs font-semibold text-td-blue-dark hover:bg-td-blue-light ${KIND_COLORS[k]}`}
          >
            {SOURCE_LABELS[k]}
          </button>
        ))}
        <button
          type="button"
          draggable
          onDragStart={(e) => startDrag(e, { kind: 'new', make: 'condition' })}
          onDragEnd={() => setDrag(null)}
          onClick={() => add('condition')}
          className={`w-full cursor-grab rounded border border-l-4 border-td-border bg-white px-2 py-1.5 text-left text-xs font-semibold text-td-blue-dark hover:bg-td-blue-light ${KIND_COLORS.condition}`}
        >
          條件式
        </button>
      </aside>

      <div className="card !p-4">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-full border border-td-border bg-slate-50 px-4 py-1.5 text-center text-sm font-semibold text-td-blue-dark">申請人送出</div>
          {renderList(flow.blocks, null)}
          <div className="rounded-full border border-td-border bg-slate-50 px-4 py-1.5 text-center text-sm font-semibold text-td-blue-dark">核准完成</div>
          <button type="button" className={`${smallBtn} mt-4`} onClick={() => setSelection({ kind: 'options' })}>
            流程選項（系統代簽、沒有關卡時）
          </button>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card !p-3">
          <SelectionPanel flow={flow} setFlow={setFlow} selection={selection} setSelection={setSelection} schema={schema} org={org} condFields={condFields} />
        </div>
        <div className="card !p-3">
          <p className="mb-2 text-sm font-semibold text-td-blue-dark">試算</p>
          <SimPanel formKey={formKey} schema={schema} flow={flow} valid={valid} options={options} today={today} defaultApplicantId={defaultApplicantId} />
        </div>
      </aside>
    </div>
  );
}

/** Approver blocks placed before `id`, in the order the flow walks them. */
function approversBefore(blocks: FlowBlock[], id: string): ApproverBlock[] {
  const out: ApproverBlock[] = [];
  const walk = (list: FlowBlock[]): boolean => {
    for (const b of list) {
      if (b.id === id) return true;
      if (b.type === 'approver') out.push(b);
      else if (walk(b.branches.flatMap((br) => br.blocks)) || walk(b.otherwise.blocks)) return true;
    }
    return false;
  };
  walk(blocks);
  return out;
}

/** 升級關卡: only needed when none of the chosen earlier blocks got someone other than the applicant. */
function EscalationEditor({ flow, block, setBlocks }: { flow: FlowDef; block: ApproverBlock; setBlocks: (b: FlowBlock[]) => void }) {
  const earlier = approversBefore(flow.blocks, block.id);
  const picked = block.fallbackFor ?? [];
  const set = (fallbackFor: string[] | undefined) =>
    setBlocks(
      updateBlock(flow.blocks, block.id, (b) => {
        if (b.type !== 'approver') return b;
        const next = { ...b };
        if (fallbackFor && fallbackFor.length > 0) next.fallbackFor = fallbackFor;
        else delete next.fallbackFor;
        return next;
      })
    );
  if (earlier.length === 0) return null;
  return (
    <div className="space-y-1 border-t border-dashed border-td-border pt-3">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={!!block.fallbackFor} onChange={(e) => set(e.target.checked ? [earlier[earlier.length - 1].id] : undefined)} />
        <span>
          升級關卡
          <span className="block text-xs text-td-muted">只在下列關卡都沒有申請人（或代填人）以外的人簽核時才需要這一關，例如各單位主管都是申請人本人時改由總經理簽核；這一關也不會由申請人本人簽。</span>
        </span>
      </label>
      {block.fallbackFor &&
        earlier.map((b) => (
          <label key={b.id} className="ml-6 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={picked.includes(b.id)}
              onChange={(e) => set(e.target.checked ? [...picked, b.id] : picked.filter((x) => x !== b.id))}
            />
            {b.label || b.id}
          </label>
        ))}
    </div>
  );
}

function SelectionPanel({
  flow,
  setFlow,
  selection,
  setSelection,
  schema,
  org,
  condFields,
}: {
  flow: FlowDef;
  setFlow: (f: FlowDef) => void;
  selection: FlowSelection;
  setSelection: (s: FlowSelection) => void;
  schema: FormSchema;
  org: BuilderOrg;
  condFields: CondField[];
}) {
  const setBlocks = (blocks: FlowBlock[]) => setFlow({ ...flow, blocks });

  if (selection?.kind === 'options') {
    const o = flow.options;
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs font-semibold text-td-muted">流程選項</p>
        {(Object.keys(OPTION_LABELS) as (keyof typeof OPTION_LABELS)[]).map((k) => (
          <label key={k} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={o[k]} onChange={(e) => setFlow({ ...flow, options: { ...o, [k]: e.target.checked } })} />
            {OPTION_LABELS[k]}
          </label>
        ))}
        <Field label="沒有任何需要簽核的關卡時">
          <select className={smallInput} value={o.whenEmpty} onChange={(e) => setFlow({ ...flow, options: { ...o, whenEmpty: e.target.value as FlowOptions['whenEmpty'] } })}>
            <option value="auto_approve">送出後直接核准</option>
            <option value="block">不允許送出（提示聯絡管理員）</option>
          </select>
        </Field>
        <p className="text-xs text-td-muted">系統代簽的關卡仍會顯示在簽核時間軸上，註明「由系統代簽」。</p>
      </div>
    );
  }

  const block = selection?.kind === 'block' ? findBlock(flow.blocks, selection.id) : null;
  if (block?.type === 'approver') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs font-semibold text-td-muted">簽核關卡</p>
        <Field label="關卡名稱（顯示在簽核時間軸）">
          <input className={smallInput} maxLength={60} value={block.label} onChange={(e) => setBlocks(updateBlock(flow.blocks, block.id, (b) => ({ ...b, label: e.target.value })))} />
        </Field>
        <Field label="簽核人來源">
          <select
            className={smallInput}
            value={block.source.kind}
            onChange={(e) => setBlocks(updateBlock(flow.blocks, block.id, (b) => (b.type === 'approver' ? { ...b, source: newSource(e.target.value as ApproverSourceKind) } : b)))}
          >
            {APPROVER_SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <SourceEditor
          source={block.source}
          onChange={(source) => setBlocks(updateBlock(flow.blocks, block.id, (b) => (b.type === 'approver' ? { ...b, source } : b)))}
          org={org}
          schema={schema}
        />
        <Field label="找不到簽核人時">
          <select
            className={smallInput}
            value={block.onUnresolved}
            onChange={(e) => setBlocks(updateBlock(flow.blocks, block.id, (b) => (b.type === 'approver' ? { ...b, onUnresolved: e.target.value as 'block' | 'skip' } : b)))}
          >
            <option value="block">不允許送出，提示哪一關缺人</option>
            <option value="skip">略過這一關（時間軸顯示「略過」）</option>
          </select>
        </Field>
        <EscalationEditor flow={flow} block={block} setBlocks={setBlocks} />
      </div>
    );
  }
  if (block?.type === 'condition') {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs font-semibold text-td-muted">條件式</p>
        <Field label="名稱">
          <input className={smallInput} maxLength={60} value={block.label} onChange={(e) => setBlocks(updateBlock(flow.blocks, block.id, (b) => ({ ...b, label: e.target.value })))} />
        </Field>
        <p className="text-xs text-td-muted">由上而下判斷每個條件順序，第一個符合的分支生效；都不符合時走「例外條件」。點選分支標題可設定條件。</p>
      </div>
    );
  }

  if (selection?.kind === 'branch') {
    const c = findBlock(flow.blocks, selection.conditionId);
    const index = c?.type === 'condition' ? c.branches.findIndex((b) => b.id === selection.branchId) : -1;
    if (c?.type !== 'condition' || index === -1) return <p className="text-sm text-td-muted">點選關卡、條件或分支來編輯。</p>;
    const br = c.branches[index];
    const setBranch = (fn: (b: typeof br) => typeof br) =>
      setBlocks(updateCondition(flow.blocks, c.id, (x) => ({ ...x, branches: x.branches.map((b) => (b.id === br.id ? fn(b) : b)) })));
    const moveBranch = (delta: -1 | 1) =>
      setBlocks(
        updateCondition(flow.blocks, c.id, (x) => {
          const j = index + delta;
          if (j < 0 || j >= x.branches.length) return x;
          const branches = [...x.branches];
          [branches[index], branches[j]] = [branches[j], branches[index]];
          return { ...x, branches };
        })
      );
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs font-semibold text-td-muted">
          「{c.label}」的條件順序 {index + 1}
        </p>
        <Field label="分支名稱">
          <input className={smallInput} maxLength={60} value={br.label} onChange={(e) => setBranch((b) => ({ ...b, label: e.target.value }))} />
        </Field>
        <div>
          <p className="mb-1 text-xs font-semibold text-td-blue-dark">條件</p>
          <ConditionEditor value={br.when} onChange={(when) => setBranch((b) => ({ ...b, when: when ?? { all: [] } }))} fields={condFields} emptyText="請加入至少一個條件。" allowEmpty={false} />
        </div>
        <div className="flex gap-1">
          <button type="button" className={smallBtn} disabled={index === 0} onClick={() => moveBranch(-1)}>
            順序上移
          </button>
          <button type="button" className={smallBtn} disabled={index === c.branches.length - 1} onClick={() => moveBranch(1)}>
            順序下移
          </button>
          <button
            type="button"
            className={dangerBtn}
            disabled={c.branches.length === 1}
            onClick={() => {
              if (br.blocks.length > 0 && !window.confirm(`分支「${br.label}」內的關卡會一起刪除，確定？`)) return;
              setBlocks(updateCondition(flow.blocks, c.id, (x) => ({ ...x, branches: x.branches.filter((b) => b.id !== br.id) })));
              setSelection({ kind: 'block', id: c.id });
            }}
          >
            刪除分支
          </button>
        </div>
      </div>
    );
  }

  if (selection?.kind === 'otherwise') {
    const c = findBlock(flow.blocks, selection.conditionId);
    if (c?.type !== 'condition') return <p className="text-sm text-td-muted">點選關卡、條件或分支來編輯。</p>;
    return (
      <div className="space-y-3 text-sm">
        <p className="text-xs font-semibold text-td-muted">「{c.label}」的例外條件</p>
        <Field label="名稱">
          <input
            className={smallInput}
            maxLength={60}
            value={c.otherwise.label}
            onChange={(e) => setBlocks(updateCondition(flow.blocks, c.id, (x) => ({ ...x, otherwise: { ...x.otherwise, label: e.target.value } })))}
          />
        </Field>
        <p className="text-xs text-td-muted">以上條件都不符合時走這裡；可以沒有任何關卡（直接往下）。</p>
      </div>
    );
  }

  return <p className="text-sm text-td-muted">點選關卡、條件或分支來編輯。</p>;
}
