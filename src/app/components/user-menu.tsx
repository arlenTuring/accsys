'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CurrentEmployee } from '@/lib/auth/current-employee';
import { isDevLoginEnabled } from '@/lib/auth/dev-personas';

const ROLE_LABELS: Record<CurrentEmployee['role'], string> = {
  staff: '一般員工',
  finance: '財會',
  admin: '系統管理員',
};

type UserMenuProps = {
  employee: Pick<
    CurrentEmployee,
    | 'name'
    | 'email'
    | 'employeeCode'
    | 'title'
    | 'departmentName'
    | 'departmentCode'
    | 'role'
    | 'isGeneralManager'
    | 'isChairman'
  >;
};

function roleBadgeClass(role: CurrentEmployee['role']): string {
  if (role === 'admin') return 'bg-td-apex/20 text-td-apex';
  if (role === 'finance') return 'bg-emerald-400/20 text-emerald-100';
  return 'bg-white/15 text-white/90';
}

export function UserMenu({ employee }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = employee.name.slice(0, 1);
  const showDevSwitch = isDevLoginEnabled();

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const extraRoles: string[] = [];
  if (employee.isGeneralManager) extraRoles.push('總經理');
  if (employee.isChairman) extraRoles.push('董事長');

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/10"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-td-apex text-sm font-bold text-td-blue-dark">
          {initial}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-semibold text-white">{employee.name}</span>
          <span className="block truncate text-xs text-white/65">
            {employee.departmentName}
            {employee.title ? ` · ${employee.title}` : ''}
          </span>
        </span>
        <svg
          className={`hidden h-4 w-4 text-white/60 sm:block ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-card border border-td-border bg-white text-td-blue-dark shadow-card">
          <div className="border-b border-td-border bg-td-blue-light/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-td-blue text-base font-bold text-white">
                {initial}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{employee.name}</p>
                <p className="truncate text-xs text-td-muted">{employee.email}</p>
              </div>
            </div>
          </div>

          <dl className="space-y-2 px-4 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-td-muted">工號</dt>
              <dd className="font-mono font-medium">{employee.employeeCode}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-td-muted">部門</dt>
              <dd className="text-right">
                {employee.departmentName}
                <span className="ml-1 font-mono text-xs text-td-muted">({employee.departmentCode})</span>
              </dd>
            </div>
            {employee.title && (
              <div className="flex justify-between gap-3">
                <dt className="text-td-muted">職稱</dt>
                <dd>{employee.title}</dd>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-td-muted">角色</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                <span className={`badge ${roleBadgeClass(employee.role)} !text-td-blue-dark`}>
                  {ROLE_LABELS[employee.role]}
                </span>
                {extraRoles.map((label) => (
                  <span key={label} className="badge bg-td-blue-light text-td-blue">
                    {label}
                  </span>
                ))}
              </dd>
            </div>
          </dl>

          <div className="border-t border-td-border px-2 py-2">
            {showDevSwitch && (
              <Link
                href="/login"
                className="block rounded-md px-3 py-2 text-sm text-td-blue hover:bg-td-blue-light"
                onClick={() => setOpen(false)}
              >
                切換示範角色
              </Link>
            )}
            <a
              href="/auth/logout"
              className="block rounded-md px-3 py-2 text-sm text-td-muted hover:bg-slate-50 hover:text-td-blue-dark"
            >
              登出
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
