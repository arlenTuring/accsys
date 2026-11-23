import { eq, inArray, sql } from 'drizzle-orm';
import { ASSET_STATUSES, MAX_LOCATION_LENGTH, type AssetStatus } from '@/lib/asset-transfers/constants';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { busyAssetTag } from '@/lib/custom-forms/asset-register';
import { assetFieldDefinitions, assets, departments, employees } from '@/lib/db/schema';
import { abort, fail, runInTransaction, type Failure, type Tx } from '@/lib/workflow/tx';

// Finance / admin maintain the register (財產保管清冊) directly; transfers
// change it through approved 資產異動申請單.

export type RegisterActor = {
  id: string;
  role: string;
  name?: string;
  permissions?: readonly string[] | null;
} | null;

export type AssetInput = {
  /** Optional asset UUID when editing an existing row (allows renaming tag / 財產編號). */
  id?: string;
  tag: string;
  name: string;
  quantity: number;
  custodianEmployeeId: string;
  location: string;
  /** null keeps the current status (保管中 for a new asset). */
  status: AssetStatus | null;
  remark: string | null;
  /** Optional Excel 23-column fields (第 33 條) */
  itemKind?: string | null;
  description?: string | null;
  unit?: string | null;
  custodyDepartmentId?: string | null;
  accountingSubject?: string | null;
  acquiredOn?: string | null;
  voucherNo?: string | null;
  projectLabel?: string | null;
  tagAffixed?: string | null;
  disposalVoucherNo?: string | null;
  changeRequest?: string | null;
  physicalQuantity?: number | null;
  invMatchesBooks?: string | null;
  invIdleDisposable?: string | null;
  invUnusableScrap?: string | null;
  invDispositionNote?: string | null;
};

export type UpsertAssetResult = { ok: true; assetId: string; created: boolean } | Failure;

export function canMaintainRegister(actor: RegisterActor): boolean {
  if (!actor) return false;
  if (actor.role === 'finance' || actor.role === 'admin') return true;
  if (actor.permissions) {
    return (
      actor.permissions.includes('finance.assets') ||
      actor.permissions.includes('finance.inventory')
    );
  }
  return false;
}

export function canActAsPropertyInspector(actor: RegisterActor): boolean {
  return canMaintainRegister(actor);
}

