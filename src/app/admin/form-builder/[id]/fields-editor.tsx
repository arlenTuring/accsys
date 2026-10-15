'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import { flowFieldIds } from '@/lib/approval/flow/references';
import type { FlowDef } from '@/lib/approval/flow/types';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { parseFormSchema, type FieldDef, type FieldType, type FormSchema } from '@/lib/custom-forms/schema';
import { newField } from '@/lib/form-builder/blank';
import type { PublishedFieldTypes } from '@/lib/form-builder/diff';
import { previewSourceOptions } from '@/lib/form-builder/preview-sources';
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
import { smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { AssetRegisterEditor } from './asset-register-editor';
import { ComponentDrawer, DRAWER_HEIGHT } from './component-drawer';
import { DesignCanvas } from './design-canvas';
import { PaymentEditor } from './payment-editor';
import { earlierCondFields } from './designer-model';
import { FieldProps } from './field-props';
import { isBlankPress, isDeleteKey, isTextEntry, KEEP_SELECTION } from './shortcuts';

export type FieldSelection = { kind: 'field'; id: string } | { kind: 'section'; id: string } | null;

type Drag = { kind: 'new'; type: FieldType } | { kind: 'move'; id: string } | null;

const DRAWER_KEY = 'form-builder:component-drawer';
/** Distance from the top of the window / the drawer within which a drag scrolls the page. */
const SCROLL_EDGE = 60;

const drawerListeners = new Set<() => void>();
const subscribeDrawer = (listener: () => void) => {
  drawerListeners.add(listener);
  return () => void drawerListeners.delete(listener);
};
const drawerSnapshot = () => window.localStorage.getItem(DRAWER_KEY) !== 'closed';
const toggleDrawer = (open: boolean) => {
  window.localStorage.setItem(DRAWER_KEY, open ? 'open' : 'closed');
  drawerListeners.forEach((l) => l());
};

export function FieldsEditor({
  name,
  description,
  schema,
  setSchema,
  flow,
  selection,
  setSelection,
  publishedTypes,
  options,
  sourceForms,
  announce,
  footer,
}: {
  name: string;
  description: string;
  schema: FormSchema;
  setSchema: (s: FormSchema) => void;
  flow: FlowDef;
  selection: FieldSelection;
  setSelection: (s: FieldSelection) => void;
  publishedTypes: PublishedFieldTypes;
  options: PickerOptions;
  sourceForms: BuilderSourceForm[];
  /** Short notice after a deletion (offers undo). */
  announce: (text: string) => void;
  footer: ReactNode;
}) {
  const [drag, setDrag] = useState<Drag>(null);
  const drawerOpen = useSyncExternalStore(subscribeDrawer, drawerSnapshot, () => true);
  const usedByFlow = new Set(flowFieldIds(flow));
  const canvasOptions = useMemo(() => {
    const parsed = parseFormSchema(schema);
    return parsed.ok ? { ...options, sources: previewSourceOptions(parsed.schema, sourceForms, options) } : options;
  }, [schema, options, sourceForms]);

  // The drawer covers the bottom of the window, where the browser would otherwise auto-scroll a drag.
  useEffect(() => {
    if (drag === null) return;
    const onDragOver = (e: globalThis.DragEvent) => {
      const bottom = window.innerHeight - (drawerOpen ? window.innerHeight / 6 : 0);
      if (e.clientY < SCROLL_EDGE) window.scrollBy(0, -16);
      else if (e.clientY > bottom - SCROLL_EDGE && e.clientY < bottom) window.scrollBy(0, 16);
    };
    document.addEventListener('dragover', onDragOver);
    return () => document.removeEventListener('dragover', onDragOver);
  }, [drag, drawerOpen]);

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

  const duplicate = (id: string) => {
    const r = duplicateField(schema, id);
    setSchema(r.schema);
    if (r.newId) setSelection({ kind: 'field', id: r.newId });
  };

  const remove = (f: FieldDef) => {
    setSchema(removeField(schema, f.id));
    setSelection(null);
    announce(`已刪除「${f.label || f.id}」${usedByFlow.has(f.id) ? '（簽核流程有用到，需重新設定）' : ''}`);
  };

  const removeSection = (id: string) => {
    const section = schema.sections.find((s) => s.id === id);
    if (!section || schema.sections.length === 1) return;
    setSchema({ ...schema, sections: schema.sections.filter((s) => s.id !== id) });
    setSelection(null);
    announce(`已刪除區段「${section.title || section.id}」${section.fields.length > 0 ? `與其中 ${section.fields.length} 個欄位` : ''}`);
  };

  const latest = useRef({ remove, removeSection, selectedField, selection });
  useEffect(() => {
    latest.current = { remove, removeSection, selectedField, selection };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTextEntry(e.target)) return;
      const { selection: sel, selectedField: field } = latest.current;
      if (!sel) return;
      if (e.key === 'Escape') {
        setSelection(null);
      } else if (isDeleteKey(e)) {
        e.preventDefault();
        if (sel.kind === 'field' && field) latest.current.remove(field);
        if (sel.kind === 'section') latest.current.removeSection(sel.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelection]);

  useEffect(() => {
    if (!selection) return;
    const onPress = (e: PointerEvent) => {
      if (isBlankPress(e)) setSelection(null);
    };
    document.addEventListener('pointerdown', onPress);
    return () => document.removeEventListener('pointerdown', onPress);
  }, [selection, setSelection]);

  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d?.kind === 'new' ? d.type : (d?.id ?? ''));
    setDrag(d);
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <DesignCanvas
            name={name}
            description={description}
            schema={schema}
            setSchema={setSchema}
            selection={selection}
            setSelection={setSelection}
            dragging={drag !== null}
            startMove={(e, id) => startDrag(e, { kind: 'move', id })}
            endDrag={() => setDrag(null)}
            dropAt={dropAt}
            options={canvasOptions}
            usedByFlow={usedByFlow}
            onNudge={nudge}
            onDuplicate={duplicate}
            onRemove={remove}
            onMoveSection={(id, delta) => setSchema(moveSection(schema, id, delta))}
            onRemoveSection={removeSection}
            footer={footer}
          />
          <button
            {...KEEP_SELECTION}
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

        <aside
          {...KEEP_SELECTION}
          className={`card h-fit !p-3 lg:sticky lg:top-24 lg:overflow-y-auto ${drawerOpen ? 'lg:max-h-[calc(83.333vh-7rem)]' : 'lg:max-h-[calc(100vh-7rem)]'}`}
        >
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
              <p className="text-td-muted">點選欄位或區段來編輯屬性；名稱、說明、選項等文字也可以直接在表單上點一下修改。</p>
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
              <PaymentEditor schema={schema} setSchema={setSchema} />
            </div>
          )}
        </aside>
      </div>
      {drawerOpen && <div aria-hidden className={DRAWER_HEIGHT} />}
      <ComponentDrawer
        open={drawerOpen}
        setOpen={toggleDrawer}
        onAdd={(t) => add(t)}
        onDragStart={(e, type) => startDrag(e, { kind: 'new', type })}
        onDragEnd={() => setDrag(null)}
      />
    </>
  );
}
