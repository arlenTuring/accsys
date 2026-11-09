'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GlobalAssistant } from '@/app/components/global-assistant';
import mark from '@/app/components/turing-drive-mark.png';
import {
  ADMIN_NAV_PERMISSIONS,
  FINANCE_NAV_PERMISSIONS,
  hasAnyPermission,
} from '@/lib/authz/permissions';
import type { SidebarEmployeeProfile } from '@/lib/auth/sidebar-profile';
import {
  ADMIN_LINKS,
  COMPANY_INFO_LINKS,
  FINANCE_LINKS,
  isNewFormPage,
  isRecordPage,
  isUnder,
  type FormCategory,
  type RecordLink,
} from '@/lib/forms/catalog';
import { LanguageSwitcher, useI18n } from '@/lib/i18n/context';

type AppShellProps = {
  profile: SidebarEmployeeProfile;
  pendingApprovalCount: number;
  categories: FormCategory[];
  children: React.ReactNode;
};

type PrimaryNavKey = 'ai' | 'project' | 'approvals' | 'company' | 'finance' | 'admin' | 'tools';

const SYSTEM_ROLE_LABELS: Record<string, string> = {
  staff: '一般員工',
  finance: '財會',
  admin: '系統管理員',
};

function resolveActiveSection(pathname: string): PrimaryNavKey {
  if (pathname === '/' || pathname.startsWith('/tools/ai-chat') || pathname === '/dashboard') {
    return 'ai';
  }
  if (pathname.startsWith('/tools/project-assistant')) {
    return 'project';
  }
  if (
    isRecordPage(pathname) ||
    isNewFormPage(pathname) ||
    isUnder(pathname, '/applications') ||
    isUnder(pathname, '/approvals') ||
    isUnder(pathname, '/forms')
  ) {
    return 'approvals';
  }
  if (COMPANY_INFO_LINKS.some((l) => isUnder(pathname, l.href))) {
    return 'company';
  }
  if (FINANCE_LINKS.some((l) => isUnder(pathname, l.href)) || isUnder(pathname, '/assets')) {
    return 'finance';
  }
  if (ADMIN_LINKS.some((l) => isUnder(pathname, l.href)) || isUnder(pathname, '/admin')) {
    return 'admin';
  }
  if (isUnder(pathname, '/tools')) {
    return 'tools';
  }
  return 'ai';
}

function RailIcon({ name }: { name: PrimaryNavKey }) {
  switch (name) {
    case 'ai':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      );
    case 'project':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 13h6m-3-3v6"
          />
        </svg>
      );
    case 'approvals':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'company':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
          />
        </svg>
      );
    case 'finance':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case 'admin':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'tools':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
          />
        </svg>
      );
  }
}

function CopyTagButton({ tag }: { tag: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(tag);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-td-blue transition hover:bg-td-blue-light"
      title={t.shell.account.copyTagTitle}
    >
      {copied ? t.common.copied : t.common.copy}
    </button>
  );
}

