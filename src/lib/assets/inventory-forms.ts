import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { ACTIVE_ASSET_STATUSES, ASSET_STATUSES, type AssetStatus } from '@/lib/asset-transfers/constants';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { canMaintainRegister, type RegisterActor } from '@/lib/assets/service';
import { getDb } from '@/lib/db';
import { createAppDb } from '@/lib/db/app-client';
import { ensureVirtualAndDemoDataPurged } from '@/lib/db/purge-virtual-demo';
import {
  assetInventoryBatches,
  assetInventoryLines,
  assets,
  departments,
  employees,
} from '@/lib/db/schema';
import { notifyAndEmail } from '@/lib/notifications/notify';
import { abort, fail, runInTransaction, type Failure } from '@/lib/workflow/tx';
import {
  CHANGE_TYPE_LABELS,
  EXISTENCE_FACT_LABELS,
  HANDOVER_WORKBOOK_MARKER,
  LOCATION_ACTION_LABELS,
  type ChangeRequestType,
  type ExistenceFact,
  type HandoverBatchMeta,
  type HandoverFormDetail,
  type HandoverFormSummary,
  type HandoverLineAnswers,
  type HandoverLineItem,
  type LocationAction,
} from './inventory-form-constants';

export {
  CHANGE_TYPE_LABELS,
  EXISTENCE_FACT_LABELS,
  HANDOVER_WORKBOOK_MARKER,
  LOCATION_ACTION_LABELS,
  type ChangeRequestType,
  type ExistenceFact,
  type HandoverBatchMeta,
  type HandoverFormDetail,
  type HandoverFormSummary,
  type HandoverLineAnswers,
  type HandoverLineItem,
  type LocationAction,
};

function parseBatchMeta(raw: string | null, fallbackCreatorId: string): HandoverBatchMeta {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<HandoverBatchMeta>;
      if (parsed && typeof parsed === 'object' && parsed.formNumber) {
        return {
          formNumber: String(parsed.formNumber),
          custodianEmployeeId: String(parsed.custodianEmployeeId ?? ''),
          custodianEmployeeCode: String(parsed.custodianEmployeeCode ?? ''),
          custodianName: String(parsed.custodianName ?? '保管人'),
          custodianDepartmentName: String(parsed.custodianDepartmentName ?? ''),
          inspectorEmployeeId: String(parsed.inspectorEmployeeId ?? fallbackCreatorId),
          inspectorEmployeeCode: String(parsed.inspectorEmployeeCode ?? ''),
          inspectorName: String(parsed.inspectorName ?? '清點人'),
          scheduledAt: String(parsed.scheduledAt ?? ''),
          meetingLocation: String(parsed.meetingLocation ?? ''),
          instructions: String(parsed.instructions ?? ''),
          dispatchedAt: String(parsed.dispatchedAt ?? ''),
          completedByEmployeeId: parsed.completedByEmployeeId ?? null,
          completedByName: parsed.completedByName ?? null,
        };
      }
    } catch {
      // ignore malformed JSON
    }
  }
  return {
    formNumber: 'INV-FORM',
    custodianEmployeeId: '',
    custodianEmployeeCode: '',
    custodianName: '保管人',
    custodianDepartmentName: '',
    inspectorEmployeeId: fallbackCreatorId,
    inspectorEmployeeCode: '',
    inspectorName: '清點人',
    scheduledAt: '',
    meetingLocation: '',
    instructions: '',
    dispatchedAt: '',
  };
}

