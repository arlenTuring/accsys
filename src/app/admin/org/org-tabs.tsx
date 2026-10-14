'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin/org', label: '部門' },
  { href: '/admin/org/levels', label: '組織層級' },
  { href: '/admin/org/roles', label: '職務類別' },
  { href: '/admin/org/groups', label: '員工群組' },
  { href: '/admin/org/delegations', label: '代理人' },
  { href: '/admin/org/simulator', label: '流程模擬' },
  { href: '/admin/org/directory', label: '人員同步' },
];

export function OrgTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="組織設定" className="flex flex-wrap gap-1 border-b border-td-border">
      {TABS.map((t) => {
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
