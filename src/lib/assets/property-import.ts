import { eq, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import {
  parsePropertyRegisterWorkbook,
  type ParsedPropertyRow,
  type PropertyRowIssue,
} from '@/lib/assets/parse-property-workbook';
import { seedAssetFieldDefinitionsFromCatalog } from '@/lib/assets/seed-field-definitions';
import { getDb } from '@/lib/db';
import {
  assetFieldDefinitions,
  assetImportBatches,
  assetInventoryBatches,
  assetInventoryLines,
  assets,
  departments,
  employees,
} from '@/lib/db/schema';
import { canMaintainRegister, type RegisterActor } from '@/lib/assets/service';

export type ResolvedImportRow = {
  rowNumber: number;
  tag: string;
  action: 'create' | 'update' | 'unchanged' | 'skip' | 'fail';
  reason?: string;
  custodianEmployeeId?: string;
  custodyDepartmentId?: string | null;
  parsed: ParsedPropertyRow;
};

export type PropertyImportPreview = {
  sheetName: string;
  counts: {
    create: number;
    update: number;
    unchanged: number;
    skip: number;
    fail: number;
  };
  issues: PropertyRowIssue[];
  unresolvedCustodians: string[];
  unresolvedDepartments: string[];
  rows: ResolvedImportRow[];
};

function normalizePerson(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** Take primary status token before slash annotations like 保管中/待報廢. */
export function coerceWorkbookStatus(
  status: ParsedPropertyRow['core']['status'],
  statusLabel: string | null
): ParsedPropertyRow['core']['status'] {
  if (status && status !== 'invalid') return status;
  if (!statusLabel) return null;
  const primary = statusLabel.split(/[／/]/)[0]!.trim();
  if (primary === '保管中') return 'in_custody';
  if (primary === '出借中' || primary === '借出' || primary.startsWith('出借')) return 'lent';
  if (primary === '遺失') return 'scrapped'; // leave as fail in preview — require explicit mapping
  if (primary === '已報廢' || primary === '報廢') return 'scrapped';
  if (primary === '已出售' || primary === '出售') return 'sold';
  if (primary === '已合併' || primary === '合併') return 'merged';
  return 'invalid';
}

export async function buildPropertyImportPreview(buffer: Buffer): Promise<PropertyImportPreview> {
  await seedAssetFieldDefinitionsFromCatalog();
  const parsed = await parsePropertyRegisterWorkbook(buffer);
  const db = getDb();

  const empRows = await db.select({ id: employees.id, name: employees.name, code: employees.employeeCode }).from(employees);
  const deptRows = await db.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments);
  const byName = new Map(empRows.map((e) => [normalizePerson(e.name), e]));
  const byCode = new Map(empRows.map((e) => [e.code.toLowerCase(), e]));
  const deptByName = new Map(deptRows.map((d) => [normalizePerson(d.name), d]));
  const deptByCode = new Map(deptRows.map((d) => [d.code.toLowerCase(), d]));

  const existing = await db.select({ id: assets.id, tag: assets.tag, name: assets.name, quantity: assets.quantity, location: assets.location, status: assets.status, custodianEmployeeId: assets.custodianEmployeeId }).from(assets);
  const byTag = new Map(existing.map((a) => [a.tag, a]));

  const fieldDefs = await db
    .select({ id: assetFieldDefinitions.id, stableKey: assetFieldDefinitions.stableKey, status: assetFieldDefinitions.status })
    .from(assetFieldDefinitions);
  const activeFieldByKey = new Map(
    fieldDefs.filter((f) => f.status === 'active').map((f) => [f.stableKey, f.id])
  );

  const unresolvedCustodians = new Set<string>();
  const unresolvedDepartments = new Set<string>();
  const rows: ResolvedImportRow[] = [];
  const issues = [...parsed.issues];

  for (const row of parsed.rows) {
    const status = coerceWorkbookStatus(row.core.status, row.core.statusLabel);
    const custodianLabel = row.core.custodianLabel?.trim() || '';
    const deptLabel = row.core.custodyDepartmentLabel?.trim() || '';

    let custodianEmployeeId: string | undefined;
    if (custodianLabel) {
      const hit =
        byName.get(normalizePerson(custodianLabel)) ||
        byCode.get(custodianLabel.toLowerCase());
      if (hit) custodianEmployeeId = hit.id;
      else unresolvedCustodians.add(custodianLabel);
    }

    let custodyDepartmentId: string | null | undefined;
    if (deptLabel) {
      const hit = deptByName.get(normalizePerson(deptLabel)) || deptByCode.get(deptLabel.toLowerCase());
      if (hit) custodyDepartmentId = hit.id;
      else {
        unresolvedDepartments.add(deptLabel);
        custodyDepartmentId = undefined;
      }
    } else custodyDepartmentId = null;

    if (!row.core.name) {
      rows.push({ rowNumber: row.rowNumber, tag: row.tag, action: 'fail', reason: '名稱空白', parsed: row });
      continue;
    }
    if (status === 'invalid') {
      rows.push({
        rowNumber: row.rowNumber,
        tag: row.tag,
        action: 'fail',
        reason: `狀態無法對應：${row.core.statusLabel ?? ''}`,
        parsed: row,
      });
      continue;
    }
    if (!custodianEmployeeId) {
      rows.push({
        rowNumber: row.rowNumber,
        tag: row.tag,
        action: 'skip',
        reason: custodianLabel ? `保管人未對應：${custodianLabel}` : '缺少保管人',
        parsed: row,
        custodyDepartmentId: custodyDepartmentId ?? null,
      });
      continue;
    }
    if (deptLabel && custodyDepartmentId === undefined) {
      rows.push({
        rowNumber: row.rowNumber,
        tag: row.tag,
        action: 'skip',
        reason: `保管部門未對應：${deptLabel}`,
        parsed: row,
        custodianEmployeeId,
      });
      continue;
    }

    const qty = row.core.quantity && row.core.quantity > 0 ? row.core.quantity : 1;
    const prev = byTag.get(row.tag);
    if (!prev) {
      rows.push({
        rowNumber: row.rowNumber,
        tag: row.tag,
        action: 'create',
        custodianEmployeeId,
        custodyDepartmentId: custodyDepartmentId ?? null,
        parsed: { ...row, core: { ...row.core, status, quantity: qty } },
      });
      continue;
    }

    const same =
      prev.name === row.core.name &&
      prev.quantity === qty &&
      prev.location === (row.core.location || '') &&
      prev.custodianEmployeeId === custodianEmployeeId &&
      (status === null || prev.status === status);
    rows.push({
      rowNumber: row.rowNumber,
      tag: row.tag,
      action: same ? 'unchanged' : 'update',
      custodianEmployeeId,
      custodyDepartmentId: custodyDepartmentId ?? null,
      parsed: { ...row, core: { ...row.core, status, quantity: qty } },
    });

    // stash active field map on row via closure — used at confirm
    void activeFieldByKey;
  }

  const counts = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0 };
  for (const r of rows) counts[r.action] += 1;

  return {
    sheetName: parsed.sheetName,
    counts,
    issues,
    unresolvedCustodians: [...unresolvedCustodians].sort(),
    unresolvedDepartments: [...unresolvedDepartments].sort(),
    rows,
  };
}