function normalizeLineAnswers(raw: Record<string, unknown>, assetTag: string, physQty: number | null): HandoverLineAnswers {
  const originalLocation = typeof raw.originalLocation === 'string' ? raw.originalLocation : '';
  const originalStatus: AssetStatus =
    typeof raw.originalStatus === 'string' && (ASSET_STATUSES as readonly string[]).includes(raw.originalStatus)
      ? (raw.originalStatus as AssetStatus)
      : 'in_custody';
  const locationAction: LocationAction =
    raw.locationAction === 'change_needed' ? 'change_needed' : 'agree_current';
  const confirmedLocation =
    typeof raw.confirmedLocation === 'string'
      ? raw.confirmedLocation
      : originalLocation;
  const changeType: ChangeRequestType =
    raw.changeType === 'location_change' ||
    raw.changeType === 'status_change' ||
    raw.changeType === 'custodian_transfer' ||
    raw.changeType === 'scrap_or_idle'
      ? raw.changeType
      : 'none';
  const confirmedStatus: AssetStatus =
    typeof raw.confirmedStatus === 'string' && (ASSET_STATUSES as readonly string[]).includes(raw.confirmedStatus)
      ? (raw.confirmedStatus as AssetStatus)
      : originalStatus;
  const existenceFact: ExistenceFact =
    raw.existenceFact === 'exists_damaged' || raw.existenceFact === 'missing'
      ? raw.existenceFact
      : 'exists';

  return {
    assetName: typeof raw.assetName === 'string' && raw.assetName ? raw.assetName : assetTag,
    itemKind: typeof raw.itemKind === 'string' ? raw.itemKind : null,
    description: typeof raw.description === 'string' ? raw.description : null,
    bookQuantity: typeof raw.bookQuantity === 'number' && raw.bookQuantity > 0 ? raw.bookQuantity : (physQty ?? 1),
    unit: typeof raw.unit === 'string' ? raw.unit : '台',
    originalLocation,
    originalStatus,
    originalCustodianId: typeof raw.originalCustodianId === 'string' ? raw.originalCustodianId : '',
    originalCustodianName: typeof raw.originalCustodianName === 'string' ? raw.originalCustodianName : '',
    locationAction,
    confirmedLocation,
    changeType,
    confirmedStatus,
    existenceFact,
    custodianNote: typeof raw.custodianNote === 'string' ? raw.custodianNote : '',
    inspectorNote: typeof raw.inspectorNote === 'string' ? raw.inspectorNote : '',
    custodianConfirmed: raw.custodianConfirmed === true,
    custodianConfirmedAt: typeof raw.custodianConfirmedAt === 'string' ? raw.custodianConfirmedAt : null,
    custodianConfirmedById: typeof raw.custodianConfirmedById === 'string' ? raw.custodianConfirmedById : null,
    custodianConfirmedByName: typeof raw.custodianConfirmedByName === 'string' ? raw.custodianConfirmedByName : null,
    inspectorConfirmed: raw.inspectorConfirmed === true,
    inspectorConfirmedAt: typeof raw.inspectorConfirmedAt === 'string' ? raw.inspectorConfirmedAt : null,
    inspectorConfirmedById: typeof raw.inspectorConfirmedById === 'string' ? raw.inspectorConfirmedById : null,
    inspectorConfirmedByName: typeof raw.inspectorConfirmedByName === 'string' ? raw.inspectorConfirmedByName : null,
  };
}

export type CreateHandoverFormInput = {
  custodianEmployeeIds: string[];
  /** 清點人指定的點交時間 (例如 2026-11-15T14:00) */
  scheduledAt: string;
  meetingLocation?: string;
  instructions?: string;
};

/**
 * 清點人於指定時間發給財產擁有者「財產清點／點交確認系統表單」：
 * 為每位被選取的財產擁有者建立一張專屬表單（內含其名下所有在列財產明細），並發送系統通知。
 */
export async function createInventoryHandoverForms(
  actor: RegisterActor,
  input: CreateHandoverFormInput
): Promise<
  | { ok: true; createdForms: Array<{ batchId: string; formNumber: string; custodianName: string; rowCount: number }> }
  | Failure
> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  if (!canMaintainRegister(actor)) {
    return fail('forbidden', '只有清點人（財會、總務或系統管理員）可以派發財產清點系統表單');
  }

  const custodianIds = [...new Set((input.custodianEmployeeIds ?? []).filter(isUuid))];
  if (custodianIds.length === 0) {
    return fail('validation', '請至少選擇一位財產擁有者（保管人）');
  }
  const scheduledAt = String(input.scheduledAt ?? '').trim();
  if (!scheduledAt) {
    return fail('validation', '請指定清點／點交時間');
  }
  const meetingLocation = String(input.meetingLocation ?? '').trim();
  const instructions = String(input.instructions ?? '').trim();

  const res = await runInTransaction('asset_inventory.create_handover_forms', async (tx) => {
    const [inspector] = await tx
      .select({ id: employees.id, code: employees.employeeCode, name: employees.name })
      .from(employees)
      .where(eq(employees.id, actor.id));
    if (!inspector) abort('unauthenticated', '找不到清點人員工資料');

    const custodians = await tx
      .select({
        id: employees.id,
        code: employees.employeeCode,
        name: employees.name,
        departmentName: departments.name,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(inArray(employees.id, custodianIds));

    if (custodians.length === 0) {
      abort('validation', '找不到指定的財產擁有者');
    }

    const allCustodianAssets = await tx
      .select()
      .from(assets)
      .where(
        and(
          inArray(assets.custodianEmployeeId, custodianIds),
          inArray(assets.status, [...ACTIVE_ASSET_STATUSES])
        )
      )
      .orderBy(asc(assets.tag));

    const assetsByCustodian = new Map<string, Array<typeof assets.$inferSelect>>();
    for (const a of allCustodianAssets) {
      const list = assetsByCustodian.get(a.custodianEmployeeId) ?? [];
      list.push(a);
      assetsByCustodian.set(a.custodianEmployeeId, list);
    }

    const dateStamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const asOfDate = scheduledAt.slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/)
      ? scheduledAt.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    const createdForms: Array<{
      batchId: string;
      formNumber: string;
      custodianId: string;
      custodianName: string;
      rowCount: number;
    }> = [];

    for (let i = 0; i < custodians.length; i++) {
      const cust = custodians[i]!;
      const custAssets = assetsByCustodian.get(cust.id) ?? [];
      if (custAssets.length === 0) continue;

      const suffix = String(Math.floor(100 + Math.random() * 900));
      const formNumber = `INV-${dateStamp}-${cust.code}-${suffix}`;
      const meta: HandoverBatchMeta = {
        formNumber,
        custodianEmployeeId: cust.id,
        custodianEmployeeCode: cust.code,
        custodianName: cust.name,
        custodianDepartmentName: cust.departmentName,
        inspectorEmployeeId: inspector.id,
        inspectorEmployeeCode: inspector.code,
        inspectorName: inspector.name,
        scheduledAt,
        meetingLocation,
        instructions,
        dispatchedAt: nowIso,
      };

      const label = `【財產清點單 ${formNumber}】`;
      const [batch] = await tx
        .insert(assetInventoryBatches)
        .values({
          label: label.slice(0, 160),
          sourceWorkbook: HANDOVER_WORKBOOK_MARKER,
          sourceSheet: JSON.stringify(meta),
          asOfDate,
          status: 'open',
          rowCount: custAssets.length,
          createdByEmployeeId: inspector.id,
        })
        .returning({ id: assetInventoryBatches.id });

      for (let idx = 0; idx < custAssets.length; idx++) {
        const asset = custAssets[idx]!;
        const initialAnswers: HandoverLineAnswers = {
          assetName: asset.name,
          itemKind: asset.itemKind ?? null,
          description: asset.description ?? null,
          bookQuantity: asset.quantity,
          unit: asset.unit ?? '台',
          originalLocation: asset.location,
          originalStatus: asset.status as AssetStatus,
          originalCustodianId: cust.id,
          originalCustodianName: cust.name,
          locationAction: 'agree_current',
          confirmedLocation: asset.location,
          changeType: 'none',
          confirmedStatus: asset.status as AssetStatus,
          existenceFact: 'exists',
          custodianNote: '',
          inspectorNote: '',
          custodianConfirmed: false,
          custodianConfirmedAt: null,
          custodianConfirmedById: null,
          custodianConfirmedByName: null,
          inspectorConfirmed: false,
          inspectorConfirmedAt: null,
          inspectorConfirmedById: null,
          inspectorConfirmedByName: null,
        };

        await tx.insert(assetInventoryLines).values({
          batchId: batch.id,
          assetId: asset.id,
          assetTag: asset.tag,
          physicalQuantity: asset.quantity,
          sourceRow: idx + 1,
          answers: initialAnswers,
        });
      }

      await recordAudit(tx, {
        actorEmployeeId: inspector.id,
        action: 'asset_inventory_form.dispatched',
        entityType: 'asset_inventory_batch',
        entityId: batch.id,
        details: {
          formNumber,
          custodianEmployeeId: cust.id,
          custodianName: cust.name,
          scheduledAt,
          rowCount: custAssets.length,
        },
      });

      createdForms.push({
        batchId: batch.id,
        formNumber,
        custodianId: cust.id,
        custodianName: cust.name,
        rowCount: custAssets.length,
      });
    }

    if (createdForms.length === 0) {
      abort('validation', '選取的員工名下目前沒有在列保管財產，無需產生清點單');
    }

    return { ok: true as const, inspectorName: inspector.name, createdForms };
  });

  if (!res.ok) return res;

  // Send in-app + email notification to each custodian
  const appDb = createAppDb();
  for (const f of res.createdForms) {
    const locText = meetingLocation ? `｜點交地點：${meetingLocation}` : '';
    const noteText = instructions ? `｜說明：${instructions}` : '';
    const msg = `【財產盤點通知】財產清點人 ${res.inspectorName} 已為您排定於 ${scheduledAt.replace('T', ' ')} 進行名下資產（共 ${f.rowCount} 項）財產盤點${locText}${noteText}。請前往「我的資產管理（/assets/mine）」檢視收到的財產盤點單，並逐條點選「確認」或「修改」。`;
    await notifyAndEmail(appDb, {
      recipientEmployeeId: f.custodianId,
      type: 'approval_requested',
      formType: 'asset_inventory_handover',
      formId: f.batchId,
      caseNumber: f.formNumber,
      message: msg,
      templateId: 'asset_inventory_dispatched',
      templateVars: {
        recipientName: f.custodianName,
        applicantName: res.inspectorName,
        formLabel: '財產清點單',
        caseNumber: f.formNumber,
        title: `財產清點單 ${f.formNumber}`,
        message: msg,
        actionUrl: `${process.env.APP_ORIGIN || 'http://localhost:3001'}/assets/mine`,
      },
    });
  }

  return {
    ok: true,
    createdForms: res.createdForms.map(({ batchId, formNumber, custodianName, rowCount }) => ({
      batchId,
      formNumber,
      custodianName,
      rowCount,
    })),
  };
}

