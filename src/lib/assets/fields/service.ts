import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { recordAudit } from '@/lib/audit/record';
import { getDb } from '@/lib/db';
import { assetFieldDefinitions, assets } from '@/lib/db/schema';
import type { CreateAssetFieldInput, UpdateAssetFieldInput, AssetFieldDefinitionDto } from './types';
import { countUnconvertibleDates, validateCreate, validateUpdate } from './validate';

export type FieldActor = { id: string };

function mapRow(r: typeof assetFieldDefinitions.$inferSelect, filledCount?: number): AssetFieldDefinitionDto {
  return {
    id: r.id,
    stableKey: r.stableKey,
    label: r.label,
    help: r.help,
    fieldType: r.fieldType as AssetFieldDefinitionDto['fieldType'],
    section: r.section as AssetFieldDefinitionDto['section'],
    sortOrder: r.sortOrder,
    required: r.required,
    showInList: r.showInList,
    searchable: r.searchable,
    filterable: r.filterable,
    exportable: r.exportable,
    status: r.status as AssetFieldDefinitionDto['status'],
    options: (r.options ?? []) as AssetFieldDefinitionDto['options'],
    viewPermission: r.viewPermission,
    editPermission: r.editPermission,
    systemBinding: r.systemBinding,
    storageScope: r.storageScope as 'asset' | 'inventory',
    version: r.version,
    hiddenAt: r.hiddenAt?.toISOString() ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    filledCount,
  };
}

export async function listAssetFieldDefinitions(opts?: {
  includeHidden?: boolean;
  includeDeleted?: boolean;
}): Promise<AssetFieldDefinitionDto[]> {
  const db = getDb();
  const rows = await db.select().from(assetFieldDefinitions).orderBy(asc(assetFieldDefinitions.sortOrder), asc(assetFieldDefinitions.label));
  return rows
    .filter((r) => {
      if (r.status === 'deleted' && !opts?.includeDeleted) return false;
      if (r.status === 'hidden' && !opts?.includeHidden) return false;
      return true;
    })
    .map((r) => mapRow(r));
}

export async function countFilledAssetValues(fieldId: string): Promise<number> {
  const db = getDb();
  const all = await db.select({ extraValues: assets.extraValues }).from(assets);
  let n = 0;
  for (const a of all) {
    const v = a.extraValues?.[fieldId];
    if (v !== undefined && v !== null && v !== '') n += 1;
  }
  return n;
}

export async function createAssetField(
  actor: FieldActor,
  input: CreateAssetFieldInput
): Promise<{ ok: true; field: AssetFieldDefinitionDto } | { ok: false; error: string }> {
  const cleaned = validateCreate(input);
  if (!cleaned.ok) return cleaned;
  const db = getDb();
  const [dupKey] = await db
    .select({ id: assetFieldDefinitions.id })
    .from(assetFieldDefinitions)
    .where(eq(assetFieldDefinitions.stableKey, cleaned.value.stableKey))
    .limit(1);
  if (dupKey) return { ok: false, error: '欄位 ID 已存在，請換一個名稱' };

  const [dupLabel] = await db
    .select({ id: assetFieldDefinitions.id })
    .from(assetFieldDefinitions)
    .where(
      and(
        eq(assetFieldDefinitions.label, cleaned.value.label),
        eq(assetFieldDefinitions.section, cleaned.value.section),
        ne(assetFieldDefinitions.status, 'deleted')
      )
    )
    .limit(1);
  if (dupLabel) return { ok: false, error: '同一區塊已有相同顯示名稱' };

  if (cleaned.value.required) {
    // New required fields must not break reading old assets — we allow create but
    // callers should surface missing-count; values remain optional until filled.
  }

  const [row] = await db
    .insert(assetFieldDefinitions)
    .values({
      stableKey: cleaned.value.stableKey,
      label: cleaned.value.label,
      help: cleaned.value.help ?? '',
      fieldType: cleaned.value.fieldType,
      section: cleaned.value.section,
      sortOrder: cleaned.value.sortOrder ?? 100,
      required: cleaned.value.required ?? false,
      showInList: cleaned.value.showInList ?? false,
      searchable: cleaned.value.searchable ?? false,
      filterable: cleaned.value.filterable ?? false,
      exportable: cleaned.value.exportable ?? true,
      options: cleaned.value.options ?? [],
      storageScope: cleaned.value.storageScope ?? 'asset',
      status: 'active',
      version: 1,
    })
    .returning();

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'asset_field.create',
    entityType: 'asset_field_definition',
    entityId: row.id,
    details: { stableKey: row.stableKey, label: row.label, fieldType: row.fieldType },
  });

  return { ok: true, field: mapRow(row) };
}