/** Validation without the database; returns the cleaned input or an error message. */
export function cleanAssetInput(input: AssetInput): { ok: true; value: AssetInput } | { ok: false; error: string } {
  const tag = String(input?.tag ?? '').trim();
  const name = String(input?.name ?? '').trim();
  const location = String(input?.location ?? '').trim();
  const remark = String(input?.remark ?? '').trim();
  if (tag === '') return { ok: false, error: '請填寫財產編號' };
  if (tag.length > 50) return { ok: false, error: '財產編號不可超過 50 字' };
  if (name === '') return { ok: false, error: '請填寫財產名稱' };
  if (name.length > 200) return { ok: false, error: '財產名稱不可超過 200 字' };
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return { ok: false, error: '數量需為正整數' };
  if (!isUuid(input.custodianEmployeeId)) return { ok: false, error: '請選擇保管人' };
  if (location.length > MAX_LOCATION_LENGTH) return { ok: false, error: `保管地點不可超過 ${MAX_LOCATION_LENGTH} 字` };
  if (input.status !== null && !(ASSET_STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: '狀態不正確' };
  if (remark.length > 1000) return { ok: false, error: '備註不可超過 1000 字' };
  return {
    ok: true,
    value: {
      ...input,
      tag,
      name,
      location,
      remark: remark || null,
      itemKind: input.itemKind !== undefined ? String(input.itemKind ?? '').trim() || null : undefined,
      description: input.description !== undefined ? String(input.description ?? '').trim() || null : undefined,
      unit: input.unit !== undefined ? String(input.unit ?? '').trim() || null : undefined,
      custodyDepartmentId:
        input.custodyDepartmentId !== undefined
          ? String(input.custodyDepartmentId ?? '').trim() || null
          : undefined,
    },
  };
}

const EXTRA_FIELD_MAPPING: Array<{ prop: keyof AssetInput; stableKey: string }> = [
  { prop: 'accountingSubject', stableKey: 'accounting_subject' },
  { prop: 'acquiredOn', stableKey: 'acquired_on' },
  { prop: 'voucherNo', stableKey: 'voucher_no' },
  { prop: 'projectLabel', stableKey: 'project_label' },
  { prop: 'tagAffixed', stableKey: 'tag_affixed' },
  { prop: 'disposalVoucherNo', stableKey: 'disposal_voucher_no' },
  { prop: 'changeRequest', stableKey: 'change_request' },
  { prop: 'physicalQuantity', stableKey: 'physical_quantity' },
  { prop: 'invMatchesBooks', stableKey: 'inv_matches_books' },
  { prop: 'invIdleDisposable', stableKey: 'inv_idle_disposable' },
  { prop: 'invUnusableScrap', stableKey: 'inv_unusable_scrap' },
  { prop: 'invDispositionNote', stableKey: 'inv_disposition_note' },
];

async function upsertInTx(tx: Tx, actorId: string, input: AssetInput): Promise<{ assetId: string; created: boolean }> {
  const cleaned = cleanAssetInput(input);
  if (!cleaned.ok) abort('validation', cleaned.error);
  const value = (cleaned as { ok: true; value: AssetInput }).value;
  const [custodian] = await tx
    .select({ id: employees.id, accessEnabled: employees.accessEnabled, departmentId: employees.departmentId })
    .from(employees)
    .where(eq(employees.id, value.custodianEmployeeId));
  if (!custodian) abort('validation', '選取的保管人無效');

  let existing: typeof assets.$inferSelect | undefined;
  if (value.id) {
    if (!isUuid(value.id)) abort('validation', '財產識別碼不正確');
    const [byId] = await tx.select().from(assets).where(eq(assets.id, value.id)).for('update');
    if (!byId) abort('validation', '找不到要修改的財產');
    if (byId.tag !== value.tag) {
      const [conflict] = await tx.select({ id: assets.id }).from(assets).where(eq(assets.tag, value.tag)).limit(1);
      if (conflict && conflict.id !== byId.id) {
        abort('validation', `財產編號「${value.tag}」已存在，請使用其他編號`);
      }
    }
    existing = byId;
  } else {
    const [byTag] = await tx.select().from(assets).where(eq(assets.tag, value.tag)).for('update');
    existing = byTag;
  }

  const custodianChanges = !existing || existing.custodianEmployeeId !== value.custodianEmployeeId;
  // A departed custodian may stay on a row that already names them; nothing new is assigned to them.
  if (custodianChanges && !custodian!.accessEnabled) abort('validation', '保管人帳號已停用，無法指派為保管人');
  if (existing && custodianChanges && (await busyAssetTag(tx, [existing.id], {}))) {
    abort('conflict', `財產 ${existing.tag} 有簽核中的資產異動申請單，請等該單完成後再修改保管人`);
  }

  let custodyDeptId = existing?.custodyDepartmentId ?? custodian.departmentId;
  if (value.custodyDepartmentId !== undefined) {
    if (value.custodyDepartmentId === null) {
      custodyDeptId = custodian.departmentId;
    } else {
      if (!isUuid(value.custodyDepartmentId)) abort('validation', '保管部門識別碼不正確');
      const [dept] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, value.custodyDepartmentId));
      if (!dept) abort('validation', '選取的保管部門不存在');
      custodyDeptId = dept.id;
    }
  }

  const fieldDefs = await tx
    .select({ id: assetFieldDefinitions.id, stableKey: assetFieldDefinitions.stableKey })
    .from(assetFieldDefinitions);
  const defIdByKey = new Map(fieldDefs.map((f) => [f.stableKey, f.id]));

  const nextExtra: Record<string, unknown> = {
    ...((existing?.extraValues ?? {}) as Record<string, unknown>),
  };
  for (const { prop, stableKey } of EXTRA_FIELD_MAPPING) {
    const rawVal = value[prop];
    if (rawVal === undefined) continue;
    const defId = defIdByKey.get(stableKey);
    if (rawVal === null || rawVal === '') {
      delete nextExtra[stableKey];
      if (defId) delete nextExtra[defId];
    } else {
      const normalized = typeof rawVal === 'number' ? rawVal : String(rawVal).trim();
      nextExtra[stableKey] = normalized;
      if (defId) nextExtra[defId] = normalized;
    }
  }

  const columns = {
    tag: value.tag,
    name: value.name,
    quantity: value.quantity,
    custodianEmployeeId: value.custodianEmployeeId,
    custodyDepartmentId: custodyDeptId,
    location: value.location,
    remark: value.remark,
    itemKind: value.itemKind !== undefined ? value.itemKind : existing?.itemKind ?? null,
    description: value.description !== undefined ? value.description : existing?.description ?? null,
    unit: value.unit !== undefined ? value.unit : existing?.unit ?? null,
    extraValues: nextExtra,
  };
  let assetId: string;
  if (existing) {
    await tx
      .update(assets)
      .set({ ...columns, status: value.status ?? existing.status, updatedAt: sql`now()` })
      .where(eq(assets.id, existing.id));
    assetId = existing.id;
  } else {
    const [row] = await tx
      .insert(assets)
      .values({ ...columns, status: value.status ?? 'in_custody' })
      .returning({ id: assets.id });
    assetId = row.id;
  }
  await recordAudit(tx, {
    actorEmployeeId: actorId,
    action: existing ? 'asset.updated' : 'asset.created',
    entityType: 'asset',
    entityId: assetId,
    details: {
      tag: value.tag,
      before: existing
        ? {
            tag: existing.tag,
            name: existing.name,
            quantity: existing.quantity,
            custodian: existing.custodianEmployeeId,
            location: existing.location,
            status: existing.status,
          }
        : undefined,
      after: {
        tag: value.tag,
        name: value.name,
        quantity: value.quantity,
        custodianEmployeeId: value.custodianEmployeeId,
        location: value.location,
        remark: value.remark,
        status: value.status ?? existing?.status ?? 'in_custody',
      },
    },
  });
  return { assetId, created: !existing };
}