/**
 * 財產清點單僅由清點人（財會、總務或管理員）主動派發時建立，不再於載入頁面時自動補建虛擬／範例清點單。
 */
export async function ensureCustodianOpenHandoverForm(_actor: RegisterActor): Promise<void> {
  return;
}

/**
 * 查詢目前登入者可見的所有「財產清點／點交系統表單」清單。
 */
export async function listInventoryHandoverForms(actor: RegisterActor): Promise<HandoverFormSummary[]> {
  if (!actor) return [];
  await ensureVirtualAndDemoDataPurged();
  const db = getDb();

  const batches = await db
    .select()
    .from(assetInventoryBatches)
    .where(eq(assetInventoryBatches.sourceWorkbook, HANDOVER_WORKBOOK_MARKER))
    .orderBy(desc(assetInventoryBatches.createdAt));

  if (batches.length === 0) return [];

  const isInspectorOrAdmin = canMaintainRegister(actor);
  const [managedDepts, validEmployees] = await Promise.all([
    db
      .select({ name: departments.name })
      .from(departments)
      .where(and(eq(departments.managerEmployeeId, actor.id), eq(departments.active, true))),
    db.select({ id: employees.id }).from(employees),
  ]);
  const managedDeptNames = new Set(managedDepts.map((d) => d.name));
  const validEmployeeIds = new Set(validEmployees.map((e) => e.id));

  const visibleBatches = batches.filter((b) => {
    const meta = parseBatchMeta(b.sourceSheet, b.createdByEmployeeId);
    if (!meta.custodianEmployeeId || !validEmployeeIds.has(meta.custodianEmployeeId)) {
      return false;
    }
    if (isInspectorOrAdmin) return true;
    if (b.createdByEmployeeId === actor.id) return true;
    if (meta.custodianEmployeeId === actor.id) return true;
    if (managedDeptNames.has(meta.custodianDepartmentName)) return true;
    return false;
  });

  if (visibleBatches.length === 0) return [];

  const batchIds = visibleBatches.map((b) => b.id);
  const allLines = await db
    .select()
    .from(assetInventoryLines)
    .where(inArray(assetInventoryLines.batchId, batchIds))
    .orderBy(asc(assetInventoryLines.sourceRow), asc(assetInventoryLines.assetTag));

  const linesByBatch = new Map<string, Array<typeof assetInventoryLines.$inferSelect>>();
  for (const l of allLines) {
    const arr = linesByBatch.get(l.batchId) ?? [];
    arr.push(l);
    linesByBatch.set(l.batchId, arr);
  }

  return visibleBatches.map((b) => {
    const meta = parseBatchMeta(b.sourceSheet, b.createdByEmployeeId);
    const lines = linesByBatch.get(b.id) ?? [];
    let custodianConfirmedLines = 0;
    let inspectorConfirmedLines = 0;
    let bothConfirmedLines = 0;
    for (const l of lines) {
      const ans = normalizeLineAnswers((l.answers ?? {}) as Record<string, unknown>, l.assetTag, l.physicalQuantity);
      if (ans.custodianConfirmed) custodianConfirmedLines++;
      if (ans.inspectorConfirmed) inspectorConfirmedLines++;
      if (ans.custodianConfirmed && ans.inspectorConfirmed) bothConfirmedLines++;
    }
    const totalLines = lines.length;
    return {
      id: b.id,
      formNumber: meta.formNumber,
      label: `【財產清點單 ${meta.formNumber}】`,
      status: b.status as 'open' | 'locked',
      custodianEmployeeId: meta.custodianEmployeeId,
      custodianEmployeeCode: meta.custodianEmployeeCode,
      custodianName: meta.custodianName,
      custodianDepartmentName: meta.custodianDepartmentName,
      inspectorEmployeeId: meta.inspectorEmployeeId,
      inspectorEmployeeCode: meta.inspectorEmployeeCode,
      inspectorName: meta.inspectorName,
      scheduledAt: meta.scheduledAt,
      meetingLocation: meta.meetingLocation,
      instructions: meta.instructions,
      dispatchedAt: meta.dispatchedAt || b.createdAt.toISOString(),
      lockedAt: b.lockedAt,
      totalLines,
      custodianConfirmedLines,
      inspectorConfirmedLines,
      bothConfirmedLines,
      allLinesConfirmedByBoth: totalLines > 0 && bothConfirmedLines === totalLines,
    };
  });
}

