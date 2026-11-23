import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { auditEvents, employees } from '@/lib/db/schema';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAG_DEFINITIONS,
  type FeatureFlagKey,
  type FeatureFlagMap,
} from './definitions';
import {
  deriveLicensedFlags,
  getDefaultStandardLicense,
  type VerifiedLicenseInfo,
  verifyLicenseKey,
} from './license';

export type FeatureFlagAuditItem = {
  id: string;
  occurredAt: string;
  actorName: string;
  actionType: 'LICENSE_APPLIED' | 'FLAG_TOGGLED' | 'RESET_DEFAULT';
  changedKey: FeatureFlagKey | 'ALL_DEFAULT' | 'LICENSE_KEY';
  changedTitle: string;
  enabled: boolean | null;
  planName?: string;
};

export type SystemLicenseState = {
  license: VerifiedLicenseInfo;
  flags: FeatureFlagMap;
};

export async function getSystemLicenseState(): Promise<SystemLicenseState> {
  const defaultLicense = getDefaultStandardLicense();
  try {
    const db = getDb();
    const rows = await db
      .select({
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(eq(auditEvents.entityType, 'system_feature_flags'))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(1);

    const latest = rows[0]?.details as
      | {
          licenseKey?: string;
          flags?: Partial<Record<FeatureFlagKey, boolean>>;
        }
      | undefined;

    const verifiedLatest = latest?.licenseKey
      ? verifyLicenseKey(latest.licenseKey)
      : null;

    if (!verifiedLatest || !verifiedLatest.ok) {
      await db.insert(auditEvents).values({
        actorType: 'system',
        actorEmployeeId: null,
        entityType: 'system_feature_flags',
        entityId: null,
        action: 'feature_flags.license_applied',
        details: {
          changedKey: 'LICENSE_KEY',
          changedTitle: `套用永久授權碼（有效期間：${defaultLicense.startsAt} ～ 永久有效，開通 ${defaultLicense.licensedModules.length} / ${FEATURE_FLAG_DEFINITIONS.length} 項模組）`,
          enabled: true,
          actorName: 'ACCSYS_LICENSE 授權中心',
          planName: defaultLicense.planName,
          startsAt: defaultLicense.startsAt,
          expiresAt: defaultLicense.expiresAt,
          licenseKey: defaultLicense.licenseKey,
          flags: latest?.flags
            ? deriveLicensedFlags(defaultLicense, latest.flags)
            : { ...DEFAULT_FEATURE_FLAGS },
        },
      });
      return {
        license: defaultLicense,
        flags: latest?.flags
          ? deriveLicensedFlags(defaultLicense, latest.flags)
          : { ...DEFAULT_FEATURE_FLAGS },
      };
    }

    const flags = deriveLicensedFlags(verifiedLatest.license, latest?.flags);
    return {
      license: verifiedLatest.license,
      flags,
    };
  } catch {
    // Fallback to default standard license if DB is unreachable
  }

  return {
    license: defaultLicense,
    flags: { ...DEFAULT_FEATURE_FLAGS },
  };
}

export async function getSystemFeatureFlags(): Promise<FeatureFlagMap> {
  const state = await getSystemLicenseState();
  return state.flags;
}

export async function getFeatureFlagHistory(
  limit = 15
): Promise<FeatureFlagAuditItem[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        occurredAt: auditEvents.occurredAt,
        actorEmployeeId: auditEvents.actorEmployeeId,
        details: auditEvents.details,
      })
      .from(auditEvents)
      .where(eq(auditEvents.entityType, 'system_feature_flags'))
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(limit);

    if (rows.length === 0) return [];

    const empRows = await db
      .select({
        id: employees.id,
        name: employees.name,
        code: employees.employeeCode,
      })
      .from(employees);
    const empMap = new Map(empRows.map((e) => [e.id, `${e.name}（${e.code}）`]));
    const defMap = new Map(
      FEATURE_FLAG_DEFINITIONS.map((d) => [d.key, d.title])
    );

    return rows.map((r) => {
      const meta = (r.details ?? {}) as {
        changedKey?: FeatureFlagKey | 'ALL_DEFAULT' | 'LICENSE_KEY';
        changedTitle?: string;
        enabled?: boolean | null;
        actorName?: string;
        planName?: string;
      };
      const changedKey = meta.changedKey ?? 'ALL_DEFAULT';
      const actionType: FeatureFlagAuditItem['actionType'] =
        r.action === 'feature_flags.license_applied' ||
        changedKey === 'LICENSE_KEY'
          ? 'LICENSE_APPLIED'
          : r.action === 'feature_flags.reset_default' ||
              changedKey === 'ALL_DEFAULT'
            ? 'RESET_DEFAULT'
            : 'FLAG_TOGGLED';

      const changedTitle =
        meta.changedTitle ??
        (changedKey === 'LICENSE_KEY'
          ? `套用授權碼：${meta.planName ?? '企業授權方案'}`
          : changedKey === 'ALL_DEFAULT'
            ? '恢復全部功能為系統預設授權（專案助手關閉、其餘開啟）'
            : (defMap.get(changedKey) ?? changedKey));

      return {
        id: String(r.id),
        occurredAt: r.occurredAt.toISOString(),
        actorName:
          meta.actorName ??
          (r.actorEmployeeId ? empMap.get(r.actorEmployeeId) : null) ??
          '系統管理員',
        actionType,
        changedKey,
        changedTitle,
        enabled: typeof meta.enabled === 'boolean' ? meta.enabled : null,
        planName: meta.planName,
      };
    });
  } catch {
    return [];
  }
}
