import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded border border-td-border bg-slate-50 px-3 py-2 text-sm text-td-blue-dark placeholder:text-slate-400 focus:border-td-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-td-blue/15 disabled:cursor-not-allowed disabled:text-slate-500';
export const readOnlyCls = `${inputCls} !bg-slate-100 text-slate-500`;

export function Req() {
  return <span className="ml-0.5 text-red-500">*</span>;
}

export function Info({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle" tabIndex={0}>
      <span className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-td-muted text-[9px] font-semibold text-td-muted">
        i
      </span>
      <span className="pointer-events-none absolute left-1/2 top-5 z-20 hidden w-56 -translate-x-1/2 rounded-md bg-td-blue-dark px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-lg group-hover:block group-focus:block">
        {text}
      </span>
    </span>
  );
}

export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-sm font-semibold text-td-blue-dark">
        {label}
        {required && <Req />}
      </p>
      {hint && <p className="mt-1 text-xs text-td-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** One row of the form: fields separated by dashed lines, stacked on small screens. */
export function FieldRow({ cols, children }: { cols: 2 | 3; children: ReactNode }) {
  return (
    <div
      className={`grid divide-y divide-dashed divide-td-border border-t border-dashed border-td-border md:divide-x md:divide-y-0 ${
        cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'
      }`}
    >
      {children}
    </div>
  );
}
