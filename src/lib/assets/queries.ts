import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AssetStatus } from '@/lib/asset-transfers/constants';
import { actorHas } from '@/lib/authz/access';
import { canMaintainRegister } from '@/lib/assets/service';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import {
  assetFieldDefinitions,
  assetInventoryLines,
  assets,
  departments,
  employees,
} from '@/lib/db/schema';

export type InventoryConfirmStage = 'unconfirmed' | 'custodian_confirmed' | 'reviewer_confirmed';

export type RegisterRow = {
  id: string;
  /** 3. 財產編號 */
  tag: string;
  /** 7. 設備或生財器具名稱 */
  name: string;
  /** 9. 帳載數量 */
  quantity: number;
  /** 13. 保管人 */
  custodianEmployeeId: string;
  custodianName: string;
  custodianDepartment: string;
  /** 12. 保管部門 */
  custodyDepartmentId: string | null;
  custodyDepartmentName: string | null;
  /** 14. 保管地點 */
  location: string;
  /** 2. 狀態 */
  status: AssetStatus;
  /** 16. 備註 */
  remark: string | null;
  /** 6. 項目種類 */
  itemKind: string | null;
  /** 8. 說明 */
  description: string | null;
  /** 11. 單位 */
  unit: string | null;
  /** 1. 會計科目 */
  accountingSubject: string;
  /** 4. 取得時間 */
  acquiredOn: string;
  /** 5. 傳票編號 */
  voucherNo: string;
  /** 15. 專案 */
  projectLabel: string;
  /** 17. 已貼財編 (V/X/'') */
  tagAffixed: string;
  /** 18. 已處分傳票編號 */
  disposalVoucherNo: string;
  /** 19. 異動需求 */
  changeRequest: string;
  /** 10. 實盤數量 */
  physicalQuantity: number | null;
  /** 20. 帳務是否與實際財產相符(V/X) */
  invMatchesBooks: string;
  /** 21. 是否已閒置且已無使用需要可出售或移轉(V/X) */
  invIdleDisposable: string;
  /** 22. 是否已不堪使用需報廢(V/X) */
  invUnusableScrap: string;
  /** 23. 請註記如何處理(例如:捐贈、出售等) */
  invDispositionNote: string;
  /** 第 35 條：盤點雙階確認（待確認人確認時間與狀態 → 檢核人再確認） */
  inventoryConfirmStage: InventoryConfirmStage;
  custodianConfirmedAt: string | null;
  custodianConfirmedById: string | null;
  custodianConfirmedByName: string | null;
  custodianConfirmedStatus: AssetStatus | null;
  reviewerConfirmedAt: string | null;
  reviewerConfirmedById: string | null;
  reviewerConfirmedByName: string | null;
  reviewerNote: string | null;
  updatedAt: Date;
};

function readStr(
  extra: Record<string, unknown>,
  invAnswers: Record<string, unknown>,
  stableKey: string,
  defIdByKey: Map<string, string>
): string {
  const defId = defIdByKey.get(stableKey);
  const raw =
    extra[stableKey] ??
    (defId ? extra[defId] : undefined) ??
    invAnswers[stableKey] ??
    (defId ? invAnswers[defId] : undefined);
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'boolean') return raw ? 'V' : 'X';
  const s = String(raw).trim();
  if (s === 'true' || s === 'yes') return 'V';
  if (s === 'false' || s === 'no') return 'X';
  return s;
}

