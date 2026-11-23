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

export type PromptOptions = DialogOptions & {
  label: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  defaultValue?: string;
};

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
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-td-border bg-white p-0 text-td-blue-dark shadow-2xl backdrop:bg-td-blue-dark/45 backdrop:backdrop-blur-[2px]"
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
  const [value, setValue] = useState(prompt?.defaultValue ?? '');
  const blocked = prompt?.required === true && value.trim() === '';

  return (
    <form
      className="overflow-hidden"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) settle(prompt ? value.trim() : '');
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-lg text-xs font-extrabold ${
              danger
                ? 'bg-rose-100 text-rose-600 ring-1 ring-rose-200/80'
                : 'bg-blue-100 text-td-blue ring-1 ring-blue-200/80'
            }`}
            aria-hidden="true"
          >
            {danger ? '!' : 'i'}
          </span>
          <span className="text-[11px] font-bold tracking-wider text-slate-500">
            TURING DRIVE <span className="rounded bg-td-blue/10 px-1.5 py-0.5 text-[10px] font-extrabold text-td-blue">ACCSYS</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => settle(null)}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200/60 hover:text-slate-700"
          aria-label="關閉"
        >
          ✕
        </button>
      </div>
      <div className="space-y-3.5 px-5 py-4">
        <h2 id="site-dialog-title" className="text-base font-extrabold text-td-blue-dark">
          {options.title}
        </h2>
        {options.message && (
          <div className="whitespace-pre-line text-sm leading-6 text-slate-600">
            {options.message}
          </div>
        )}
        {prompt && (
          <label className="block pt-1">
            <span className="text-xs font-semibold text-td-blue-dark">{prompt.label}</span>
            <input
              className="mt-1.5 w-full rounded-xl border border-td-border px-3.5 py-2 text-sm text-td-blue-dark focus:border-td-blue focus:outline-none focus:ring-2 focus:ring-td-blue/20"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={prompt.placeholder}
              maxLength={prompt.maxLength}
              autoFocus
            />
          </label>
        )}
      </div>
      <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <button
          type="button"
          className="btn-secondary !px-4 !py-2 !text-xs"
          onClick={() => settle(null)}
          autoFocus={danger && !prompt}
        >
          {options.cancelLabel ?? '取消'}
        </button>
        <button
          type="submit"
          className={`${danger ? 'btn-danger' : 'btn-primary'} !px-4 !py-2 !text-xs`}
          disabled={blocked}
          autoFocus={!danger && !prompt}
        >
          {options.confirmLabel ?? '確定'}
        </button>
      </div>
    </form>
  );
}
