'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/app/components/brand-logo';
import { UserMenu, type MenuEmployee } from '@/app/components/user-menu';
import { ADMIN_NAV_PERMISSIONS, FINANCE_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import {
  ADMIN_LINKS,
  FINANCE_LINKS,
  isNewFormPage,
  isRecordPage,
  isUnder,
  type FormCategory,
  type RecordLink,
} from '@/lib/forms/catalog';

type TopNavProps = {
  employee: MenuEmployee;
  pendingApprovalCount?: number;
  /** Built-in plus published designer forms (merged on the server). */
  categories: FormCategory[];
};

function NavItem({ href, label, badge }: { href: string; label: string; badge?: number }) {
  const pathname = usePathname();
  return (
    <Link href={href} className={isUnder(pathname, href) ? 'nav-link-active nav-link' : 'nav-link'}>
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 rounded-full bg-td-apex px-1.5 py-0.5 text-[10px] font-bold text-td-blue-dark">{badge}</span>
      )}
    </Link>
  );
}

/** Open state tied to the route it was opened on, so navigating closes it. */
function useRouteScopedOpen() {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const setOpen = useCallback(
    (next: boolean | ((open: boolean) => boolean)) =>
      setOpenOn((prev) => {
        const value = typeof next === 'function' ? next(prev === pathname) : next;
        return value ? pathname : null;
      }),
    [pathname]
  );
  return [openOn === pathname, setOpen] as const;
}

/** `wide` panels span the header (positioned against it) instead of hanging off the button. */
function NavMenu({ label, active, wide, children }: { label: string; active: boolean; wide?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useRouteScopedOpen();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className={wide ? undefined : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`${active || open ? 'nav-link-active ' : ''}nav-link inline-flex items-center gap-1`}
      >
        {label}
        <svg className={`h-3.5 w-3.5 opacity-70 transition ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div
          className={`absolute z-50 rounded-card border border-td-border bg-white text-td-blue-dark shadow-card ${
            wide ? 'inset-x-4 top-full mx-auto max-w-4xl sm:inset-x-6 lg:inset-x-8' : 'left-0 mt-2'
          }`}
          onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const menuLink = 'block rounded-md px-3 py-1.5 text-sm hover:bg-td-blue-light hover:text-td-blue';
const menuHeading = 'px-3 pb-1 text-xs font-semibold tracking-wide text-td-muted';

function LinkList({ links }: { links: RecordLink[] }) {
  return (
    <div className="w-48 p-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={menuLink}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}

function MobileMenu({
  showFinance,
  showAdmin,
  pendingApprovalCount,
  categories,
}: {
  showFinance: boolean;
  showAdmin: boolean;
  pendingApprovalCount: number;
  categories: FormCategory[];
}) {
  const [open, setOpen] = useRouteScopedOpen();
  const groups: { title: string; links: RecordLink[] }[] = [
    {
      title: '常用',
      links: [
        { label: '工作台', href: '/dashboard' },
        { label: pendingApprovalCount > 0 ? `待簽核（${pendingApprovalCount}）` : '待簽核', href: '/approvals' },
        { label: '申請表單', href: '/forms' },
      ],
    },
    { title: '我的申請', links: categories.flatMap((c) => c.records) },
    ...(showFinance ? [{ title: '財會管理', links: FINANCE_LINKS }] : []),
    ...(showAdmin ? [{ title: '系統管理', links: ADMIN_LINKS }] : []),
    { title: '其他', links: [{ label: '工具區', href: '/tools' }] },
  ];
  return (
    <div className="md:hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="nav-link">
        選單
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 max-h-[80vh] space-y-3 overflow-y-auto border-t border-td-border bg-white p-3 text-td-blue-dark shadow-card">
          {groups.map((g) => (
            <div key={g.title}>
              <p className={menuHeading}>{g.title}</p>
              <div className="grid grid-cols-2">
                {g.links.map((l) => (
                  <Link key={l.href} href={l.href} className={menuLink}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav({ employee, pendingApprovalCount = 0, categories }: TopNavProps) {
  const pathname = usePathname();
  const showFinance = hasAnyPermission(employee.permissions, FINANCE_NAV_PERMISSIONS);
  const showAdmin = hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS);

  return (
    <header className="sticky top-0 z-40 border-b border-td-blue-dark/10 bg-td-blue-dark shadow-nav print:hidden">
      <div className="relative mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLogo variant="light" href="/dashboard" />

        <nav className="hidden items-center gap-0.5 md:flex">
          <NavItem href="/dashboard" label="工作台" />
          <NavItem href="/approvals" label="待簽核" badge={pendingApprovalCount} />

          <NavMenu label="申請表單" active={isNewFormPage(pathname)} wide>
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-4 lg:grid-cols-4">
              {categories.map((c) => (
                <div key={c.id}>
                  <p className={menuHeading}>{c.title}</p>
                  {c.forms.map((f) => (
                    <Link key={f.href} href={f.href} className={menuLink}>
                      {f.title}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
            <div className="border-t border-td-border px-4 py-2.5">
              <Link href="/forms" className="text-sm font-semibold text-td-blue hover:underline">
                查看所有表單與說明 →
              </Link>
            </div>
          </NavMenu>

          <NavMenu label="我的申請" active={isRecordPage(pathname)}>
            <div className="max-h-[70vh] w-56 space-y-3 overflow-y-auto p-2 pt-3">
              {categories.map((c) => (
                <div key={c.id}>
                  <p className={menuHeading}>{c.title}</p>
                  {c.records.map((r) => (
                    <Link key={r.href} href={r.href} className={menuLink}>
                      {r.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </NavMenu>

          {showFinance && (
            <NavMenu label="財會管理" active={FINANCE_LINKS.some((l) => isUnder(pathname, l.href))}>
              <LinkList links={FINANCE_LINKS} />
            </NavMenu>
          )}
          {showAdmin && (
            <NavMenu label="系統管理" active={ADMIN_LINKS.some((l) => isUnder(pathname, l.href))}>
              <LinkList links={ADMIN_LINKS} />
            </NavMenu>
          )}
          <NavItem href="/tools" label="工具區" />
        </nav>

        <MobileMenu
          showFinance={showFinance}
          showAdmin={showAdmin}
          pendingApprovalCount={pendingApprovalCount}
          categories={categories}
        />

        <div className="ml-auto shrink-0">
          <UserMenu employee={employee} />
        </div>
      </div>
    </header>
  );
}
