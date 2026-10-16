'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AccountsTabs({ showAccounts, showRoles }: { showAccounts: boolean; showRoles: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: '/admin/accounts', label: '帳號綁定', show: showAccounts },
    { href: '/admin/accounts/roles', label: '權限角色', show: showRoles },
  ].filter((t) => t.show);

  if (tabs.length < 2) return null;

  return (
    <nav aria-label="帳號與權限" className="flex flex-wrap gap-1 border-b border-td-border">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
              active ? 'border-td-blue text-td-blue-dark' : 'border-transparent text-td-muted hover:text-td-blue-dark'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