export async function updateAssetField(
  actor: FieldActor,
  input: UpdateAssetFieldInput
): Promise<
  | { ok: true; field: AssetFieldDefinitionDto }
  | { ok: false; error: string; code?: 'version_conflict'; field?: AssetFieldDefinitionDto; typeChangeImpact?: { unconvertible: number } }
> {
  const cleaned = validateUpdate(input);
  if (!cleaned.ok) return cleaned;
  const db = getDb();
  const [current] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, cleaned.value.id)).limit(1);
  if (!current || current.status === 'deleted') return { ok: false, error: '找不到欄位' };
  if (current.systemBinding) {
    // System-bound catalog fields: allow label/help/flags but not type/scope breakage via this path later.
  }
  if (current.version !== cleaned.value.expectedVersion) {
    return { ok: false, error: 'version_conflict', code: 'version_conflict', field: mapRow(current) };
  }

  let typeChangeImpact: { unconvertible: number } | undefined;
  if (cleaned.value.fieldType && cleaned.value.fieldType !== current.fieldType) {
    if (cleaned.value.fieldType === 'date' && current.fieldType === 'text') {
      const all = await db.select({ extraValues: assets.extraValues }).from(assets);
      const values = all.map((a) => a.extraValues?.[current.id]);
      const unconvertible = countUnconvertibleDates(values);
      typeChangeImpact = { unconvertible };
      if (unconvertible > 0) {
        return {
          ok: false,
          error: `有 ${unconvertible} 筆文字值無法轉成日期，請先清理或改用新欄位`,
          typeChangeImpact,
        };
      }
    } else if (current.fieldType !== cleaned.value.fieldType) {
      // Block silent truncating type changes for v1 except text→date when clean.
      const filled = await countFilledAssetValues(current.id);
      if (filled > 0) {
        return {
          ok: false,
          error: `此欄位已有 ${filled} 筆資料，不能直接改型別（請隱藏後新建，或先匯出清理）`,
        };
      }
    }
  }

  if (cleaned.value.label) {
    const [dupLabel] = await db
      .select({ id: assetFieldDefinitions.id })
      .from(assetFieldDefinitions)
      .where(
        and(
          eq(assetFieldDefinitions.label, cleaned.value.label),
          eq(assetFieldDefinitions.section, cleaned.value.section ?? current.section),
          ne(assetFieldDefinitions.id, current.id),
          ne(assetFieldDefinitions.status, 'deleted')
        )
      )
      .limit(1);
    if (dupLabel) return { ok: false, error: '同一區塊已有相同顯示名稱' };
  }

  const [row] = await db
    .update(assetFieldDefinitions)
    .set({
      label: cleaned.value.label ?? current.label,
      help: cleaned.value.help ?? current.help,
      fieldType: cleaned.value.fieldType ?? current.fieldType,
      section: cleaned.value.section ?? current.section,
      sortOrder: cleaned.value.sortOrder ?? current.sortOrder,
      required: cleaned.value.required ?? current.required,
      showInList: cleaned.value.showInList ?? current.showInList,
      searchable: cleaned.value.searchable ?? current.searchable,
      filterable: cleaned.value.filterable ?? current.filterable,
      exportable: cleaned.value.exportable ?? current.exportable,
      options: cleaned.value.options ?? current.options,
      version: sql`${assetFieldDefinitions.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(assetFieldDefinitions.id, current.id), eq(assetFieldDefinitions.version, cleaned.value.expectedVersion)))
    .returning();

  if (!row) {
    const [again] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, current.id)).limit(1);
    return { ok: false, error: 'version_conflict', code: 'version_conflict', field: again ? mapRow(again) : undefined };
  }

  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'asset_field.update',
    entityType: 'asset_field_definition',
    entityId: row.id,
    details: { version: row.version, label: row.label },
  });

  return { ok: true, field: mapRow(row) };
}

export async function hideAssetField(
  actor: FieldActor,
  input: { id: string; expectedVersion: number }
): Promise<{ ok: true; field: AssetFieldDefinitionDto } | { ok: false; error: string; code?: string; field?: AssetFieldDefinitionDto }> {
  const db = getDb();
  const [current] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, input.id)).limit(1);
  if (!current || current.status === 'deleted') return { ok: false, error: '找不到欄位' };
  if (current.systemBinding) return { ok: false, error: '系統必要欄位不可隱藏' };
  if (current.version !== input.expectedVersion) {
    return { ok: false, error: 'version_conflict', code: 'version_conflict', field: mapRow(current) };
  }
  const [row] = await db
    .update(assetFieldDefinitions)
    .set({
      status: 'hidden',
      hiddenAt: sql`now()`,
      hiddenByEmployeeId: actor.id,
      version: sql`${assetFieldDefinitions.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(assetFieldDefinitions.id, current.id), eq(assetFieldDefinitions.version, input.expectedVersion)))
    .returning();
  if (!row) return { ok: false, error: 'version_conflict', code: 'version_conflict' };
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'asset_field.hide',
    entityType: 'asset_field_definition',
    entityId: row.id,
    details: { label: row.label, version: row.version },
  });
  return { ok: true, field: mapRow(row) };
}

