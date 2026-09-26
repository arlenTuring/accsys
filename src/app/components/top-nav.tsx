'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '@/app/components/brand-logo';
import { UserMenu } from '@/app/components/user-menu';
import type { CurrentEmployee } from '@/lib/auth/current-employee';

type TopNavProps = {
  employee: CurrentEmployee;
  pendingApprovalCount?: number;
};

function NavItem({
  href,
  label,
  badge,
}: {
  href: string;
  label: string;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} className={active ? 'nav-link-active nav-link' : 'nav-link'}>
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-1.5 rounded-full bg-td-apex px-1.5 py-0.5 text-[10px] font-bold text-td-blue-dark">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function TopNav({ employee, pendingApprovalCount = 0 }: TopNavProps) {
  const showFinance = employee.role === 'finance' || employee.role === 'admin';
  const isApplicantView = employee.role === 'staff' && !employee.isGeneralManager;

  return (
    <header className="sticky top-0 z-40 border-b border-td-blue-dark/10 bg-td-blue-dark shadow-nav">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandLogo variant="light" href="/dashboard" />

        <nav className="hidden items-center gap-1 md:flex">
          <NavItem href="/dashboard" label="工作台" />
          <NavItem href="/approvals" label="待簽核" badge={pendingApprovalCount} />
          {isApplicantView ? (
            <>
              <NavItem href="/requests" label="我的請購" />
              <NavItem href="/purchase-orders" label="我的採購" />
            </>
          ) : (
            <NavItem href="/requests" label="我的案件" />
          )}
          {showFinance && <NavItem href="/case-tracking" label="簽核追蹤" />}
          {showFinance && <NavItem href="/budget-codes" label="預算管理" />}
          {employee.role === 'admin' && <NavItem href="/admin/master-data" label="主檔" />}
          {employee.role === 'admin' && <NavItem href="/admin/accounts" label="帳號" />}
          <NavItem href="/tools" label="工具區" />
        </nav>

        <div className="ml-auto">
          <UserMenu employee={employee} />
        </div>
      </div>
    </header>
  );
}
