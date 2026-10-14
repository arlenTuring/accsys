import { and, eq, sql } from 'drizzle-orm';
import { ASSET_STATUSES, MAX_LOCATION_LENGTH, type AssetStatus } from '@/lib/asset-transfers/constants';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { assetTransferItems, assetTransfers, assets, employees } from '@/lib/db/schema';
import { abort, fail, runInTransaction, type Failure, type Tx } from '@/lib/workflow/tx';

// Finance / admin maintain the register (財產保管清冊) directly; transfers
// change it through approved 資產異動申請單.

export type RegisterActor = { id: string; role: string } | null;

export type AssetInput = {
  tag: string;
  name: string;
  quantity: number;
  custodianEmployeeId: string;
  location: string;
  /** null keeps the current status (保管中 for a new asset). */
  status: AssetStatus | null;
  remark: string | null;
};

export type UpsertAssetResult = { ok: true; assetId: string; created: boolean } | Failure;

export function canMaintainRegister(actor: RegisterActor): boolean {
  return actor?.role === 'finance' || actor?.role === 'admin';
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
  return { ok: true, value: { ...input, tag, name, location, remark: remark || null } };
}

async function upsertInTx(tx: Tx, actorId: string, input: AssetInput): Promise<{ assetId: string; created: boolean }> {
  const cleaned = cleanAssetInput(input);
  if (!cleaned.ok) abort('validation', cleaned.error);
  const value = (cleaned as { ok: true; value: AssetInput }).value;
  const [custodian] = await tx
    .select({ id: employees.id, accessEnabled: employees.accessEnabled })
    .from(employees)
    .where(eq(employees.id, value.custodianEmployeeId));
  if (!custodian) abort('validation', '選取的保管人無效');

  const [existing] = await tx.select().from(assets).where(eq(assets.tag, value.tag)).for('update');
  const custodianChanges = !existing || existing.custodianEmployeeId !== value.custodianEmployeeId;
  // A departed custodian may stay on a row that already names them; nothing new is assigned to them.
  if (custodianChanges && !custodian!.accessEnabled) abort('validation', '保管人帳號已停用，無法指派為保管人');
  if (existing && custodianChanges) {
    const [pending] = await tx
      .select({ id: assetTransfers.id })
      .from(assetTransferItems)
      .innerJoin(assetTransfers, eq(assetTransfers.id, assetTransferItems.assetTransferId))
      .where(and(eq(assetTransferItems.assetId, existing.id), eq(assetTransfers.status, 'pending_approval')))
      .limit(1);
    if (pending) abort('conflict', `財產 ${value.tag} 有簽核中的資產異動申請單，請等該單完成後再修改保管人`);
  }
  const columns = {
    name: value.name,
    quantity: value.quantity,
    custodianEmployeeId: value.custodianEmployeeId,
    location: value.location,
    remark: value.remark,
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
      .values({ tag: value.tag, ...columns, status: value.status ?? 'in_custody' })
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
        ? { name: existing.name, quantity: existing.quantity, custodian: existing.custodianEmployeeId, location: existing.location, status: existing.status }
        : undefined,
      after: { ...columns, status: value.status ?? existing?.status ?? 'in_custody' },
    },
  });
  return { assetId, created: !existing };
}

export function upsertAsset(actor: RegisterActor, input: AssetInput): Promise<UpsertAssetResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  if (!canMaintainRegister(actor)) return Promise.resolve(fail('forbidden', '只有財會或管理員可以維護財產清冊'));
  return runInTransaction('asset.upsert', async (tx) => ({ ok: true as const, ...(await upsertInTx(tx, actor.id, input)) }));
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
