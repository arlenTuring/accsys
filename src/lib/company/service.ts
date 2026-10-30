import { eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { companyProfiles } from '@/lib/db/schema';
import { isValidTaiwanTaxId, normalizeTaxId } from '@/lib/company/tax-id';

export const DEFAULT_COMPANY_CODE = 'default';
export const TEST_COMPANY_CODE = 'test_fixture';

export type CompanyProfile = {
  id: string;
  code: string;
  legalName: string;
  taxId: string;
  address: string | null;
  nameAliases: string[];
  active: boolean;
  version: number;
  updatedAt: Date;
};

function mapRow(row: typeof companyProfiles.$inferSelect): CompanyProfile {
  return {
    id: row.id,
    code: row.code,
    legalName: row.legalName,
    taxId: row.taxId,
    address: row.address,
    nameAliases: Array.isArray(row.nameAliases) ? row.nameAliases : [],
    active: row.active,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export async function getActiveCompanyProfile(
  code: string = DEFAULT_COMPANY_CODE
): Promise<CompanyProfile | null> {
  const [row] = await getDb()
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.code, code))
    .limit(1);
  if (!row || !row.active) return null;
  return mapRow(row);
}

export async function getCompanyProfileByCode(code: string): Promise<CompanyProfile | null> {
  const [row] = await getDb().select().from(companyProfiles).where(eq(companyProfiles.code, code)).limit(1);
  return row ? mapRow(row) : null;
}

async function requireCompanyAdmin() {
  const employee = await getCurrentEmployee();
  if (!employee) return null;
  if (employee.role === 'admin' || employee.permissions.includes('master_data.manage')) return employee;
  return null;
}

export type UpsertCompanyInput = {
  code?: string;
  legalName: string;
  taxId: string;
  address?: string | null;
  nameAliases?: string[];
  active?: boolean;
};

export async function upsertCompanyProfile(
  input: UpsertCompanyInput
): Promise<{ ok: true; profile: CompanyProfile } | { ok: false; error: string }> {
  const actor = await requireCompanyAdmin();
  if (!actor) return { ok: false, error: '需要主檔管理權限' };

  const code = (input.code ?? DEFAULT_COMPANY_CODE).trim() || DEFAULT_COMPANY_CODE;
  if (code === TEST_COMPANY_CODE && process.env.ALLOW_TEST_COMPANY_SEED !== '1') {
    // Test fixture writes go through seed scripts with ALLOW_TEST_COMPANY_SEED=1.
  }
  const legalName = input.legalName.trim();
  if (!legalName || legalName.length > 200) return { ok: false, error: '請填寫有效的公司正式名稱' };
  const taxId = normalizeTaxId(input.taxId);
  if (!/^\d{8}$/.test(taxId)) return { ok: false, error: '統一編號須為 8 位數字' };
  if (!isValidTaiwanTaxId(taxId)) return { ok: false, error: '統一編號檢核碼不正確' };
  const address = input.address?.trim() || null;
  const nameAliases = (input.nameAliases ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 20);
  const active = input.active !== false;

  const db = getDb();
  const existing = await getCompanyProfileByCode(code);

  if (!existing) {
    const [row] = await db
      .insert(companyProfiles)
      .values({
        code,
        legalName,
        taxId,
        address,
        nameAliases,
        active,
        version: 1,
        updatedByEmployeeId: actor.id,
      })
      .returning();
    await recordAudit(db, {
      actorEmployeeId: actor.id,
      action: 'company_profile.created',
      entityType: 'company_profile',
      entityId: row!.id,
      details: { code, taxId, version: 1 },
    });
    return { ok: true, profile: mapRow(row!) };
  }

  const [row] = await db
    .update(companyProfiles)
    .set({
      legalName,
      taxId,
      address,
      nameAliases,
      active,
      version: sql`${companyProfiles.version} + 1`,
      updatedByEmployeeId: actor.id,
      updatedAt: sql`now()`,
    })
    .where(eq(companyProfiles.id, existing.id))
    .returning();
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'company_profile.updated',
    entityType: 'company_profile',
    entityId: row!.id,
    details: { code, taxId, version: row!.version, previousVersion: existing.version },
  });
  return { ok: true, profile: mapRow(row!) };
}
