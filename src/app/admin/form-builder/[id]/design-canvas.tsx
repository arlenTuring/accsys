'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { inputCls, Req } from '@/app/components/form-fields';
import { PendingFilesField } from '@/app/components/pending-files-field';
import { FieldInput, initialValues, SPAN } from '@/app/f/custom-form';
import { NoticeText } from '@/app/f/notice-text';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { SCHEMA_LIMITS, type FieldDef, type FieldOption, type FormSchema, type FormSection } from '@/lib/custom-forms/schema';
import { FIELD_TYPE_LABELS, uniqueId } from '@/lib/form-builder/blank';
import { updateField } from '@/lib/form-builder/schema-edit';
import type { FieldSelection } from './fields-editor';

const SEMANTIC_BADGE = { amount: '單據金額', budget_code: '主要預算', project: '主要專案' } as const;
const WIDTH_LABELS = { 1: '1/4 寬', 2: '1/2 寬', 3: '3/4 寬', 4: '整列' } as const;
const OPTION_LABEL_MAX = 100;
const BOOLEAN_LABEL_MAX = 20;
const toolBtn = 'rounded px-1.5 py-0.5 text-xs font-semibold text-td-blue hover:bg-td-blue-light disabled:opacity-40';
const noop = () => {};

/**
 * Text shown exactly as on the form; a click turns it into an input that
 * edits the schema on every keystroke. Enter (Ctrl+Enter when multiline) or
 * leaving the box finishes, Esc restores what it was.
 */
export function InlineText({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  multiline = false,
  display,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder: string;
  maxLength: number;
  multiline?: boolean;
  /** Rendering of a non-empty value when not editing (defaults to the text). */
  display?: ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState(value);
  const boxRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!editing) return;
    // Text inside a draggable element cannot be selected with the mouse.
    const host = boxRef.current?.closest<HTMLElement>('[draggable="true"]');
    if (host) host.draggable = false;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => {
      if (host) host.draggable = true;
      document.removeEventListener('pointerdown', close, true);
    };
  }, [editing]);
  const begin = () => {
    setOriginal(value);
    setEditing(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onChange(original);
      setEditing(false);
    } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setEditing(false);
    }
  };
  const box = `block w-full rounded border border-td-blue bg-white px-1 outline-none ring-2 ring-td-blue/15 ${className}`;
  if (editing) {
    return (
      <span ref={boxRef} className="block">
        {multiline ? (
          <textarea
            autoFocus
            rows={3}
            aria-label={label}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={onKeyDown}
            className={`${box} resize-y [field-sizing:content]`}
          />
        ) : (
          <input
            autoFocus
            aria-label={label}
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={onKeyDown}
            className={box}
          />
        )}
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`編輯${label}`}
      title="點一下直接編輯"
      onClick={begin}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          begin();
        }
      }}
      className={`cursor-text rounded decoration-td-blue/60 decoration-dashed underline-offset-4 hover:bg-td-blue-light/70 hover:underline ${className}`}
    >
      {value ? (display ?? value) : <span className="font-normal italic text-slate-400">{placeholder}</span>}
    </span>
  );
}

type Over = { sectionId: string; index: number; fieldId?: string; before?: boolean } | null;

