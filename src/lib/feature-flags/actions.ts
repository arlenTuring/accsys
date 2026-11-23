'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import { getDb } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  type FeatureFlagKey,
  type FeatureFlagMap,
} from './definitions';
import {
  getDefaultStandardLicense,
  type VerifiedLicenseInfo,
  verifyLicenseKey,
} from './license';
import { getSystemLicenseState } from './service';

export type FeatureFlagActionResult =
  | {
      ok: true;
      flags: FeatureFlagMap;
      license: VerifiedLicenseInfo;
    }
  | { ok: false; error: string };

async function assertAdminPermission() {
  const employee = await getCurrentEmployee();
  if (
    !employee ||
    (employee.role !== 'admin' &&
      !hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS))
  ) {
    return null;
  }
  return employee;
}

/**
 * 驗證並套用系統授權碼（由授權碼嚴格決定哪些功能可開啟、哪些功能強制關閉，以及授權可用期限）
 */
export async function applySystemLicenseKey(input: {
  licenseKey: string;
}): Promise<FeatureFlagActionResult> {
  const employee = await assertAdminPermission();
  if (!employee) {
    return { ok: false, error: '僅限系統管理員可套用或變更系統授權碼' };
  }

  const verified = verifyLicenseKey(input.licenseKey);
  if (!verified.ok) {
    return { ok: false, error: verified.error };
  }

  const { license, flags } = verified;

  try {
    const db = getDb();
    await db.insert(auditEvents).values({
      actorType: 'employee',
      actorEmployeeId: employee.id,
      action: 'feature_flags.license_applied',
      entityType: 'system_feature_flags',
      entityId: null,
      details: {
        changedKey: 'LICENSE_KEY',
        changedTitle: `套用授權碼「${license.planName}」（有效期間：${license.startsAt} ～ ${license.expiresAt}，開放 ${license.licensedModules.length} / ${FEATURE_FLAG_DEFINITIONS.length} 項功能）`,
        planName: license.planName,
        issuedTo: license.issuedTo,
        startsAt: license.startsAt,
        expiresAt: license.expiresAt,
        licenseKey: license.licenseKey,
        licensedModules: license.licensedModules,
        enabled: null,
        actorName: `${employee.name}（${employee.employeeCode}）`,
        flags,
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: `儲存授權碼失敗：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/feature-flags');
  revalidatePath('/tools');
  revalidatePath('/tools/project-assistant');

  return { ok: true, flags, license };
}

/**
 * 在目前授權碼允許的範圍內切換單一功能開關。
 * 若該功能未包含在目前生效的授權碼中，嚴格拒絕開啟！
 */
export async function toggleSystemFeatureFlag(input: {
  key: FeatureFlagKey;
  enabled: boolean;
}): Promise<FeatureFlagActionResult> {
  const employee = await assertAdminPermission();
  if (!employee) {
    return { ok: false, error: '僅限系統管理員可調整系統功能開關' };
  }

  const def = FEATURE_FLAG_DEFINITIONS.find((d) => d.key === input.key);
  if (!def) {
    return { ok: false, error: '未知的功能開關項目' };
  }

  const { license, flags: currentFlags } = await getSystemLicenseState();
  const isLicensed = license.licensedModules.includes(input.key);

  if (input.enabled && !isLicensed) {
    return {
      ok: false,
      error: `「${def.title}」未包含在目前生效的授權碼（${license.planName}）中，嚴格禁止越權開啟！請透過本地授權簽發系統產生包含此功能的授權碼後再行套用。`,
    };
  }

  const nextFlags: FeatureFlagMap = {
    ...currentFlags,
    [input.key]: isLicensed ? Boolean(input.enabled) : false,
  };

  try {
    const db = getDb();
    await db.insert(auditEvents).values({
      actorType: 'employee',
      actorEmployeeId: employee.id,
      action: 'feature_flags.updated',
      entityType: 'system_feature_flags',
      entityId: null,
      details: {
        changedKey: input.key,
        changedTitle: def.title,
        enabled: Boolean(input.enabled),
        licenseKey: license.licenseKey,
        planName: license.planName,
        startsAt: license.startsAt,
        expiresAt: license.expiresAt,
        actorName: `${employee.name}（${employee.employeeCode}）`,
        flags: nextFlags,
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: `儲存功能開關失敗：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/feature-flags');
  revalidatePath('/tools');
  revalidatePath('/tools/project-assistant');

  return { ok: true, flags: nextFlags, license };
}

export async function resetSystemFeatureFlagsToDefault(): Promise<FeatureFlagActionResult> {
  const employee = await assertAdminPermission();
  if (!employee) {
    return { ok: false, error: '僅限系統管理員可調整系統功能開關' };
  }

  const defaultLicense = getDefaultStandardLicense();
  const nextFlags: FeatureFlagMap = { ...DEFAULT_FEATURE_FLAGS };

  try {
    const db = getDb();
    await db.insert(auditEvents).values({
      actorType: 'employee',
      actorEmployeeId: employee.id,
      action: 'feature_flags.reset_default',
      entityType: 'system_feature_flags',
      entityId: null,
      details: {
        changedKey: 'ALL_DEFAULT',
        changedTitle: `恢復預設標準授權碼（有效期間：${defaultLicense.startsAt} ～ ${defaultLicense.expiresAt}，專案助手關閉、其餘 10 項開啟）`,
        licenseKey: defaultLicense.licenseKey,
        planName: defaultLicense.planName,
        startsAt: defaultLicense.startsAt,
        expiresAt: defaultLicense.expiresAt,
        enabled: null,
        actorName: `${employee.name}（${employee.employeeCode}）`,
        flags: nextFlags,
      },
    });
  } catch (e) {
    return {
      ok: false,
      error: `恢復預設值失敗：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/admin/feature-flags');
  revalidatePath('/tools');
  revalidatePath('/tools/project-assistant');

  return { ok: true, flags: nextFlags, license: defaultLicense };
}