export function upsertAsset(actor: RegisterActor, input: AssetInput): Promise<UpsertAssetResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  if (!canMaintainRegister(actor)) return Promise.resolve(fail('forbidden', '只有財會或管理員可以維護財產清冊'));
  return runInTransaction('asset.upsert', async (tx) => ({ ok: true as const, ...(await upsertInTx(tx, actor.id, input)) }));
}

export type CustodianConfirmInput = {
  assetIds: string[];
  confirmedStatus: AssetStatus;
  physicalQuantity?: number | null;
  invMatchesBooks?: string | null;
  invIdleDisposable?: string | null;
  invUnusableScrap?: string | null;
  invDispositionNote?: string | null;
};

/**
 * 第 35 條（第一階段）：待確認人（保管人）確認時記錄確認時間與財產狀態。
 * 完成後狀態進入 `custodian_confirmed`，等候檢核人再確認。
 */
export async function confirmAssetsByCustodian(
  actor: RegisterActor,
  input: CustodianConfirmInput
): Promise<{ ok: true; confirmedCount: number; confirmedAt: string } | Failure> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  const assetIds = [...new Set((input.assetIds ?? []).filter(isUuid))];
  if (assetIds.length === 0) return fail('validation', '請至少勾選一筆要確認的財產');
  if (!(ASSET_STATUSES as readonly string[]).includes(input.confirmedStatus)) {
    return fail('validation', '請選擇正確的財產狀態');
  }

  return runInTransaction('asset.custodian_confirm', async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, name: employees.name, role: employees.role })
      .from(employees)
      .where(eq(employees.id, actor.id));
    if (!emp) abort('unauthenticated', '找不到您的員工資料');

    const managedDepts = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.managerEmployeeId, emp.id));
    const managedSet = new Set(managedDepts.map((d) => d.id));
    const isAdminOrFinance = canMaintainRegister(actor);

    const targetRows = await tx
      .select()
      .from(assets)
      .where(inArray(assets.id, assetIds))
      .for('update');
    if (targetRows.length !== assetIds.length) {
      abort('validation', '部分選取的財產不存在');
    }

    for (const row of targetRows) {
      const canConfirmThis =
        row.custodianEmployeeId === emp.id ||
        isAdminOrFinance ||
        (row.custodyDepartmentId !== null && managedSet.has(row.custodyDepartmentId));
      if (!canConfirmThis) {
        abort('forbidden', `財產 ${row.tag} 僅能由保管人本人、部門主管或財會／管理員執行待確認人確認`);
      }
    }

    const nowIso = new Date().toISOString();
    for (const row of targetRows) {
      const prevExtra = ((row.extraValues ?? {}) as Record<string, unknown>);
      const nextExtra: Record<string, unknown> = {
        ...prevExtra,
        custodian_confirmed_at: nowIso,
        custodian_confirmed_by_id: emp.id,
        custodian_confirmed_by_name: emp.name,
        custodian_confirmed_status: input.confirmedStatus,
        // Reset reviewer confirmation when custodian re-confirms so reviewer confirms after custodian (第 35 條)
        reviewer_confirmed_at: null,
        reviewer_confirmed_by_id: null,
        reviewer_confirmed_by_name: null,
        reviewer_note: null,
      };
      if (input.physicalQuantity !== undefined && input.physicalQuantity !== null) {
        nextExtra.physical_quantity = Math.max(0, Math.trunc(Number(input.physicalQuantity)));
      } else if (nextExtra.physical_quantity === undefined) {
        nextExtra.physical_quantity = row.quantity;
      }
      if (input.invMatchesBooks !== undefined && input.invMatchesBooks !== null) {
        nextExtra.inv_matches_books = input.invMatchesBooks;
      } else if (!nextExtra.inv_matches_books) {
        nextExtra.inv_matches_books = 'V';
      }
      if (input.invIdleDisposable !== undefined && input.invIdleDisposable !== null) {
        nextExtra.inv_idle_disposable = input.invIdleDisposable;
      }
      if (input.invUnusableScrap !== undefined && input.invUnusableScrap !== null) {
        nextExtra.inv_unusable_scrap = input.invUnusableScrap;
      }
      if (input.invDispositionNote !== undefined && input.invDispositionNote !== null) {
        nextExtra.inv_disposition_note = input.invDispositionNote.trim();
      }

      await tx
        .update(assets)
        .set({
          status: input.confirmedStatus,
          extraValues: nextExtra,
          updatedAt: sql`now()`,
        })
        .where(eq(assets.id, row.id));

      await recordAudit(tx, {
        actorEmployeeId: emp.id,
        action: 'asset.custodian_confirmed',
        entityType: 'asset',
        entityId: row.id,
        details: {
          tag: row.tag,
          confirmedAt: nowIso,
          confirmedBy: emp.name,
          previousStatus: row.status,
          confirmedStatus: input.confirmedStatus,
          physicalQuantity: nextExtra.physical_quantity ?? row.quantity,
        },
      });
    }

    return { ok: true as const, confirmedCount: targetRows.length, confirmedAt: nowIso };
  });
}

