'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Site-styled replacements for window.confirm / window.prompt. Call
 * confirmDialog / promptDialog from any client code; <DialogHost /> (root
 * layout) shows one dialog at a time, a newer one cancels the open one.
 */

export type DialogOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: deleting, disabling or revoking (red button, Cancel focused). */
  tone?: 'primary' | 'danger';
};

export type PromptOptions = DialogOptions & { label: string; placeholder?: string; maxLength?: number; required?: boolean };

type Request = { id: number; options: DialogOptions; prompt?: PromptOptions; resolve: (value: string | null) => void };

let current: Request | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function open(options: DialogOptions, prompt?: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    current?.resolve(null);
    current = { id: nextId++, options, prompt, resolve };
    emit();
  });
}

function settle(value: string | null) {
  const r = current;
  current = null;
  emit();
  r?.resolve(value);
}

export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return open(options).then((v) => v !== null);
}

/** The trimmed text, or null when cancelled. */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return open(options, options);
}

export function DialogHost() {
  const request = useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    if (!request && el.open) el.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="site-dialog-title"
      // Page-level shortcuts (form designer: Delete, Esc, click-away) must not see the dialog's clicks and keys.
      data-keep-selection=""
      onKeyDown={(e) => e.stopPropagation()}
      className="w-[calc(100%-2rem)] max-w-md rounded-card border border-td-border bg-white p-0 text-td-blue-dark shadow-lg backdrop:bg-td-blue-dark/40"
      onCancel={(e) => {
        e.preventDefault();
        settle(null);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(null);
      }}
    >
      {request && <DialogBody key={request.id} request={request} />}
    </dialog>
  );
}

function DialogBody({ request }: { request: Request }) {
  const { options, prompt } = request;
  const danger = options.tone === 'danger';
  const [value, setValue] = useState('');
  const blocked = prompt?.required === true && value.trim() === '';

  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) settle(prompt ? value.trim() : '');
      }}
    >
      <h2 id="site-dialog-title" className="text-lg font-bold text-td-blue-dark">
        {options.title}
      </h2>
      {options.message && <div className="whitespace-pre-line text-sm leading-6 text-slate-700">{options.message}</div>}
      {prompt && (
        <label className="block">
          <span className="text-xs font-semibold text-td-blue-dark">{prompt.label}</span>
          <input
            className="mt-1 w-full rounded-lg border border-td-border px-3 py-2 text-sm focus:border-td-blue focus:outline-none focus:ring-2 focus:ring-td-blue/20"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={prompt.placeholder}
            maxLength={prompt.maxLength}
            autoFocus
          />
        </label>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary !py-2" onClick={() => settle(null)} autoFocus={danger && !prompt}>
          {options.cancelLabel ?? '取消'}
        </button>
        <button type="submit" className={`${danger ? 'btn-danger' : 'btn-primary'} !py-2`} disabled={blocked} autoFocus={!danger && !prompt}>
          {options.confirmLabel ?? '確定'}
        </button>
      </div>
    </form>
  );
}
