'use client';

import type { DragEvent } from 'react';
import type { FieldType } from '@/lib/custom-forms/schema';
import { FIELD_GROUPS, FIELD_TYPE_LABELS } from '@/lib/form-builder/blank';

/** Share of the viewport height the open drawer may take. */
export const DRAWER_HEIGHT = 'h-[16.667vh]';

/**
 * Component library docked at the bottom of the window. Each group lists its
 * components top to bottom and continues in a new column when the drawer
 * height (1/6 of the window) is used up.
 */
export function ComponentDrawer({
  open,
  setOpen,
  onAdd,
  onDragStart,
  onDragEnd,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  onAdd: (type: FieldType) => void;
  onDragStart: (e: DragEvent, type: FieldType) => void;
  onDragEnd: () => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="fixed bottom-0 left-1/2 z-30 -translate-x-1/2 rounded-t-lg border border-b-0 border-td-border bg-white px-4 py-1.5 text-sm font-semibold text-td-blue-dark shadow-[0_-4px_12px_rgba(15,45,92,0.12)] hover:text-td-blue"
      >
        ▴ 元件庫
      </button>
    );
  }
  return (
    <aside
      aria-label="元件庫"
      className={`fixed inset-x-0 bottom-0 z-30 ${DRAWER_HEIGHT} border-t border-td-border bg-white/95 shadow-[0_-4px_12px_rgba(15,45,92,0.08)] backdrop-blur`}
    >
      <div className="mx-auto flex h-full max-w-[1500px] gap-5 px-4 py-2 sm:px-6">
        <div className="flex w-24 shrink-0 flex-col justify-between overflow-hidden">
          <div>
            <p className="text-sm font-semibold leading-4 text-td-blue-dark">元件庫</p>
            <p className="mt-0.5 text-[11px] leading-4 text-td-muted">點一下加到選取位置，或拖曳到表單</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-expanded className="self-start text-xs font-semibold text-td-blue hover:underline">
            ▾ 收合
          </button>
        </div>
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto overflow-y-hidden">
          {FIELD_GROUPS.map((g) => (
            <div key={g.title} className="shrink-0">
              <p className="mb-1 h-4 text-xs font-semibold leading-4 text-td-muted">{g.title}</p>
              <div className="grid h-[calc(16.667vh-2.25rem)] min-h-6 auto-cols-max grid-flow-col grid-rows-[repeat(auto-fill,1.5rem)] gap-1">
                {g.types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    draggable
                    onDragStart={(e) => onDragStart(e, t)}
                    onDragEnd={onDragEnd}
                    onClick={() => onAdd(t)}
                    className="h-6 cursor-grab whitespace-nowrap rounded border border-td-border bg-white px-2 text-left text-xs font-semibold text-td-blue-dark hover:border-td-blue hover:bg-td-blue-light"
                  >
                    {FIELD_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