export type ReviewerConfirmInput = {
  assetIds: string[];
  action?: 'approve' | 'return';
  reviewerNote?: string | null;
};

/**
 * 第 35 條（第二階段）：待確認人完成確認後，由檢核人（財會／總務／管理員）再確認。
 * 若待確認人尚未確認，系統拒絕跳關確認。
 */
export async function confirmAssetsByReviewer(
  actor: RegisterActor,
  input: ReviewerConfirmInput
): Promise<{ ok: true; reviewedCount: number; reviewedAt: string } | Failure> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  if (!canMaintainRegister(actor)) {
    return fail('forbidden', '只有檢核人（財會或管理員）可以執行第二階段檢核確認');
  }
  const assetIds = [...new Set((input.assetIds ?? []).filter(isUuid))];
  if (assetIds.length === 0) return fail('validation', '請至少勾選一筆要檢核的財產');
  const reviewAction = input.action ?? 'approve';

  return runInTransaction('asset.reviewer_confirm', async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, name: employees.name })
      .from(employees)
      .where(eq(employees.id, actor.id));
    if (!emp) abort('unauthenticated', '找不到您的員工資料');

    const targetRows = await tx
      .select()
      .from(assets)
      .where(inArray(assets.id, assetIds))
      .for('update');
    if (targetRows.length !== assetIds.length) {
      abort('validation', '部分選取的財產不存在');
    }

    if (reviewAction === 'approve') {
      const unconfirmed = targetRows.find((r) => {
        const extra = (r.extraValues ?? {}) as Record<string, unknown>;
        return typeof extra.custodian_confirmed_at !== 'string' || !extra.custodian_confirmed_at;
      });
      if (unconfirmed) {
        abort(
          'validation',
          `財產「${unconfirmed.tag}（${unconfirmed.name}）」尚未由待確認人（保管人）完成第一階段確認，檢核人無法提前確認`
        );
      }
    }

    const nowIso = new Date().toISOString();
    const note = String(input.reviewerNote ?? '').trim() || null;

    for (const row of targetRows) {
      const prevExtra = ((row.extraValues ?? {}) as Record<string, unknown>);
      const nextExtra: Record<string, unknown> =
        reviewAction === 'approve'
          ? {
              ...prevExtra,
              reviewer_confirmed_at: nowIso,
              reviewer_confirmed_by_id: emp.id,
              reviewer_confirmed_by_name: emp.name,
              reviewer_note: note,
            }
          : {
              ...prevExtra,
              custodian_confirmed_at: null,
              custodian_confirmed_by_id: null,
              custodian_confirmed_by_name: null,
              custodian_confirmed_status: null,
              reviewer_confirmed_at: null,
              reviewer_confirmed_by_id: null,
              reviewer_confirmed_by_name: null,
              reviewer_note: note ? `【退回重盤】${note}` : '【退回重盤】請保管人重新確認財產狀態',
            };

      await tx
        .update(assets)
        .set({
          extraValues: nextExtra,
          updatedAt: sql`now()`,
        })
        .where(eq(assets.id, row.id));

      await recordAudit(tx, {
        actorEmployeeId: emp.id,
        action: reviewAction === 'approve' ? 'asset.reviewer_confirmed' : 'asset.reviewer_returned',
        entityType: 'asset',
        entityId: row.id,
        details: {
          tag: row.tag,
          reviewedAt: nowIso,
          reviewedBy: emp.name,
          action: reviewAction,
          reviewerNote: note,
          custodianConfirmedAt: prevExtra.custodian_confirmed_at ?? null,
          custodianConfirmedStatus: prevExtra.custodian_confirmed_status ?? null,
        },
      });
    }

    return { ok: true as const, reviewedCount: targetRows.length, reviewedAt: nowIso };
  });
}

export type ImportRow = Omit<AssetInput, 'custodianEmployeeId'> & { rowNumber: number; custodianEmployeeCode: string };
export type ImportSummary = { created: number; updated: number; errors: { row: number; reason: string }[] };

/** One transaction per row: a bad row is reported, the others are kept. */
export async function importAssets(actor: RegisterActor, rows: ImportRow[]): Promise<{ ok: true; summary: ImportSummary } | Failure> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  if (!canMaintainRegister(actor)) return fail('forbidden', '只有財會或管理員可以維護財產清冊');
  const summary: ImportSummary = { created: 0, updated: 0, errors: [] };
  for (const row of rows) {
    const result = await runInTransaction('asset.import_row', async (tx) => {
      const [custodian] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.employeeCode, row.custodianEmployeeCode));
      if (!custodian) abort('validation', `保管人工號「${row.custodianEmployeeCode}」查無此員工`);
      return { ok: true as const, ...(await upsertInTx(tx, actor.id, { ...row, custodianEmployeeId: custodian!.id })) };
    });
    if (!result.ok) summary.errors.push({ row: row.rowNumber, reason: result.error });
    else if (result.created) summary.created++;
    else summary.updated++;
  }
  return { ok: true, summary };
}
