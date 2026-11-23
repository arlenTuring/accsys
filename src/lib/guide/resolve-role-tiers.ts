import type { CurrentEmployee } from '@/lib/auth/current-employee';
import { hasAnyPermission, type Permission } from '@/lib/authz/permissions';
import type { GuideRoleTier } from '@/components/guide/guide-data';

const CORE_ADMIN_PERMISSIONS: readonly Permission[] = [
  'org.manage',
  'org.directory',
  'org.access_roles',
  'accounts.manage',
  'master_data.manage',
  'forms.design',
  'forms.delete',
  'company.announcements',
  'company.regulations',
  'company.surveys',
  'audit.read',
];

const CORE_FINANCE_PERMISSIONS: readonly Permission[] = [
  'finance.budget',
  'finance.assets',
  'finance.inventory',
  'assets.company_view',
];

export function resolveGuideRoleTiers(employee: CurrentEmployee): {
  allowedTiers: GuideRoleTier[];
  highestTier: GuideRoleTier;
  currentRoleLabel: string;
} {
  const isAdmin =
    employee.role === 'admin' ||
    hasAnyPermission(employee.permissions, CORE_ADMIN_PERMISSIONS);

  const isFinance =
    isAdmin ||
    employee.role === 'finance' ||
    hasAnyPermission(employee.permissions, CORE_FINANCE_PERMISSIONS);

  if (isAdmin) {
    return {
      allowedTiers: ['staff', 'finance', 'admin'],
      highestTier: 'admin',
      currentRoleLabel: '系統管理員',
    };
  }

  if (isFinance) {
    return {
      allowedTiers: ['staff', 'finance'],
      highestTier: 'finance',
      currentRoleLabel: '財會人員',
    };
  }

  return {
    allowedTiers: ['staff'],
    highestTier: 'staff',
    currentRoleLabel: '一般使用者',
  };
}
