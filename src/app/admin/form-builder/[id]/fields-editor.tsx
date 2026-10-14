'use client';

import { useState, type DragEvent } from 'react';
import { flowFieldIds } from '@/lib/approval/flow/references';
import type { FlowDef } from '@/lib/approval/flow/types';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { FieldDef, FieldType, FormSchema } from '@/lib/custom-forms/schema';
import { FIELD_GROUPS, FIELD_TYPE_LABELS, newField } from '@/lib/form-builder/blank';
import type { PublishedFieldTypes } from '@/lib/form-builder/diff';
import type { BuilderSourceForm } from '@/lib/form-builder/queries';
import {
  addSection,
  duplicateField,
  insertField,
  locateField,
  moveField,
  moveSection,
  removeField,
  schemaFieldIds,
  updateField,
} from '@/lib/form-builder/schema-edit';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { AssetRegisterEditor } from './asset-register-editor';
import { earlierCondFields } from './designer-model';
import { FieldProps } from './field-props';

export type FieldSelection = { kind: 'field'; id: string } | { kind: 'section'; id: string } | null;

type Drag = { kind: 'new'; type: FieldType } | { kind: 'move'; id: string } | null;

const SEMANTIC_BADGE = { amount: '單據金額', budget_code: '主要預算', project: '主要專案' } as const;

function DropSlot({ active, onDrop }: { active: boolean; onDrop: () => void }) {
  const [over, setOver] = useState(false);
  if (!active) return <div className="h-1" />;
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
      className={`my-0.5 rounded border-2 border-dashed transition-all ${over ? 'h-10 border-td-blue bg-td-blue-light' : 'h-3 border-td-border'}`}
    />
  );
}