/**
 * 讀取單張「財產清點／點交系統表單」完整明細。
 */
export async function getInventoryHandoverFormDetail(
  actor: RegisterActor,
  batchId: string
): Promise<HandoverFormDetail | null> {
  if (!actor || !isUuid(batchId)) return null;
  const db = getDb();

  const [batch] = await db
    .select()
    .from(assetInventoryBatches)
    .where(
      and(
        eq(assetInventoryBatches.id, batchId),
        eq(assetInventoryBatches.sourceWorkbook, HANDOVER_WORKBOOK_MARKER)
      )
    );
  if (!batch) return null;

  const meta = parseBatchMeta(batch.sourceSheet, batch.createdByEmployeeId);
  const isInspectorOrAdmin = canMaintainRegister(actor) || batch.createdByEmployeeId === actor.id;
  const isCustodian = meta.custodianEmployeeId === actor.id;

  if (!isInspectorOrAdmin && !isCustodian) {
    // Check if department manager of custodian
    const managedDepts = await db
      .select({ name: departments.name })
      .from(departments)
      .where(and(eq(departments.managerEmployeeId, actor.id), eq(departments.active, true)));
    const isDeptMgr = managedDepts.some((d) => d.name === meta.custodianDepartmentName);
    if (!isDeptMgr) return null;
  }

  const rawLines = await db
    .select()
    .from(assetInventoryLines)
    .where(eq(assetInventoryLines.batchId, batch.id))
    .orderBy(asc(assetInventoryLines.sourceRow), asc(assetInventoryLines.assetTag));

  const lines: HandoverLineItem[] = rawLines.map((l, idx) => ({
    id: l.id,
    batchId: l.batchId,
    lineNo: l.sourceRow ?? idx + 1,
    assetId: l.assetId,
    assetTag: l.assetTag,
    physicalQuantity: l.physicalQuantity ?? 1,
    state: normalizeLineAnswers((l.answers ?? {}) as Record<string, unknown>, l.assetTag, l.physicalQuantity),
  }));

  let custodianConfirmedLines = 0;
  let inspectorConfirmedLines = 0;
  let bothConfirmedLines = 0;
  for (const l of lines) {
    if (l.state.custodianConfirmed) custodianConfirmedLines++;
    if (l.state.inspectorConfirmed) inspectorConfirmedLines++;
    if (l.state.custodianConfirmed && l.state.inspectorConfirmed) bothConfirmedLines++;
  }

  return {
    id: batch.id,
    formNumber: meta.formNumber,
    label: `【財產清點單 ${meta.formNumber}】`,
    status: batch.status as 'open' | 'locked',
    custodianEmployeeId: meta.custodianEmployeeId,
    custodianEmployeeCode: meta.custodianEmployeeCode,
    custodianName: meta.custodianName,
    custodianDepartmentName: meta.custodianDepartmentName,
    inspectorEmployeeId: meta.inspectorEmployeeId,
    inspectorEmployeeCode: meta.inspectorEmployeeCode,
    inspectorName: meta.inspectorName,
    scheduledAt: meta.scheduledAt,
    meetingLocation: meta.meetingLocation,
    instructions: meta.instructions,
    dispatchedAt: meta.dispatchedAt || batch.createdAt.toISOString(),
    lockedAt: batch.lockedAt,
    totalLines: lines.length,
    custodianConfirmedLines,
    inspectorConfirmedLines,
    bothConfirmedLines,
    allLinesConfirmedByBoth: lines.length > 0 && bothConfirmedLines === lines.length,
    lines,
    // 依真實登入身份決定：系統管理員賦予財產清點人權限者（或本單指定清點人）為清點人，本單財產擁有者本人為保管人
    canActAsCustodian: isCustodian,
    canActAsInspector: isInspectorOrAdmin,
  };
}

export type UpdateHandoverLineInput = {
  batchId: string;
  lineIds: string[];
  party: 'custodian' | 'inspector';
  confirm: boolean;
  /** Optional field updates when confirming or saving a line */
  locationAction?: LocationAction;
  confirmedLocation?: string;
  changeType?: ChangeRequestType;
  confirmedStatus?: AssetStatus;
  existenceFact?: ExistenceFact;
  physicalQuantity?: number;
  custodianNote?: string;
  inspectorNote?: string;
};

/**
 * 財產擁有者（custodian）或清點人（inspector）於系統表單上對單條或多條財產明細進行：
 * - 點選同意現在位置，或選擇需要更改異動（填寫新位置／異動類別／狀態）
 * - 確認此物品之存在事實（存在正常／損壞／未尋獲）與實盤數量
 * - 填寫其他說明（財產人說明／清點人說明）
 * - 點選確認（記錄確認人與時間戳記）
 */