export async function confirmPropertyImport(input: {
  actor: RegisterActor;
  buffer: Buffer;
  idempotencyKey: string;
  sourceWorkbook: string;
  /** blank cells do not clear existing values */
  clearBlankFields?: boolean;
}): Promise<
  | {
      ok: true;
      importBatchId: string;
      inventoryBatchId: string;
      counts: PropertyImportPreview['counts'];
    }
  | { ok: false; error: string }
> {
  if (!input.actor) return { ok: false, error: '請先登入' };
  if (!canMaintainRegister(input.actor)) return { ok: false, error: '沒有財產清冊維護權限' };

  const db = getDb();
  const [prior] = await db
    .select()
    .from(assetImportBatches)
    .where(eq(assetImportBatches.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (prior?.status === 'confirmed') {
    return {
      ok: true,
      importBatchId: prior.id,
      inventoryBatchId: prior.inventoryBatchId ?? '',
      counts: (prior.counts as PropertyImportPreview['counts']) ?? {
        create: 0,
        update: 0,
        unchanged: 0,
        skip: 0,
        fail: 0,
      },
    };
  }

  const preview = await buildPropertyImportPreview(input.buffer);
  const fieldDefs = await db
    .select({ id: assetFieldDefinitions.id, stableKey: assetFieldDefinitions.stableKey, status: assetFieldDefinitions.status, storageScope: assetFieldDefinitions.storageScope })
    .from(assetFieldDefinitions);
  const assetFieldIdByKey = new Map(
    fieldDefs.filter((f) => f.status === 'active' && f.storageScope === 'asset').map((f) => [f.stableKey, f.id])
  );
  const invFieldIdByKey = new Map(
    fieldDefs.filter((f) => f.status === 'active' && f.storageScope === 'inventory').map((f) => [f.stableKey, f.id])
  );

  const [invBatch] = await db
    .insert(assetInventoryBatches)
    .values({
      label: `盤點匯入 ${preview.sheetName}`,
      sourceWorkbook: input.sourceWorkbook,
      sourceSheet: preview.sheetName,
      status: 'open',
      createdByEmployeeId: input.actor.id,
      rowCount: 0,
    })
    .returning();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skip = 0;
  let fail = 0;
  let invLines = 0;

  for (const row of preview.rows) {
    if (row.action === 'skip') {
      skip += 1;
      continue;
    }
    if (row.action === 'fail') {
      fail += 1;
      continue;
    }
    if (row.action === 'unchanged') {
      unchanged += 1;
    }

    const p = row.parsed;
    const extraValues: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p.assetFields)) {
      const fid = assetFieldIdByKey.get(key);
      if (!fid) continue; // hidden/missing defs skipped — never auto-create
      if (val === undefined || val === null || val === '') {
        if (input.clearBlankFields) extraValues[fid] = null;
        continue;
      }
      extraValues[fid] = val;
    }

    const status = p.core.status && p.core.status !== 'invalid' ? p.core.status : 'in_custody';
    const qty = p.core.quantity && p.core.quantity > 0 ? p.core.quantity : 1;

    const [existing] = await db.select().from(assets).where(eq(assets.tag, row.tag)).limit(1);
    let assetId: string;
    if (existing) {
      const mergedExtra = { ...(existing.extraValues ?? {}) };
      for (const [k, v] of Object.entries(extraValues)) {
        if (v === null && !input.clearBlankFields) continue;
        if (v === null) delete mergedExtra[k];
        else mergedExtra[k] = v;
      }
      await db
        .update(assets)
        .set({
          name: p.core.name,
          quantity: qty,
          custodianEmployeeId: row.custodianEmployeeId!,
          custodyDepartmentId: row.custodyDepartmentId ?? existing.custodyDepartmentId,
          location: p.core.location || existing.location,
          status,
          remark: p.core.remark !== null && p.core.remark !== '' ? p.core.remark : existing.remark,
          itemKind: p.core.itemKind ?? existing.itemKind,
          description: p.core.description ?? existing.description,
          unit: p.core.unit ?? existing.unit,
          extraValues: mergedExtra,
          updatedAt: sql`now()`,
        })
        .where(eq(assets.id, existing.id));
      assetId = existing.id;
      if (row.action === 'update') updated += 1;
    } else {
      const [ins] = await db
        .insert(assets)
        .values({
          tag: row.tag,
          name: p.core.name,
          quantity: qty,
          custodianEmployeeId: row.custodianEmployeeId!,
          custodyDepartmentId: row.custodyDepartmentId ?? null,
          location: p.core.location || '',
          status,
          remark: p.core.remark,
          itemKind: p.core.itemKind,
          description: p.core.description,
          unit: p.core.unit,
          extraValues,
        })
        .returning({ id: assets.id });
      assetId = ins.id;
      created += 1;
    }

    const answers: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(p.inventory.answers)) {
      const fid = invFieldIdByKey.get(key);
      if (!fid) continue;
      answers[fid] = val;
    }
    await db
      .insert(assetInventoryLines)
      .values({
        batchId: invBatch.id,
        assetId,
        assetTag: row.tag,
        physicalQuantity: p.inventory.physicalQuantity,
        answers,
        sourceRow: row.rowNumber,
      })
      .onConflictDoUpdate({
        target: [assetInventoryLines.batchId, assetInventoryLines.assetTag],
        set: {
          assetId,
          physicalQuantity: p.inventory.physicalQuantity,
          answers,
          sourceRow: row.rowNumber,
          updatedAt: sql`now()`,
        },
      });
    invLines += 1;
  }

  await db
    .update(assetInventoryBatches)
    .set({ rowCount: invLines, updatedAt: sql`now()` })
    .where(eq(assetInventoryBatches.id, invBatch.id));

  const counts = { create: created, update: updated, unchanged, skip, fail };
  const [batch] = await db
    .insert(assetImportBatches)
    .values({
      idempotencyKey: input.idempotencyKey,
      sourceWorkbook: input.sourceWorkbook,
      sourceSheet: preview.sheetName,
      mapping: { mode: 'property_register_v1' },
      status: 'confirmed',
      counts,
      inventoryBatchId: invBatch.id,
      createdByEmployeeId: input.actor.id,
      confirmedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: assetImportBatches.idempotencyKey,
      set: {
        status: 'confirmed',
        counts,
        inventoryBatchId: invBatch.id,
        confirmedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  await recordAudit(db, {
    actorEmployeeId: input.actor.id,
    action: 'asset.property_import',
    entityType: 'asset_import_batch',
    entityId: batch.id,
    details: { counts, inventoryBatchId: invBatch.id, workbook: input.sourceWorkbook },
  });

  return { ok: true, importBatchId: batch.id, inventoryBatchId: invBatch.id, counts };
}