export async function restoreAssetField(
  actor: FieldActor,
  input: { id: string; expectedVersion: number }
): Promise<{ ok: true; field: AssetFieldDefinitionDto } | { ok: false; error: string; code?: string; field?: AssetFieldDefinitionDto }> {
  const db = getDb();
  const [current] = await db.select().from(assetFieldDefinitions).where(eq(assetFieldDefinitions.id, input.id)).limit(1);
  if (!current || current.status === 'deleted') return { ok: false, error: '找不到欄位' };
  if (current.status !== 'hidden') return { ok: false, error: '欄位不是隱藏狀態' };
  if (current.version !== input.expectedVersion) {
    return { ok: false, error: 'version_conflict', code: 'version_conflict', field: mapRow(current) };
  }
  const [row] = await db
    .update(assetFieldDefinitions)
    .set({
      status: 'active',
      hiddenAt: null,
      hiddenByEmployeeId: null,
      version: sql`${assetFieldDefinitions.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(assetFieldDefinitions.id, current.id), eq(assetFieldDefinitions.version, input.expectedVersion)))
    .returning();
  if (!row) return { ok: false, error: 'version_conflict', code: 'version_conflict' };
  await recordAudit(db, {
    actorEmployeeId: actor.id,
    action: 'asset_field.restore',
    entityType: 'asset_field_definition',
    entityId: row.id,
    details: { label: row.label, version: row.version },
  });
  return { ok: true, field: mapRow(row) };
}

export async function getActiveAssetFieldsForEditor(): Promise<AssetFieldDefinitionDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(assetFieldDefinitions)
    .where(and(eq(assetFieldDefinitions.status, 'active'), eq(assetFieldDefinitions.storageScope, 'asset'), isNull(assetFieldDefinitions.deletedAt)))
    .orderBy(asc(assetFieldDefinitions.sortOrder), asc(assetFieldDefinitions.label));
  return rows.map((r) => mapRow(r));
}