export function FieldsEditor({
  schema,
  setSchema,
  flow,
  selection,
  setSelection,
  publishedTypes,
  options,
  sourceForms,
}: {
  schema: FormSchema;
  setSchema: (s: FormSchema) => void;
  flow: FlowDef;
  selection: FieldSelection;
  setSelection: (s: FieldSelection) => void;
  publishedTypes: PublishedFieldTypes;
  options: PickerOptions;
  sourceForms: BuilderSourceForm[];
}) {
  const [drag, setDrag] = useState<Drag>(null);
  const usedByFlow = new Set(flowFieldIds(flow));
  const selectedField = selection?.kind === 'field' ? schema.sections.flatMap((s) => s.fields).find((f) => f.id === selection.id) : undefined;
  const selectedSection = selection?.kind === 'section' ? schema.sections.find((s) => s.id === selection.id) : undefined;

  const add = (type: FieldType, sectionId?: string, index?: number) => {
    const field = newField(type, schemaFieldIds(schema));
    let target = sectionId;
    let at = index;
    if (target === undefined) {
      const sel = selection?.kind === 'field' ? locateField(schema, selection.id) : null;
      if (sel) {
        target = sel.sectionId;
        at = sel.index + 1;
      } else {
        const section = schema.sections.find((s) => s.id === (selection?.kind === 'section' ? selection.id : '')) ?? schema.sections[schema.sections.length - 1];
        target = section.id;
        at = section.fields.length;
      }
    }
    setSchema(insertField(schema, target, at ?? 0, field));
    setSelection({ kind: 'field', id: field.id });
  };

  const dropAt = (sectionId: string, index: number) => {
    if (drag?.kind === 'new') add(drag.type, sectionId, index);
    if (drag?.kind === 'move') setSchema(moveField(schema, drag.id, sectionId, index));
    setDrag(null);
  };

  const nudge = (id: string, delta: -1 | 1) => {
    const at = locateField(schema, id);
    if (!at) return;
    const si = schema.sections.findIndex((s) => s.id === at.sectionId);
    const section = schema.sections[si];
    if (delta === -1 && at.index === 0) {
      const prev = schema.sections[si - 1];
      if (prev) setSchema(moveField(schema, id, prev.id, prev.fields.length));
    } else if (delta === 1 && at.index === section.fields.length - 1) {
      const next = schema.sections[si + 1];
      if (next) setSchema(moveField(schema, id, next.id, 0));
    } else {
      setSchema(moveField(schema, id, at.sectionId, delta === -1 ? at.index - 1 : at.index + 2));
    }
  };

  const remove = (f: FieldDef) => {
    if (usedByFlow.has(f.id) && !window.confirm(`簽核流程有用到「${f.label}」，刪除後流程需要重新設定。確定刪除？`)) return;
    setSchema(removeField(schema, f.id));
    setSelection(null);
  };

  const removeSection = (id: string) => {
    const section = schema.sections.find((s) => s.id === id);
    if (!section || schema.sections.length === 1) return;
    if (section.fields.length > 0 && !window.confirm(`區段「${section.title || section.id}」內的 ${section.fields.length} 個欄位會一起刪除，確定？`)) return;
    setSchema({ ...schema, sections: schema.sections.filter((s) => s.id !== id) });
    setSelection(null);
  };

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d?.kind === 'new' ? d.type : (d?.id ?? ''));
    setDrag(d);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_20rem]">
      <aside className="card h-fit space-y-3 !p-3 lg:sticky lg:top-4">
        <p className="text-xs text-td-muted">點一下加到選取的位置，或拖曳到中間。</p>
        {FIELD_GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-1 text-xs font-semibold text-td-muted">{g.title}</p>
            <div className="grid gap-1">
              {g.types.map((t) => (
                <button
                  key={t}
                  type="button"
                  draggable
                  onDragStart={(e) => startDrag(e, { kind: 'new', type: t })}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => add(t)}
                  className="cursor-grab rounded border border-td-border bg-white px-2 py-1.5 text-left text-xs font-semibold text-td-blue-dark hover:border-td-blue hover:bg-td-blue-light"
                >
                  {FIELD_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="space-y-4">
        {schema.sections.map((section, si) => (
          <section key={section.id} className={`card space-y-1 !p-3 ${selection?.kind === 'section' && selection.id === section.id ? 'ring-2 ring-td-blue' : ''}`}>
            <div className="flex items-center gap-2">
              <button type="button" className="flex-1 text-left" onClick={() => setSelection({ kind: 'section', id: section.id })}>
                <span className="font-semibold text-td-blue-dark">{section.title || '（未命名區段）'}</span>
                {section.description && <span className="block text-xs text-td-muted">{section.description}</span>}
              </button>
              <button type="button" className={smallBtn} aria-label="區段上移" disabled={si === 0} onClick={() => setSchema(moveSection(schema, section.id, -1))}>
                ↑
              </button>
              <button
                type="button"
                className={smallBtn}
                aria-label="區段下移"
                disabled={si === schema.sections.length - 1}
                onClick={() => setSchema(moveSection(schema, section.id, 1))}
              >
                ↓
              </button>
              <button type="button" className={dangerBtn} disabled={schema.sections.length === 1} onClick={() => removeSection(section.id)}>
                刪除區段
              </button>
            </div>
            <DropSlot active={drag !== null} onDrop={() => dropAt(section.id, 0)} />
            {section.fields.length === 0 && drag === null && <p className="rounded border border-dashed border-td-border px-3 py-4 text-center text-xs text-td-muted">從左側加入欄位</p>}
            {section.fields.map((f, i) => {
              const selected = selection?.kind === 'field' && selection.id === f.id;
              return (
                <div key={f.id}>
                  <div
                    draggable
                    onDragStart={(e) => startDrag(e, { kind: 'move', id: f.id })}
                    onDragEnd={() => setDrag(null)}
                    onClick={() => setSelection({ kind: 'field', id: f.id })}
                    className={`flex cursor-pointer items-center gap-2 rounded border bg-white px-3 py-2 ${selected ? 'border-td-blue ring-1 ring-td-blue' : 'border-td-border hover:border-td-blue'}`}
                  >
                    <span className="cursor-grab select-none text-td-muted" aria-hidden>
                      ⋮⋮
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-td-blue-dark">
                        {f.label || '（未命名）'}
                        {f.required && <span className="text-red-600"> *</span>}
                      </span>
                      <span className="ml-2 text-xs text-td-muted">
                        {FIELD_TYPE_LABELS[f.type]} · <span className="font-mono">{f.id}</span> · {f.width === 4 ? '整列' : `${f.width}/4`}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {f.semantic && <span className="badge bg-td-blue-light text-td-blue">{SEMANTIC_BADGE[f.semantic]}</span>}
                        {f.showInHeader && <span className="badge bg-slate-100 text-slate-700">表頭</span>}
                        {f.visibleWhen && <span className="badge bg-amber-50 text-amber-800">條件顯示</span>}
                        {usedByFlow.has(f.id) && <span className="badge bg-emerald-50 text-emerald-800">流程使用</span>}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className={smallBtn} aria-label={`上移 ${f.label}`} onClick={() => nudge(f.id, -1)}>
                        ↑
                      </button>
                      <button type="button" className={smallBtn} aria-label={`下移 ${f.label}`} onClick={() => nudge(f.id, 1)}>
                        ↓
                      </button>
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => {
                          const r = duplicateField(schema, f.id);
                          setSchema(r.schema);
                          if (r.newId) setSelection({ kind: 'field', id: r.newId });
                        }}
                      >
                        複製
                      </button>
                      <button type="button" className={dangerBtn} onClick={() => remove(f)}>
                        刪除
                      </button>
                    </span>
                  </div>
                  <DropSlot active={drag !== null} onDrop={() => dropAt(section.id, i + 1)} />
                </div>
              );
            })}
          </section>
        ))}
        <button
          type="button"
          className="btn-secondary w-full !py-2"
          onClick={() => {
            const r = addSection(schema);
            setSchema(r.schema);
            setSelection({ kind: 'section', id: r.id });
          }}
        >
          ＋ 新增區段
        </button>
      </div>

      <aside className="card h-fit !p-3 lg:sticky lg:top-4">
        {selectedField && (
          <FieldProps
            field={selectedField}
            onChange={(next) => {
              // Ids address fields in every edit, so a rename may not take another field's id.
              if (next.id !== selectedField.id && schemaFieldIds(schema).includes(next.id)) return;
              setSchema(updateField(schema, selectedField.id, () => next));
              if (next.id !== selectedField.id) setSelection({ kind: 'field', id: next.id });
            }}
            idLocked={selectedField.id in publishedTypes}
            condFields={earlierCondFields(schema, selectedField.id, options)}
            schema={schema}
            sourceForms={sourceForms}
            options={options}
            sections={schema.sections.map((s) => ({ id: s.id, title: s.title }))}
            sectionId={locateField(schema, selectedField.id)?.sectionId ?? ''}
            onMoveToSection={(sid) => {
              const target = schema.sections.find((s) => s.id === sid);
              if (target) setSchema(moveField(schema, selectedField.id, sid, target.fields.length));
            }}
          />
        )}
        {selectedSection && (
          <div className="space-y-3 text-sm">
            <p className="text-xs font-semibold text-td-muted">區段</p>
            <Field label="標題">
              <input
                className={smallInput}
                maxLength={60}
                value={selectedSection.title}
                onChange={(e) => setSchema({ ...schema, sections: schema.sections.map((s) => (s.id === selectedSection.id ? { ...s, title: e.target.value } : s)) })}
              />
            </Field>
            <Field label="說明">
              <textarea
                className={`${smallInput} resize-y`}
                rows={3}
                maxLength={300}
                value={selectedSection.description}
                onChange={(e) =>
                  setSchema({ ...schema, sections: schema.sections.map((s) => (s.id === selectedSection.id ? { ...s, description: e.target.value } : s)) })
                }
              />
            </Field>
          </div>
        )}
        {!selectedField && !selectedSection && (
          <div className="space-y-4 text-sm">
            <p className="text-td-muted">點選欄位或區段來編輯屬性。</p>
            <div className="border-t border-dashed border-td-border pt-3">
              <p className="text-xs font-semibold text-td-blue-dark">整張表單</p>
              <label className="mt-2 flex items-start gap-2 text-td-blue-dark">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={schema.onBehalf === true}
                  onChange={(e) => {
                    const next = { ...schema };
                    if (e.target.checked) next.onBehalf = true;
                    else delete next.onBehalf;
                    setSchema(next);
                  }}
                />
                <span>
                  允許代為申請
                  <span className="block text-xs text-td-muted">
                    經辦可以替其他同仁填單；會先送申請人確認，且申請人與經辦以外至少要有一人簽核。經辦也能修改、撤回並收到結果通知。
                  </span>
                </span>
              </label>
            </div>
            <AssetRegisterEditor schema={schema} setSchema={setSchema} />
          </div>
        )}
      </aside>
    </div>
  );
}