function readIntOrNull(
  extra: Record<string, unknown>,
  invPhysicalQty: number | null | undefined,
  stableKey: string,
  defIdByKey: Map<string, string>
): number | null {
  if (typeof invPhysicalQty === 'number' && Number.isFinite(invPhysicalQty)) {
    return invPhysicalQty;
  }
  const defId = defIdByKey.get(stableKey);
  const raw = extra[stableKey] ?? (defId ? extra[defId] : undefined);
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function queryFullRegisterRows(whereClause?: ReturnType<typeof and>): Promise<RegisterRow[]> {
  const db = getDb();
  const custodyDept = alias(departments, 'register_custody_dept');

  const [rows, fieldDefs, invLines] = await Promise.all([
    db
      .select({
        id: assets.id,
        tag: assets.tag,
        name: assets.name,
        quantity: assets.quantity,
        custodianEmployeeId: assets.custodianEmployeeId,
        custodianName: employees.name,
        custodianDepartment: departments.name,
        custodyDepartmentId: assets.custodyDepartmentId,
        custodyDepartmentName: custodyDept.name,
        location: assets.location,
        status: assets.status,
        remark: assets.remark,
        itemKind: assets.itemKind,
        description: assets.description,
        unit: assets.unit,
        extraValues: assets.extraValues,
        updatedAt: assets.updatedAt,
      })
      .from(assets)
      .innerJoin(employees, eq(employees.id, assets.custodianEmployeeId))
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(custodyDept, eq(custodyDept.id, assets.custodyDepartmentId))
      .where(whereClause)
      .orderBy(asc(assets.tag)),
    db
      .select({ id: assetFieldDefinitions.id, stableKey: assetFieldDefinitions.stableKey })
      .from(assetFieldDefinitions),
    db
      .select({
        assetId: assetInventoryLines.assetId,
        assetTag: assetInventoryLines.assetTag,
        physicalQuantity: assetInventoryLines.physicalQuantity,
        answers: assetInventoryLines.answers,
        updatedAt: assetInventoryLines.updatedAt,
      })
      .from(assetInventoryLines)
      .orderBy(desc(assetInventoryLines.updatedAt)),
  ]);

  const defIdByKey = new Map(fieldDefs.map((f) => [f.stableKey, f.id]));
  const latestInvByAssetId = new Map<
    string,
    { physicalQuantity: number | null; answers: Record<string, unknown> }
  >();
  const latestInvByTag = new Map<
    string,
    { physicalQuantity: number | null; answers: Record<string, unknown> }
  >();

  for (const line of invLines) {
    const entry = {
      physicalQuantity: line.physicalQuantity,
      answers: (line.answers ?? {}) as Record<string, unknown>,
    };
    if (line.assetId && !latestInvByAssetId.has(line.assetId)) {
      latestInvByAssetId.set(line.assetId, entry);
    }
    if (line.assetTag && !latestInvByTag.has(line.assetTag)) {
      latestInvByTag.set(line.assetTag, entry);
    }
  }

  return rows.map((r) => {
    const extra = (r.extraValues ?? {}) as Record<string, unknown>;
    const inv = latestInvByAssetId.get(r.id) ?? latestInvByTag.get(r.tag);
    const invAnswers = inv?.answers ?? {};

    const custodianConfirmedAt =
      typeof extra.custodian_confirmed_at === 'string' && extra.custodian_confirmed_at
        ? extra.custodian_confirmed_at
        : null;
    const custodianConfirmedById =
      typeof extra.custodian_confirmed_by_id === 'string' && extra.custodian_confirmed_by_id
        ? extra.custodian_confirmed_by_id
        : null;
    const custodianConfirmedByName =
      typeof extra.custodian_confirmed_by_name === 'string' && extra.custodian_confirmed_by_name
        ? extra.custodian_confirmed_by_name
        : null;
    const custodianConfirmedStatus =
      typeof extra.custodian_confirmed_status === 'string' && extra.custodian_confirmed_status
        ? (extra.custodian_confirmed_status as AssetStatus)
        : null;

    const reviewerConfirmedAt =
      typeof extra.reviewer_confirmed_at === 'string' && extra.reviewer_confirmed_at
        ? extra.reviewer_confirmed_at
        : null;
    const reviewerConfirmedById =
      typeof extra.reviewer_confirmed_by_id === 'string' && extra.reviewer_confirmed_by_id
        ? extra.reviewer_confirmed_by_id
        : null;
    const reviewerConfirmedByName =
      typeof extra.reviewer_confirmed_by_name === 'string' && extra.reviewer_confirmed_by_name
        ? extra.reviewer_confirmed_by_name
        : null;
    const reviewerNote =
      typeof extra.reviewer_note === 'string' && extra.reviewer_note ? extra.reviewer_note : null;

    let inventoryConfirmStage: InventoryConfirmStage = 'unconfirmed';
    if (custodianConfirmedAt && reviewerConfirmedAt) {
      inventoryConfirmStage = 'reviewer_confirmed';
    } else if (custodianConfirmedAt) {
      inventoryConfirmStage = 'custodian_confirmed';
    }

    return {
      id: r.id,
      tag: r.tag,
      name: r.name,
      quantity: r.quantity,
      custodianEmployeeId: r.custodianEmployeeId,
      custodianName: r.custodianName,
      custodianDepartment: r.custodianDepartment,
      custodyDepartmentId: r.custodyDepartmentId,
      custodyDepartmentName: r.custodyDepartmentName ?? r.custodianDepartment,
      location: r.location,
      status: r.status as AssetStatus,
      remark: r.remark,
      itemKind: r.itemKind ?? (readStr(extra, invAnswers, 'item_kind', defIdByKey) || null),
      description: r.description ?? (readStr(extra, invAnswers, 'description', defIdByKey) || null),
      unit: r.unit ?? (readStr(extra, invAnswers, 'unit', defIdByKey) || null),
      accountingSubject: readStr(extra, invAnswers, 'accounting_subject', defIdByKey),
      acquiredOn: readStr(extra, invAnswers, 'acquired_on', defIdByKey),
      voucherNo: readStr(extra, invAnswers, 'voucher_no', defIdByKey),
      projectLabel: readStr(extra, invAnswers, 'project_label', defIdByKey),
      tagAffixed: readStr(extra, invAnswers, 'tag_affixed', defIdByKey),
      disposalVoucherNo: readStr(extra, invAnswers, 'disposal_voucher_no', defIdByKey),
      changeRequest: readStr(extra, invAnswers, 'change_request', defIdByKey),
      physicalQuantity: readIntOrNull(extra, inv?.physicalQuantity, 'physical_quantity', defIdByKey),
      invMatchesBooks: readStr(extra, invAnswers, 'inv_matches_books', defIdByKey),
      invIdleDisposable: readStr(extra, invAnswers, 'inv_idle_disposable', defIdByKey),
      invUnusableScrap: readStr(extra, invAnswers, 'inv_unusable_scrap', defIdByKey),
      invDispositionNote: readStr(extra, invAnswers, 'inv_disposition_note', defIdByKey),
      inventoryConfirmStage,
      custodianConfirmedAt,
      custodianConfirmedById,
      custodianConfirmedByName,
      custodianConfirmedStatus,
      reviewerConfirmedAt,
      reviewerConfirmedById,
      reviewerConfirmedByName,
      reviewerNote,
      updatedAt: r.updatedAt,
    };
  });
}

/** The whole register, including assets that have left it (finance / admin only). */
export async function getAssetRegister(): Promise<RegisterRow[]> {
  if (!canMaintainRegister(await getCurrentEmployee())) return [];
  return queryFullRegisterRows();
}

/**
 * Scoped register for `/assets/mine` and `/api/assets/export`:
 * - `mine`: assets where current employee is custodian
 * - `department`: assets in departments managed by current employee (or own custody)
 * - `company`: all company assets (requires finance/admin or assets.company_view)
 */
export async function getScopedAssetRegister(opts?: {
  scope?: 'mine' | 'department' | 'company';
}): Promise<{
  rows: RegisterRow[];
  scope: 'mine' | 'department' | 'company';
  canReviewInventory: boolean;
  canViewDepartment: boolean;
  canViewCompany: boolean;
}> {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      rows: [],
      scope: 'mine',
      canReviewInventory: false,
      canViewDepartment: false,
      canViewCompany: false,
    };
  }

  const db = getDb();
  const managedDepts = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.managerEmployeeId, employee.id), eq(departments.active, true)));
  const managedIds = managedDepts.map((d) => d.id);

  const canViewCompany =
    canMaintainRegister(employee) ||
    (await actorHas(employee, 'assets.company_view')) ||
    (await actorHas(employee, 'finance.assets'));
  const canReviewInventory = canMaintainRegister(employee) || (await actorHas(employee, 'finance.assets'));
  const canViewDepartment = managedIds.length > 0 || canViewCompany;

  let scope: 'mine' | 'department' | 'company' = opts?.scope ?? 'mine';
  if (scope === 'company' && !canViewCompany) scope = 'mine';
  if (scope === 'department' && !canViewDepartment) scope = 'mine';

  let whereClause: ReturnType<typeof and> | undefined;
  if (scope === 'mine') {
    whereClause = and(eq(assets.custodianEmployeeId, employee.id));
  } else if (scope === 'department') {
    if (managedIds.length > 0) {
      whereClause = and(
        or(
          eq(assets.custodianEmployeeId, employee.id),
          inArray(assets.custodyDepartmentId, managedIds),
          inArray(employees.departmentId, managedIds)
        )
      );
    } else if (!canViewCompany) {
      whereClause = and(eq(assets.custodianEmployeeId, employee.id));
    }
  }

  const rows = await queryFullRegisterRows(whereClause);
  return {
    rows,
    scope,
    canReviewInventory,
    canViewDepartment,
    canViewCompany,
  };
}