export async function updateAndConfirmHandoverLines(
  actor: RegisterActor,
  input: UpdateHandoverLineInput
): Promise<{ ok: true; updatedCount: number; confirmedAt: string | null } | Failure> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  if (!isUuid(input.batchId)) return fail('validation', '清點單識別碼不正確');
  const lineIds = [...new Set((input.lineIds ?? []).filter(isUuid))];
  if (lineIds.length === 0) return fail('validation', '請至少選取一條財產明細');

  return runInTransaction('asset_inventory.confirm_line', async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, name: employees.name, role: employees.role })
      .from(employees)
      .where(eq(employees.id, actor.id));
    if (!emp) abort('unauthenticated', '找不到員工資料');

    const [batch] = await tx
      .select()
      .from(assetInventoryBatches)
      .where(
        and(
          eq(assetInventoryBatches.id, input.batchId),
          eq(assetInventoryBatches.sourceWorkbook, HANDOVER_WORKBOOK_MARKER)
        )
      )
      .for('update');
    if (!batch) abort('validation', '找不到此張財產清點單');
    if (batch.status === 'locked') {
      abort('conflict', '此張財產清點單已完成雙方確認並結案，無法再修改');
    }

    const meta = parseBatchMeta(batch.sourceSheet, batch.createdByEmployeeId);
    const isInspectorOrAdmin = canMaintainRegister(actor) || batch.createdByEmployeeId === actor.id;
    const isCustodian = meta.custodianEmployeeId === actor.id;

    if (input.party === 'custodian' && !isCustodian) {
      abort('forbidden', `只有本單之財產擁有者（${meta.custodianName}）本人可以執行「保管人確認／修改」`);
    }
    if (input.party === 'inspector' && !isInspectorOrAdmin) {
      abort('forbidden', '只有系統管理員賦予之財產清點人可以執行「清點人確認／異常」');
    }

    const targetLines = await tx
      .select()
      .from(assetInventoryLines)
      .where(
        and(
          eq(assetInventoryLines.batchId, batch.id),
          inArray(assetInventoryLines.id, lineIds)
        )
      )
      .for('update');
    if (targetLines.length !== lineIds.length) {
      abort('validation', '部分財產明細不屬於此張清點單');
    }

    const nowIso = input.confirm ? new Date().toISOString() : null;

    for (const line of targetLines) {
      const current = normalizeLineAnswers(
        (line.answers ?? {}) as Record<string, unknown>,
        line.assetTag,
        line.physicalQuantity
      );

      // 根據執行者身分隔離欄位：
      // - 保管人 (custodian) 只能修改位置異動、存在事實、實盤數量與 custodianNote，不可更動 inspectorNote
      // - 清點人 (inspector) 只能填寫 inspectorNote（異常說明）與清點人確認狀態，不可更動保管人填寫的 custodianNote 與位置／存在事實
      const nextLocationAction =
        input.party === 'custodian'
          ? input.locationAction ?? current.locationAction
          : current.locationAction;

      let nextConfirmedLocation =
        input.party === 'custodian' && input.confirmedLocation !== undefined
          ? input.confirmedLocation.trim()
          : current.confirmedLocation;

      const nextCustodianNote =
        input.party === 'custodian' && input.custodianNote !== undefined
          ? input.custodianNote.trim()
          : current.custodianNote;

      const nextInspectorNote =
        input.party === 'inspector' && input.inspectorNote !== undefined
          ? input.inspectorNote.trim()
          : current.inspectorNote;

      const nextExistence: ExistenceFact =
        input.party === 'custodian' && input.existenceFact
          ? input.existenceFact
          : current.existenceFact;

      if (input.party === 'custodian') {
        if (nextLocationAction === 'agree_current' && nextExistence === 'exists') {
          nextConfirmedLocation = current.originalLocation;
        } else if (
          input.confirm &&
          nextLocationAction === 'change_needed' &&
          !nextConfirmedLocation &&
          !nextCustodianNote &&
          nextExistence === 'exists'
        ) {
          abort(
            'validation',
            `財產「${line.assetTag}（${current.assetName}）」已選擇修改，請選擇存在狀態、填寫新位置或補充說明`
          );
        }
      }

      if (nextLocationAction === 'change_needed' && !nextConfirmedLocation) {
        nextConfirmedLocation = current.originalLocation;
      }

      const nextChangeType: ChangeRequestType =
        input.party === 'custodian'
          ? nextLocationAction === 'agree_current' && nextExistence === 'exists'
            ? 'none'
            : input.changeType && input.changeType !== 'none'
              ? input.changeType
              : 'location_change'
          : current.changeType;

      const nextStatus: AssetStatus =
        input.party === 'custodian' &&
        input.confirmedStatus &&
        (ASSET_STATUSES as readonly string[]).includes(input.confirmedStatus)
          ? input.confirmedStatus
          : current.confirmedStatus;

      const nextPhysQty =
        input.party === 'custodian'
          ? input.physicalQuantity !== undefined && Number.isFinite(input.physicalQuantity)
            ? Math.max(0, Math.trunc(input.physicalQuantity))
            : nextExistence === 'missing'
              ? 0
              : line.physicalQuantity ?? current.bookQuantity
          : line.physicalQuantity ?? current.bookQuantity;

      const nextAnswers: HandoverLineAnswers = {
        ...current,
        locationAction: nextLocationAction,
        confirmedLocation: nextConfirmedLocation,
        changeType: nextChangeType,
        confirmedStatus: nextStatus,
        existenceFact: nextExistence,
        custodianNote: nextCustodianNote,
        inspectorNote: nextInspectorNote,
        ...(input.party === 'custodian'
          ? {
              custodianConfirmed: input.confirm,
              custodianConfirmedAt: nowIso,
              custodianConfirmedById: input.confirm ? emp.id : null,
              custodianConfirmedByName: input.confirm ? emp.name : null,
            }
          : {
              inspectorConfirmed: input.confirm,
              inspectorConfirmedAt: nowIso,
              inspectorConfirmedById: input.confirm ? emp.id : null,
              inspectorConfirmedByName: input.confirm ? emp.name : null,
            }),
      };

      await tx
        .update(assetInventoryLines)
        .set({
          physicalQuantity: nextPhysQty,
          answers: nextAnswers,
        })
        .where(eq(assetInventoryLines.id, line.id));
    }

    await recordAudit(tx, {
      actorEmployeeId: emp.id,
      action:
        input.party === 'custodian'
          ? 'asset_inventory_line.custodian_confirmed'
          : 'asset_inventory_line.inspector_confirmed',
      entityType: 'asset_inventory_batch',
      entityId: batch.id,
      details: {
        formNumber: meta.formNumber,
        party: input.party,
        confirm: input.confirm,
        lineCount: targetLines.length,
        assetTags: targetLines.map((l) => l.assetTag),
      },
    });

    return { ok: true as const, updatedCount: targetLines.length, confirmedAt: nowIso };
  });
}

