'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { inputCls } from '@/app/components/form-fields';
import type { OrgDepartmentRow, OrgEmployeeRow } from '@/lib/admin/org/queries';

type Result = { ok: true } | { ok: false; code: string; error: string };
type Message = { kind: 'ok' | 'error'; text: string; reauth?: boolean };

/** Runs a server action, refreshes on success and keeps the last message. */
export function useOrgAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<Message | null>(null);
  const run = <R extends Result>(action: () => Promise<R>, success: string | ((r: Extract<R, { ok: true }>) => string), after?: () => void) => {
    setMsg(null);
    start(async () => {
      try {
        const r = await action();
        if (r.ok) {
          setMsg({ kind: 'ok', text: typeof success === 'string' ? success : success(r as Extract<R, { ok: true }>) });
          after?.();
          router.refresh();
        } else {
          setMsg({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
        }
      } catch {
        setMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
      }
    });
  };
  return { pending, msg, run };
}

export function ActionMessage({ msg }: { msg: Message | null }) {
  const pathname = usePathname();
  if (!msg) return null;
  return (
    <p
      role={msg.kind === 'error' ? 'alert' : 'status'}
      className={`rounded border px-3 py-2 text-sm ${
        msg.kind === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      {msg.text}
      {msg.reauth && (
        <>
          {' '}
          <a className="font-semibold underline" href={`/auth/google?returnTo=${encodeURIComponent(pathname)}`}>
            重新登入
          </a>
        </>
      )}
    </p>
  );
}

export const smallInput = inputCls.replace('px-3 py-2', 'px-2 py-1.5');
export const smallBtn = 'rounded border border-td-border bg-white px-2.5 py-1 text-xs font-semibold text-td-blue hover:bg-td-blue-light disabled:opacity-50';
export const dangerBtn = 'rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50';

export function employeeLabel(e: OrgEmployeeRow | undefined, departments: OrgDepartmentRow[]): string {
  if (!e) return '（找不到員工）';
  const dept = departments.find((d) => d.id === e.departmentId);
  return `${e.name}${dept ? `（${dept.name}）` : ''}${e.active ? '' : '【已停用】'}`;
}

export function EmployeeSelect({
  employees,
  departments,
  value,
  onChange,
  placeholder = '選擇員工…',
  exclude = [],
  id,
  label,
  className = smallInput,
}: {
  employees: OrgEmployeeRow[];
  departments: OrgDepartmentRow[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  exclude?: string[];
  id?: string;
  label?: string;
  className?: string;
}) {
  const choices = employees.filter((e) => (e.active && !exclude.includes(e.id)) || e.id === value);
  return (
    <select id={id} aria-label={label} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {choices.map((e) => (
        <option key={e.id} value={e.id}>
          {employeeLabel(e, departments)}
        </option>
      ))}
    </select>
  );
}

/** "Used by" note for things live approval flows name. */
export function InUseNote({ forms }: { forms: string[] | undefined }) {
  if (!forms || forms.length === 0) return null;
  return (
    <span className="badge bg-amber-50 text-amber-800" title={`簽核流程使用中：${forms.join('、')}`}>
      流程使用中 {forms.length}
    </span>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-td-blue-dark">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-td-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