function EmployeeAccountPopover({ profile }: { profile: SidebarEmployeeProfile }) {
  const { t, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = profile.name.slice(0, 1);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const rawRoleText = SYSTEM_ROLE_LABELS[profile.role] ?? profile.role;
  const roleText = tr(rawRoleText);

  return (
    <div ref={rootRef} className="relative flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={`${profile.name} (${profile.email})`}
        className={`group relative flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold transition ${
          open
            ? 'border-td-blue bg-td-blue text-white shadow-md'
            : 'border-emerald-500/80 bg-emerald-600 text-white hover:scale-105 hover:shadow-sm'
        }`}
      >
        {initial}
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-400" />
      </button>

      {open && (
        <div className="fixed bottom-4 left-16 z-50 w-[23rem] max-w-[calc(100vw-5rem)] overflow-hidden rounded-2xl border border-td-border bg-white text-td-blue-dark shadow-2xl">
          {/* Header: GWS Account & Employee Identity */}
          <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-blue-50/50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-td-blue text-lg font-bold text-white shadow-xs">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-bold text-td-blue-dark">{profile.name}</p>
                  <span className="rounded-full bg-td-blue/10 px-2 py-0.5 text-[11px] font-semibold text-td-blue">
                    {roleText}
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-td-muted">
                  <span className="rounded bg-white px-1.5 py-0.2 font-semibold text-slate-600 ring-1 ring-slate-200">
                    GWS
                  </span>
                  <span className="truncate font-mono">
                    {profile.email || t.shell.account.unboundGws}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Language Switcher Row */}
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-4 py-2 text-xs">
            <span className="font-semibold text-td-muted">🌐 {t.common.language}</span>
            <LanguageSwitcher variant="row" />
          </div>

          {/* Employee Details: Employee Code, Department, Direct Manager */}
          <dl className="grid grid-cols-2 gap-2.5 border-b border-slate-100 px-4 py-3 text-xs">
            <div className="rounded-lg bg-slate-50/80 px-3 py-2">
              <dt className="text-[11px] text-td-muted">{t.shell.account.employeeCode}</dt>
              <dd className="mt-0.5 font-mono text-sm font-bold text-td-blue-dark">
                {profile.employeeCode}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50/80 px-3 py-2">
              <dt className="text-[11px] text-td-muted">{t.shell.account.department}</dt>
              <dd className="mt-0.5 truncate font-semibold text-td-blue-dark">
                {profile.departmentName}
                <span className="ml-1 font-mono text-[11px] text-td-muted">
                  ({profile.departmentCode})
                </span>
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50/80 px-3 py-2">
              <dt className="text-[11px] text-td-muted">{t.shell.account.directManager}</dt>
              <dd className="mt-0.5 font-semibold text-td-blue-dark">
                {profile.managerName ? (
                  <>
                    {profile.managerName}
                    {profile.managerEmployeeCode && (
                      <span className="ml-1 font-mono text-[11px] text-td-muted">
                        ({profile.managerEmployeeCode})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-td-muted">—</span>
                )}
              </dd>
            </div>
            <div className="rounded-lg bg-slate-50/80 px-3 py-2">
              <dt className="text-[11px] text-td-muted">{t.shell.account.titleAndRole}</dt>
              <dd className="mt-0.5 truncate font-semibold text-td-blue-dark">
                {profile.title || roleText}
                {profile.isGeneralManager ? ` · ${t.shell.account.generalManager}` : ''}
                {profile.isChairman ? ` · ${t.shell.account.chairman}` : ''}
              </dd>
            </div>
          </dl>

          {/* Custody Assets Section */}
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-td-blue-dark">
                {t.shell.account.custodyAssetsTitle} ({profile.custodyAssets.length})
              </span>
              {profile.custodyAssets.length > 0 && (
                <Link
                  href="/asset-transfers/new"
                  onClick={() => setOpen(false)}
                  className="text-[11px] font-semibold text-td-blue hover:underline"
                >
                  + {tr('資產異動申請單')}
                </Link>
              )}
            </div>

            {profile.custodyAssets.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-center text-xs text-td-muted">
                {t.shell.account.noCustodyAssets}
              </p>
            ) : (
              <ul className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {profile.custodyAssets.map((asset) => (
                  <li
                    key={asset.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-semibold text-td-blue-dark">{asset.name}</p>
                        <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700">
                          {tr(asset.statusLabel)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-td-muted">
                        <span className="font-mono text-slate-700">{asset.tag}</span>
                        {asset.location && <span>· {asset.location}</span>}
                      </div>
                    </div>
                    <CopyTagButton tag={asset.tag} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer: Logout */}
          <div className="flex items-center justify-between bg-slate-50/60 px-4 py-2.5">
            <Link
              href="/assets"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-td-muted hover:text-td-blue"
            >
              {t.shell.account.companyAssetShortcut}
            </Link>
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                {t.shell.account.logoutButton}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const TOOL_SUB_LINKS: RecordLink[] = [
  { label: '工具總覽', href: '/tools' },
  { label: 'PDF 編輯器', href: '/tools/pdf-editor' },
];

export function AppShell({
  profile,
  pendingApprovalCount,
  categories,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const { locale, t, tr } = useI18n();
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const showFinance = hasAnyPermission(profile.permissions, FINANCE_NAV_PERMISSIONS);
  const showAdmin = hasAnyPermission(profile.permissions, ADMIN_NAV_PERMISSIONS);

  if (pathname.startsWith('/tools/project-assistant/viewer')) {
    return <>{children}</>;
  }

  const activeSection = resolveActiveSection(pathname);

  const primaryItems: Array<{
    key: PrimaryNavKey;
    label: string;
    shortLabel: string;
    href: string;
    badge?: number;
    visible: boolean;
  }> = [
    {
      key: 'ai',
      label: tr('AI 助手'),
      shortLabel: locale === 'en' ? 'AI' : locale === 'ja' ? 'AI' : 'AI 助手',
      href: '/tools/ai-chat',
      visible: true,
    },
    {
      key: 'project',
      label: tr('專案助手'),
      shortLabel: locale === 'en' ? 'Project' : locale === 'ja' ? '案件AI' : '專案助手',
      href: '/tools/project-assistant',
      visible: true,
    },
    {
      key: 'approvals',
      label: tr('簽核管理'),
      shortLabel: locale === 'en' ? 'Approve' : locale === 'ja' ? '承認管理' : '簽核管理',
      href: '/applications',
      badge: pendingApprovalCount,
      visible: true,
    },
    {
      key: 'finance',
      label: tr('財會管理'),
      shortLabel: locale === 'en' ? 'Finance' : locale === 'ja' ? '財務会計' : '財會管理',
      href: '/case-tracking',
      visible: showFinance,
    },
    {
      key: 'admin',
      label: tr('系統管理'),
      shortLabel: locale === 'en' ? 'Admin' : locale === 'ja' ? 'システム' : '系統管理',
      href: '/admin/company',
      visible: showAdmin,
    },
    {
      key: 'tools',
      label: tr('工具區'),
      shortLabel: locale === 'en' ? 'Tools' : locale === 'ja' ? 'ツール' : '工具區',
      href: '/tools',
      visible: true,
    },
  ];

  // Determine whether this section has a second-level sidebar
  // Note: 'ai' and 'project' manage their own full-screen workspace & sidebars
  const hasSecondaryRail = activeSection !== 'ai' && activeSection !== 'project';

  function renderSecondaryContent() {
    switch (activeSection) {
      case 'approvals':
        return (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
                {tr('簽核與進度')}
              </p>
              <SecondaryNavLink
                href="/applications"
                label={tr('簽核管理')}
                badge={pendingApprovalCount}
                active={pathname === '/applications' || pathname === '/approvals'}
              />
              <SecondaryNavLink
                href="/applications/drafts"
                label={tr('我的草稿庫')}
                active={isUnder(pathname, '/applications/drafts')}
              />
            </div>

            {categories.map((cat) => (
              <div key={cat.id} className="space-y-1">
                <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
                  {t.shell.newPrefix}
                  {tr(cat.title)}
                </p>
                {cat.forms.map((f) => (
                  <SecondaryNavLink
                    key={f.href}
                    href={f.href}
                    label={tr(f.title)}
                    active={isUnder(pathname, f.href)}
                  />
                ))}
              </div>
            ))}
          </div>
        );

      case 'company':
        return (
          <div className="space-y-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
              {tr('公司資訊')}
            </p>
            {COMPANY_INFO_LINKS.map((l) => (
              <SecondaryNavLink
                key={l.href}
                href={l.href}
                label={tr(l.label)}
                active={isUnder(pathname, l.href)}
              />
            ))}
          </div>
        );

      case 'finance':
        return (
          <div className="space-y-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
              {tr('全公司財會與資產')}
            </p>
            {FINANCE_LINKS.map((l) => (
              <SecondaryNavLink
                key={l.href}
                href={l.href}
                label={tr(l.label)}
                active={isUnder(pathname, l.href)}
              />
            ))}
          </div>
        );

      case 'admin':
        return (
          <div className="space-y-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
              {tr('系統管理設定')}
            </p>
            {ADMIN_LINKS.map((l) => (
              <SecondaryNavLink
                key={l.href}
                href={l.href}
                label={tr(l.label)}
                active={isUnder(pathname, l.href)}
              />
            ))}
          </div>
        );

      case 'tools':
        return (
          <div className="space-y-1">
            <p className="px-2.5 text-[11px] font-semibold tracking-wider text-slate-400">
              {tr('實用工具箱')}
            </p>
            {TOOL_SUB_LINKS.map((l) => (
              <SecondaryNavLink
                key={l.href}
                href={l.href}
                label={tr(l.label)}
                active={pathname === l.href}
              />
            ))}
          </div>
        );

      default:
        return null;
    }
  }

  const activeSectionTitle =
    activeSection === 'company'
      ? tr('公司資訊')
      : (primaryItems.find((i) => i.key === activeSection)?.label ?? 'ACCSYS');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-td-surface print:block print:h-auto print:w-full print:overflow-visible print:bg-white">
      {/* Column 1: Far-left Icon Rail */}
      <aside
        aria-label="主導覽列"
        className="z-30 hidden w-16 shrink-0 flex-col items-center justify-between border-r border-slate-200/80 bg-[#f3f5f8] py-3 md:flex print:hidden"
      >
        {/* Top: Company Logo Icon (Entry for 公司資訊: 公司公告 / 公司規章 / 內部問卷) */}
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/announcements"
            onClick={() => setSecondaryCollapsed(false)}
            title={t.shell.companyInfoTooltip}
            className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5 transition hover:scale-105 ${
              activeSection === 'company'
                ? 'shadow-sm ring-2 ring-td-blue'
                : 'shadow-xs ring-1 ring-slate-200/90'
            }`}
          >
            <Image
              src={mark}
              alt="TURING DRIVE"
              className="h-full w-full object-contain"
              sizes="40px"
              loading="eager"
            />
          </Link>

          <div className="h-px w-8 bg-slate-200" />

          {/* Primary Module Icons */}
          <nav className="flex flex-col items-center gap-2">
            {primaryItems
              .filter((item) => item.visible)
              .map((item) => {
                const isActive = activeSection === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setSecondaryCollapsed(false)}
                    title={item.label}
                    className={`group relative flex flex-col items-center justify-center rounded-xl px-1.5 py-2 transition ${
                      isActive
                        ? 'bg-white text-td-blue shadow-xs ring-1 ring-slate-200/90'
                        : 'text-slate-600 hover:bg-white/70 hover:text-td-blue-dark'
                    }`}
                  >
                    <RailIcon name={item.key} />
                    <span className="mt-1 text-[10px] font-semibold leading-none tracking-tight">
                      {item.shortLabel}
                    </span>
                    {item.badge != null && item.badge > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white shadow-2xs">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
          </nav>
        </div>

        {/* Bottom: Language Switcher + Global Assistant Hover + Employee Account & Assets Trigger */}
        <div className="flex flex-col items-center gap-2.5">
          <LanguageSwitcher variant="rail" />
          <GlobalAssistant enabled />
          <EmployeeAccountPopover profile={profile} />
        </div>
      </aside>

      {/* Column 2: Second-level Sidebar (Codex style, shown for non-AI sections) */}
      {hasSecondaryRail && (
        <aside
          aria-label="次選單"
          className={`hidden shrink-0 flex-col border-r border-slate-200/80 bg-[#f8f9fb] transition-all duration-150 md:flex print:hidden ${
            secondaryCollapsed ? 'w-12' : 'w-60'
          }`}
        >
          {/* Top-left Brand Header inside Secondary Sidebar */}
          <div className="flex h-14 items-center justify-between border-b border-slate-200/70 px-3.5">
            {!secondaryCollapsed && (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs font-extrabold italic tracking-wide text-td-blue-dark">
                    TURING DRIVE
                  </span>
                  <span className="rounded bg-td-blue/10 px-1.5 py-0.5 text-[10px] font-bold text-td-blue">
                    ACCSYS
                  </span>
                </div>
                <p className="truncate text-[11px] font-semibold text-slate-500">
                  {activeSectionTitle}
                </p>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSecondaryCollapsed((v) => !v)}
              title={secondaryCollapsed ? t.shell.expandSubmenu : t.shell.collapseSubmenu}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-td-blue-dark"
            >
              {secondaryCollapsed ? '»' : '«'}
            </button>
          </div>

          {!secondaryCollapsed && (
            <div className="flex-1 overflow-y-auto px-2.5 py-3">
              {renderSecondaryContent()}
            </div>
          )}
        </aside>
      )}

      {/* Column 3: Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
        {/* Mobile Top Bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 md:hidden print:hidden">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-1.5 text-td-blue-dark"
              aria-label={t.common.openMenu}
            >
              ☰
            </button>
            <Link href="/announcements" className="flex items-center gap-2">
              <Image src={mark} alt="" className="h-6 w-6 object-contain" />
              <span className="text-sm font-bold text-td-blue-dark">
                TURING DRIVE · ACCSYS
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher variant="rail" />
            <EmployeeAccountPopover profile={profile} />
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <button
              type="button"
              className="flex-1 bg-black/30"
              onClick={() => setMobileMenuOpen(false)}
              aria-label={t.common.closeMenu}
            />
            <div className="flex h-full w-72 flex-col bg-white p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <Link
                  href="/announcements"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-2 font-bold text-td-blue-dark hover:text-td-blue"
                >
                  <Image src={mark} alt="" className="h-5 w-5 object-contain" />
                  <span>TURING DRIVE · ACCSYS</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm text-slate-500"
                >
                  ✕
                </button>
              </div>
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
                <span className="text-xs font-semibold text-td-muted">🌐 {t.common.language}</span>
                <LanguageSwitcher variant="row" />
              </div>
              <div className="space-y-1 border-b border-slate-100 pb-3">
                {primaryItems
                  .filter((i) => i.visible)
                  .map((item) => (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${
                        activeSection === item.key
                          ? 'bg-td-blue text-white'
                          : 'text-td-blue-dark hover:bg-slate-100'
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge != null && item.badge > 0 && (
                        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs text-td-blue-dark">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  ))}
              </div>
              <div
                className="mt-3 flex-1 overflow-y-auto"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a')) setMobileMenuOpen(false);
                }}
              >
                {renderSecondaryContent()}
              </div>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <div className="flex-1 overflow-y-auto print:overflow-visible">{children}</div>
      </div>
    </div>
  );
}

function SecondaryNavLink({
  href,
  label,
  badge,
  active,
  highlight,
}: {
  href: string;
  label: string;
  badge?: number;
  active?: boolean;
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${
        active
          ? 'bg-white font-semibold text-td-blue shadow-2xs ring-1 ring-slate-200/80'
          : highlight
            ? 'font-semibold text-td-blue hover:bg-white/80'
            : 'text-slate-700 hover:bg-white/70 hover:text-td-blue-dark'
      }`}
    >
      <span className="truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
          {badge}
        </span>
      )}
    </Link>
  );
}