export function DesignCanvas({
  name,
  description,
  schema,
  setSchema,
  selection,
  setSelection,
  dragging,
  startMove,
  endDrag,
  dropAt,
  options,
  usedByFlow,
  onNudge,
  onDuplicate,
  onRemove,
  onMoveSection,
  onRemoveSection,
}: {
  name: string;
  description: string;
  schema: FormSchema;
  setSchema: (s: FormSchema) => void;
  selection: FieldSelection;
  setSelection: (s: FieldSelection) => void;
  dragging: boolean;
  startMove: (e: DragEvent, id: string) => void;
  endDrag: () => void;
  dropAt: (sectionId: string, index: number) => void;
  options: PickerOptions;
  usedByFlow: Set<string>;
  onNudge: (id: string, delta: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onRemove: (f: FieldDef) => void;
  onMoveSection: (id: string, delta: -1 | 1) => void;
  onRemoveSection: (id: string) => void;
}) {
  const [over, setOver] = useState<Over>(null);
  const values = useMemo(() => initialValues(schema), [schema]);
  const patch = (id: string, fn: (f: FieldDef) => FieldDef) => setSchema(updateField(schema, id, fn));
  const patchSection = (id: string, next: Partial<FormSection>) =>
    setSchema({ ...schema, sections: schema.sections.map((s) => (s.id === id ? { ...s, ...next } : s)) });

  const drop = (e: DragEvent, sectionId: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    dropAt(sectionId, index);
  };
  const allowDrop = (e: DragEvent, next: Over) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    if (over?.sectionId !== next?.sectionId || over?.index !== next?.index || over?.fieldId !== next?.fieldId) setOver(next);
  };

  const setOptions = (f: FieldDef, fn: (o: FieldOption[]) => FieldOption[]) =>
    patch(f.id, (x) => (x.type === 'select' || x.type === 'radio' || x.type === 'checkboxes' ? { ...x, options: fn(x.options) } : x));
  const addOption = (f: FieldDef) =>
    setOptions(f, (o) => [...o, { value: uniqueId('opt', o.map((x) => x.value)), label: `選項 ${o.length + 1}` }]);
  const optionLabel = (f: FieldDef, i: number) => (v: string) => setOptions(f, (o) => o.map((x, j) => (j === i ? { ...x, label: v } : x)));
  const removeOption = (f: FieldDef, i: number) => setOptions(f, (o) => o.filter((_, j) => j !== i));

  const optionChoices = (f: Extract<FieldDef, { options: FieldOption[] }>, selected: boolean) => (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {f.options.map((o, i) => (
        <span key={i} className="inline-flex items-center gap-2 text-sm text-td-blue-dark">
          <input
            type={f.type === 'radio' ? 'radio' : 'checkbox'}
            tabIndex={-1}
            readOnly
            checked={f.type === 'radio' ? values[f.id] === o.value : false}
            className="pointer-events-none"
          />
          <InlineText value={o.label} onChange={optionLabel(f, i)} label={`第 ${i + 1} 個選項名稱`} placeholder="（選項）" maxLength={OPTION_LABEL_MAX} />
          {selected && f.options.length > 1 && (
            <button type="button" className="text-xs text-slate-400 hover:text-red-600" aria-label={`刪除選項 ${o.label}`} onClick={() => removeOption(f, i)}>
              ✕
            </button>
          )}
        </span>
      ))}
      {selected && f.options.length < SCHEMA_LIMITS.options && (
        <button type="button" className={toolBtn} onClick={() => addOption(f)}>
          ＋ 選項
        </button>
      )}
    </div>
  );

  const input = (f: FieldDef, selected: boolean) => {
    if (f.type === 'radio' || f.type === 'checkboxes') return optionChoices(f, selected);
    if (f.type === 'boolean') {
      return (
        <div className="flex gap-5">
          {([true, false] as const).map((b) => (
            <span key={String(b)} className="inline-flex items-center gap-2 text-sm text-td-blue-dark">
              <input type="radio" tabIndex={-1} readOnly checked={values[f.id] === b} className="pointer-events-none" />
              <InlineText
                value={b ? f.trueLabel : f.falseLabel}
                onChange={(v) => patch(f.id, (x) => (x.type === 'boolean' ? { ...x, [b ? 'trueLabel' : 'falseLabel']: v } : x))}
                label={b ? '「是」的文字' : '「否」的文字'}
                placeholder={b ? '是' : '否'}
                maxLength={BOOLEAN_LABEL_MAX}
              />
            </span>
          ))}
        </div>
      );
    }
    if (f.type === 'attachments') {
      return (
        <div inert className="pointer-events-none">
          <PendingFilesField files={[]} onChange={noop} maxFiles={f.maxFiles ?? undefined} />
        </div>
      );
    }
    const rendered = (
      <FieldInput
        field={f}
        value={values[f.id]}
        onChange={noop}
        options={options}
        minDay={undefined}
        currency={f.currencyField ? '幣別' : 'NT$'}
        errors={{}}
        labelId={`canvas-${f.id}`}
        ticked={() => []}
        carried={null}
        sourceFixed={false}
        columnLabel={
          f.type === 'table'
            ? (c) => (
                <span className="pointer-events-auto">
                  <InlineText
                    value={c.label}
                    onChange={(v) =>
                      patch(f.id, (x) => (x.type === 'table' ? { ...x, columns: x.columns.map((y) => (y.id === c.id ? { ...y, label: v } : y)) } : x))
                    }
                    label={`欄位「${c.id}」名稱`}
                    placeholder="（欄名）"
                    maxLength={SCHEMA_LIMITS.label}
                  />
                </span>
              )
            : undefined
        }
      />
    );
    // Table headers stay clickable for inline editing; everything else is a picture of the input.
    if (f.type === 'table') return <div className="pointer-events-none">{rendered}</div>;
    return (
      <>
        <div inert className="pointer-events-none">
          {rendered}
        </div>
        {f.type === 'select' && selected && (
          <div className="mt-2 rounded border border-dashed border-td-blue/40 bg-td-blue-light/30 px-2 py-1.5">
            <p className="text-xs text-td-muted">下拉選項（點名稱直接修改）</p>
            <ol className="mt-1 space-y-0.5">
              {f.options.map((o, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-td-blue-dark">
                  <span className="w-5 text-right text-xs text-td-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <InlineText
                      value={o.label}
                      onChange={optionLabel(f, i)}
                      label={`第 ${i + 1} 個選項名稱`}
                      placeholder="（選項）"
                      maxLength={OPTION_LABEL_MAX}
                    />
                  </span>
                  {f.options.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-slate-400 hover:text-red-600"
                      aria-label={`刪除選項 ${o.label}`}
                      onClick={() => removeOption(f, i)}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ol>
            {f.options.length < SCHEMA_LIMITS.options && (
              <button type="button" className={`${toolBtn} mt-1`} onClick={() => addOption(f)}>
                ＋ 選項
              </button>
            )}
          </div>
        )}
      </>
    );
  };

  const body = (f: FieldDef, selected: boolean) => {
    const text = (key: 'label' | 'help') => (v: string) => patch(f.id, (x) => ({ ...x, [key]: v }));
    if (f.type === 'notice') {
      return (
        <div className="rounded border border-td-border bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-td-blue-dark">
            <InlineText value={f.label} onChange={text('label')} label="說明區塊標題" placeholder="（標題）" maxLength={SCHEMA_LIMITS.label} />
          </p>
          <div className="mt-1 whitespace-pre-line text-sm leading-6 text-td-blue-dark">
            <InlineText
              multiline
              value={f.text}
              display={<NoticeText text={f.text} />}
              onChange={(v) => patch(f.id, (x) => (x.type === 'notice' ? { ...x, text: v } : x))}
              label="說明文字"
              placeholder="（說明文字）"
              maxLength={SCHEMA_LIMITS.notice}
            />
          </div>
        </div>
      );
    }
    return (
      <>
        <p className="text-sm font-semibold text-td-blue-dark">
          <InlineText value={f.label} onChange={text('label')} label="欄位名稱" placeholder="（未命名）" maxLength={SCHEMA_LIMITS.label} />
          {f.required && <Req />}
        </p>
        {(f.help || selected) && (
          <p className="mt-1 text-xs text-td-muted">
            <InlineText value={f.help} onChange={text('help')} label="說明文字" placeholder="＋ 加上說明文字" maxLength={SCHEMA_LIMITS.help} multiline />
          </p>
        )}
        <div className="mt-2">{input(f, selected)}</div>
      </>
    );
  };

  const selectedField = selection?.kind === 'field' ? schema.sections.flatMap((s) => s.fields).find((f) => f.id === selection.id) : undefined;
  const sectionIndex = selection?.kind === 'section' ? schema.sections.findIndex((s) => s.id === selection.id) : -1;

  /** Actions on the selection, kept above the form so they never cover it. */
  const contextBar = () => (
    <div
      className="sticky top-20 z-20 flex min-h-[2.75rem] flex-wrap items-center gap-1 rounded-t-card border-b border-td-border bg-white/95 px-5 py-1.5 text-xs backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      {selectedField ? (
        <>
          <span className="mr-1 font-semibold text-td-blue-dark">{FIELD_TYPE_LABELS[selectedField.type]}</span>
          <span className="mr-2 font-mono text-td-muted">{selectedField.id}</span>
          {selectedField.type !== 'notice' && (
            <label className="mr-1 flex items-center gap-1 font-semibold text-td-blue-dark">
              <input type="checkbox" checked={selectedField.required} onChange={(e) => patch(selectedField.id, (x) => ({ ...x, required: e.target.checked }))} />
              必填
            </label>
          )}
          <select
            aria-label="欄位寬度"
            value={selectedField.width}
            onChange={(e) => patch(selectedField.id, (x) => ({ ...x, width: Number(e.target.value) as 1 | 2 | 3 | 4 }))}
            className="mr-1 rounded border border-td-border bg-white px-1 py-0.5 text-xs text-td-blue-dark"
          >
            {([1, 2, 3, 4] as const).map((w) => (
              <option key={w} value={w}>
                {WIDTH_LABELS[w]}
              </option>
            ))}
          </select>
          <button type="button" className={toolBtn} aria-label={`上移 ${selectedField.label}`} onClick={() => onNudge(selectedField.id, -1)}>
            ↑ 上移
          </button>
          <button type="button" className={toolBtn} aria-label={`下移 ${selectedField.label}`} onClick={() => onNudge(selectedField.id, 1)}>
            ↓ 下移
          </button>
          <button type="button" className={toolBtn} onClick={() => onDuplicate(selectedField.id)}>
            複製
          </button>
          <button type="button" className={`${toolBtn} !text-red-700 hover:!bg-red-50`} onClick={() => onRemove(selectedField)}>
            刪除
          </button>
          <span className="ml-auto flex flex-wrap gap-1">{badges(selectedField)}</span>
        </>
      ) : sectionIndex >= 0 ? (
        <>
          <span className="mr-2 font-semibold text-td-blue-dark">區段：{schema.sections[sectionIndex].title || '（未命名）'}</span>
          <button
            type="button"
            className={toolBtn}
            aria-label="區段上移"
            disabled={sectionIndex === 0}
            onClick={() => onMoveSection(schema.sections[sectionIndex].id, -1)}
          >
            ↑ 上移
          </button>
          <button
            type="button"
            className={toolBtn}
            aria-label="區段下移"
            disabled={sectionIndex === schema.sections.length - 1}
            onClick={() => onMoveSection(schema.sections[sectionIndex].id, 1)}
          >
            ↓ 下移
          </button>
          <button
            type="button"
            className={`${toolBtn} !text-red-700 hover:!bg-red-50`}
            disabled={schema.sections.length === 1}
            onClick={() => onRemoveSection(schema.sections[sectionIndex].id)}
          >
            刪除區段
          </button>
        </>
      ) : (
        <span className="text-td-muted">點一下表單上的標題、說明或選項文字可直接修改；點選欄位可調整必填、寬度與順序，拖曳欄位可移動位置。</span>
      )}
      {selection && (
        <button type="button" className={`${toolBtn} ${selectedField ? '' : 'ml-auto'} !text-td-muted`} onClick={() => setSelection(null)}>
          ✕ 取消選取
        </button>
      )}
    </div>
  );

  const badges = (f: FieldDef) => (
    <>
      {f.semantic && <span className="badge bg-td-blue-light text-td-blue">{SEMANTIC_BADGE[f.semantic]}</span>}
      {f.showInHeader && <span className="badge bg-slate-100 text-slate-700">表頭</span>}
      {f.visibleWhen && <span className="badge bg-amber-50 text-amber-800">條件顯示</span>}
      {f.requiredWhen && <span className="badge bg-amber-50 text-amber-800">條件必填</span>}
      {usedByFlow.has(f.id) && <span className="badge bg-emerald-50 text-emerald-800">流程使用</span>}
    </>
  );

  const indicator = (f: FieldDef) => {
    if (over?.fieldId !== f.id) return null;
    const pos =
      f.width === 4 ? (over.before ? '-top-3 inset-x-0 h-1' : '-bottom-3 inset-x-0 h-1') : over.before ? '-left-3.5 inset-y-0 w-1' : '-right-3.5 inset-y-0 w-1';
    return <span aria-hidden className={`pointer-events-none absolute rounded bg-td-blue ${pos}`} />;
  };

  return (
    <div className="card !p-0" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}>
      {contextBar()}
      <div className="cursor-default px-5 py-4" onClick={() => setSelection(null)} title="表單名稱與說明在「發佈設定」修改；點這裡可編輯整張表單的選項">
        <h1 className="text-xl font-bold text-td-blue-dark">{name}</h1>
        {description && <p className="mt-1 text-sm text-td-muted">{description}</p>}
      </div>
      {schema.onBehalf === true && (
        <section className="border-t border-dashed border-td-border px-5 py-5" onClick={() => setSelection(null)}>
          <p className="text-sm font-semibold text-td-blue-dark">
            申請人
            <Req />
          </p>
          <p className="mt-1 text-xs text-td-muted">以經辦身分替其他同仁申請時請改選申請人；申請人需先在系統確認，才會送主管簽核。</p>
          <div inert className="pointer-events-none mt-2 md:w-1/2">
            <select className={`${inputCls} !bg-white`} defaultValue="">
              <option value="">（申請人）</option>
            </select>
          </div>
        </section>
      )}
      {schema.sections.map((section) => {
        const sectionSelected = selection?.kind === 'section' && selection.id === section.id;
        return (
          <section
            key={section.id}
            className={`border-t border-dashed border-td-border ${sectionSelected ? 'outline outline-2 -outline-offset-2 outline-td-blue' : ''}`}
          >
            <div className="cursor-pointer px-5 pt-4" onClick={() => setSelection({ kind: 'section', id: section.id })}>
              <h2 className="font-semibold text-td-blue-dark">
                <InlineText
                  value={section.title}
                  onChange={(v) => patchSection(section.id, { title: v })}
                  label="區段標題"
                  placeholder="＋ 區段標題（可留白）"
                  maxLength={SCHEMA_LIMITS.label}
                />
              </h2>
              {(section.description || sectionSelected) && (
                <p className="mt-1 text-xs text-td-muted">
                  <InlineText
                    multiline
                    value={section.description}
                    onChange={(v) => patchSection(section.id, { description: v })}
                    label="區段說明"
                    placeholder="＋ 區段說明"
                    maxLength={SCHEMA_LIMITS.help}
                  />
                </p>
              )}
            </div>
            <div
              className="grid gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-4"
              onDragOver={(e) => allowDrop(e, over?.sectionId === section.id ? over : { sectionId: section.id, index: section.fields.length })}
              onDrop={(e) => drop(e, section.id, over?.sectionId === section.id ? over.index : section.fields.length)}
            >
              {section.fields.length === 0 && !dragging && (
                <p className="rounded border border-dashed border-td-border px-3 py-4 text-center text-xs text-td-muted md:col-span-4">
                  從下方元件庫點選或拖曳元件到這裡
                </p>
              )}
              {section.fields.map((f, i) => {
                const selected = selection?.kind === 'field' && selection.id === f.id;
                return (
                  <div
                    key={f.id}
                    className={`group relative ${SPAN[f.width]}`}
                    draggable
                    onDragStart={(e) => startMove(e, f.id)}
                    onDragEnd={() => {
                      setOver(null);
                      endDrag();
                    }}
                    onDragOver={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const before = f.width === 4 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
                      allowDrop(e, { sectionId: section.id, index: before ? i : i + 1, fieldId: f.id, before });
                    }}
                    onDrop={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const before = f.width === 4 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2;
                      drop(e, section.id, before ? i : i + 1);
                    }}
                    onClick={() => setSelection({ kind: 'field', id: f.id })}
                  >
                    {!selected && (
                      <span className="pointer-events-none absolute bottom-full left-0 z-10 mb-2.5 hidden items-center gap-1 whitespace-nowrap rounded bg-white/95 px-1 text-[11px] text-td-muted shadow-sm group-hover:flex">
                        {FIELD_TYPE_LABELS[f.type]} · <span className="font-mono">{f.id}</span> · 可拖曳移動
                      </span>
                    )}
                    <div
                      className={`-m-2 cursor-pointer rounded p-2 ${selected ? 'outline outline-2 outline-td-blue' : 'hover:outline-dashed hover:outline-1 hover:outline-td-blue/60'}`}
                    >
                      {!selected && (f.semantic || f.visibleWhen || f.requiredWhen || usedByFlow.has(f.id) || f.showInHeader) && (
                        <span className="float-right ml-2 flex flex-wrap justify-end gap-1 opacity-60 group-hover:opacity-100">{badges(f)}</span>
                      )}
                      {body(f, selected)}
                    </div>
                    {indicator(f)}
                  </div>
                );
              })}
              {dragging && (
                <div
                  onDragOver={(e) => allowDrop(e, { sectionId: section.id, index: section.fields.length })}
                  onDrop={(e) => drop(e, section.id, section.fields.length)}
                  className={`rounded border-2 border-dashed px-3 py-3 text-center text-xs md:col-span-4 ${
                    over?.sectionId === section.id && over.index === section.fields.length && !over.fieldId
                      ? 'border-td-blue bg-td-blue-light text-td-blue'
                      : 'border-td-border text-td-muted'
                  }`}
                >
                  放到「{section.title || '此區段'}」最後
                </div>
              )}
            </div>
          </section>
        );
      })}
      <div className="flex justify-end border-t border-td-border px-5 py-4" inert>
        <span className="btn-primary pointer-events-none opacity-90">送出申請</span>
      </div>
    </div>
  );
}