/**
 * 結束／結案這張「財產清點／點交系統表單」：
 * 強制檢查：**雙方（清點人＋財產擁有者）每一條明細都確認後，這張單才可以結束**！
 * 結束後自動將確認結果（含同意之位置或更改後的新位置、財產狀態、雙階確認時間戳記）寫回《財產保管清冊》。
 */
export async function completeInventoryHandoverForm(
  actor: RegisterActor,
  batchId: string
): Promise<{ ok: true; formNumber: string; updatedAssetCount: number } | Failure> {
  if (!actor) return fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員');
  if (!isUuid(batchId)) return fail('validation', '清點單識別碼不正確');

  return runInTransaction('asset_inventory.complete_form', async (tx) => {
    const [emp] = await tx
      .select({ id: employees.id, name: employees.name, role: employees.role })
      .from(employees)
      .where(eq(employees.id, actor.id));
    if (!emp) abort('unauthenticated', '找不到員工資料');

    const [batch] = await tx
      .select()
      .from(assetInventoryBatches)
      .where(
        and(
          eq(assetInventoryBatches.id, batchId),
          eq(assetInventoryBatches.sourceWorkbook, HANDOVER_WORKBOOK_MARKER)
        )
      )
      .for('update');
    if (!batch) abort('validation', '找不到此張財產清點單');
    if (batch.status === 'locked') {
      abort('conflict', '此張財產清點單已經結案');
    }

    const meta = parseBatchMeta(batch.sourceSheet, batch.createdByEmployeeId);
    const isAllowed =
      canMaintainRegister(actor) ||
      batch.createdByEmployeeId === actor.id ||
      meta.custodianEmployeeId === actor.id;
    if (!isAllowed) {
      abort('forbidden', '只有本單之清點人或財產擁有者可以結束此張清點單');
    }

    const lines = await tx
      .select()
      .from(assetInventoryLines)
      .where(eq(assetInventoryLines.batchId, batch.id))
      .orderBy(asc(assetInventoryLines.sourceRow), asc(assetInventoryLines.assetTag))
      .for('update');

    if (lines.length === 0) {
      abort('validation', '此清點單無任何財產明細，無法結案');
    }

    const missingConfirmations: string[] = [];
    const parsedLines: Array<{
      line: typeof assetInventoryLines.$inferSelect;
      ans: HandoverLineAnswers;
    }> = [];

    for (const line of lines) {
      const ans = normalizeLineAnswers(
        (line.answers ?? {}) as Record<string, unknown>,
        line.assetTag,
        line.physicalQuantity
      );
      parsedLines.push({ line, ans });

      if (!ans.custodianConfirmed && !ans.inspectorConfirmed) {
        missingConfirmations.push(`${line.assetTag}（財產人與清點人皆尚未確認）`);
      } else if (!ans.custodianConfirmed) {
        missingConfirmations.push(`${line.assetTag}（財產擁有者尚未確認）`);
      } else if (!ans.inspectorConfirmed) {
        missingConfirmations.push(`${line.assetTag}（清點人尚未確認）`);
      }
    }

    if (missingConfirmations.length > 0) {
      abort(
        'validation',
        `雙方每一條都確認後，這張單才可以結束！尚有 ${missingConfirmations.length} 條明細未完成雙方確認：${missingConfirmations.slice(0, 5).join('、')}${missingConfirmations.length > 5 ? '…等' : ''}`
      );
    }

    const nowIso = new Date().toISOString();
    let updatedAssetCount = 0;

    // 將每一條雙方已確認的結果（包含位置異動、狀態、實盤數與雙方確認時間）同步寫回財產保管清冊 (assets)
    for (const { line, ans } of parsedLines) {
      if (!line.assetId) continue;
      const [asset] = await tx
        .select()
        .from(assets)
        .where(eq(assets.id, line.assetId))
        .for('update');
      if (!asset) continue;

      const prevExtra = (asset.extraValues ?? {}) as Record<string, unknown>;
      const combinedNote = [
        ans.custodianNote ? `財產人說明：${ans.custodianNote}` : '',
        ans.inspectorNote ? `清點人說明：${ans.inspectorNote}` : '',
      ]
        .filter(Boolean)
        .join('｜');

      const nextLocation =
        ans.locationAction === 'change_needed' && ans.confirmedLocation.trim()
          ? ans.confirmedLocation.trim()
          : asset.location;

      const nextExtra: Record<string, unknown> = {
        ...prevExtra,
        physical_quantity: line.physicalQuantity ?? ans.bookQuantity,
        inv_matches_books: ans.existenceFact === 'exists' ? 'V' : 'X',
        inv_idle_disposable: ans.changeType === 'scrap_or_idle' ? 'V' : (prevExtra.inv_idle_disposable ?? 'X'),
        inv_unusable_scrap: ans.existenceFact === 'exists_damaged' ? 'V' : (prevExtra.inv_unusable_scrap ?? 'X'),
        inv_disposition_note:
          combinedNote ||
          (ans.locationAction === 'change_needed'
            ? `${CHANGE_TYPE_LABELS[ans.changeType]}（新位置：${nextLocation}）`
            : EXISTENCE_FACT_LABELS[ans.existenceFact]),
        change_request:
          ans.locationAction === 'change_needed'
            ? `${CHANGE_TYPE_LABELS[ans.changeType]}：${nextLocation}${combinedNote ? `（${combinedNote}）` : ''}`
            : (prevExtra.change_request ?? ''),
        custodian_confirmed_at: ans.custodianConfirmedAt ?? nowIso,
        custodian_confirmed_by_id: ans.custodianConfirmedById ?? meta.custodianEmployeeId,
        custodian_confirmed_by_name: ans.custodianConfirmedByName ?? meta.custodianName,
        custodian_confirmed_status: ans.confirmedStatus,
        reviewer_confirmed_at: ans.inspectorConfirmedAt ?? nowIso,
        reviewer_confirmed_by_id: ans.inspectorConfirmedById ?? meta.inspectorEmployeeId,
        reviewer_confirmed_by_name: ans.inspectorConfirmedByName ?? meta.inspectorName,
        reviewer_note: combinedNote || `清點單 ${meta.formNumber} 點交確認完成`,
      };

      await tx
        .update(assets)
        .set({
          location: nextLocation,
          status: ans.confirmedStatus,
          extraValues: nextExtra,
        })
        .where(eq(assets.id, asset.id));

      updatedAssetCount++;
    }

    const updatedMeta: HandoverBatchMeta = {
      ...meta,
      completedByEmployeeId: emp.id,
      completedByName: emp.name,
    };

    await tx
      .update(assetInventoryBatches)
      .set({
        status: 'locked',
        lockedAt: new Date(nowIso),
        sourceSheet: JSON.stringify(updatedMeta),
      })
      .where(eq(assetInventoryBatches.id, batch.id));

    await recordAudit(tx, {
      actorEmployeeId: emp.id,
      action: 'asset_inventory_form.completed',
      entityType: 'asset_inventory_batch',
      entityId: batch.id,
      details: {
        formNumber: meta.formNumber,
        custodianName: meta.custodianName,
        inspectorName: meta.inspectorName,
        totalLines: lines.length,
        updatedAssetCount,
      },
    });

    return { ok: true as const, formNumber: meta.formNumber, updatedAssetCount };
  });
}
