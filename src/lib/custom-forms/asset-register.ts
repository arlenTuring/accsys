import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ACTIVE_ASSET_STATUSES, STATUS_AFTER_TRANSFER, type AssetStatus, type AssetTransferType } from '@/lib/asset-transfers/constants';
import { checkCustodianCoverage } from '@/lib/asset-transfers/validate';
import { recordAudit } from '@/lib/audit/record';
import { assetTransferItems, assetTransfers, assets, formSubmissionAssetLines, formSubmissions } from '@/lib/db/schema';
import { abort, type Tx } from '@/lib/workflow/tx';
import type { AssetRegisterLink } from './schema';
import type { SubmissionData, TableValue } from './validate';

// Designer forms linked to the asset register (schema.assetRegister) work
// like the hard-coded 資產異動申請單: the assets are locked and checked on
// submit, a register snapshot of every row is kept while the form is pending
// (one pending form per asset, across both kinds of form), and the approved
// rows are written into the register only if it still matches the snapshot.

export type AssetLine = {
  lineNo: number;
  assetId: string;
  assetTag: string;
  assetName: string;
  quantity: number;
  originalCustodianEmployeeId: string;
  originalLocation: string;
  reason: AssetTransferType;
  newCustodianEmployeeId: string;
  newLocation: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Assets on another form that is still being approved (hard-coded or designer form). */
export async function busyAssetTag(tx: Tx, assetIds: string[], exclude: { submissionId?: string; transferId?: string }): Promise<string | null> {
  if (assetIds.length === 0) return null;
  const [legacy] = await tx
    .select({ tag: assetTransferItems.assetTag })
    .from(assetTransferItems)
    .innerJoin(assetTransfers, eq(assetTransfers.id, assetTransferItems.assetTransferId))
    .where(
      and(
        inArray(assetTransferItems.assetId, assetIds),
        eq(assetTransfers.status, 'pending_approval'),
        exclude.transferId ? ne(assetTransfers.id, exclude.transferId) : undefined
      )
    )
    .limit(1);
  if (legacy) return legacy.tag;
  const [custom] = await tx
    .select({ tag: formSubmissionAssetLines.assetTag })
    .from(formSubmissionAssetLines)
    .innerJoin(formSubmissions, eq(formSubmissions.id, formSubmissionAssetLines.submissionId))
    .where(
      and(
        inArray(formSubmissionAssetLines.assetId, assetIds),
        eq(formSubmissions.status, 'pending_approval'),
        exclude.submissionId ? ne(formSubmissions.id, exclude.submissionId) : undefined
      )
    )
    .limit(1);
  return custom?.tag ?? null;
}

/**
 * Locks the assets of the linked table and checks them; returns the register
 * snapshot of each row. `data` is already validated against the schema.
 */
export async function prepareAssetLines(tx: Tx, link: AssetRegisterLink, data: SubmissionData, submissionId?: string): Promise<AssetLine[]> {
  const rows = ((data[link.table] as TableValue | undefined)?.rows ?? []).map((r) => ({
    assetId: str(r[link.columns.asset]),
    reason: str(r[link.columns.reason]),
    newCustodianEmployeeId: str(r[link.columns.newCustodian]),
    newLocation: str(r[link.columns.newLocation]),
  }));
  if (rows.length === 0 || rows.some((r) => !r.assetId || !r.newCustodianEmployeeId || !r.newLocation)) {
    abort('validation', '請至少填寫一列財產資料');
  }
  if (rows.some((r) => !(r.reason in STATUS_AFTER_TRANSFER))) abort('validation', '異動原因不正確');

  const assetIds = rows.map((r) => r.assetId);
  const found = await tx
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      quantity: assets.quantity,
      custodianEmployeeId: assets.custodianEmployeeId,
      location: assets.location,
      status: assets.status,
    })
    .from(assets)
    .where(inArray(assets.id, assetIds))
    .orderBy(asc(assets.id))
    .for('update');
  const byId = new Map(found.map((a) => [a.id, a]));
  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) abort('validation', '選取的財產不存在');
    if (!ACTIVE_ASSET_STATUSES.includes(a!.status as AssetStatus)) abort('validation', `財產 ${a!.tag} 已不在財產清冊中，無法異動`);
  }

  const busy = await busyAssetTag(tx, assetIds, { submissionId });
  if (busy) abort('conflict', `財產 ${busy} 已在另一張簽核中的資產異動申請，請等該單完成後再申請`);

  const other = str(data[link.custodians.other ?? '']) || null;
  const coverage = checkCustodianCoverage(
    {
      items: rows.map((r) => ({ ...r, reason: r.reason as AssetTransferType })),
      originalCustodianEmployeeId: str(data[link.custodians.original]),
      newCustodianEmployeeId: str(data[link.custodians.new]),
      otherCustodianEmployeeId: other,
    },
    (id) => byId.get(id)!.custodianEmployeeId,
    (id) => byId.get(id)!.tag
  );
  if (coverage) abort('validation', coverage);

  return rows.map((r, i) => {
    const a = byId.get(r.assetId)!;
    return {
      lineNo: i + 1,
      assetId: a.id,
      assetTag: a.tag,
      assetName: a.name,
      quantity: a.quantity,
      originalCustodianEmployeeId: a.custodianEmployeeId,
      originalLocation: a.location,
      reason: r.reason as AssetTransferType,
      newCustodianEmployeeId: r.newCustodianEmployeeId,
      newLocation: r.newLocation,
    };
  });
}

export async function writeAssetLines(tx: Tx, submissionId: string, lines: AssetLine[]) {
  await tx.delete(formSubmissionAssetLines).where(eq(formSubmissionAssetLines.submissionId, submissionId));
  if (lines.length > 0) await tx.insert(formSubmissionAssetLines).values(lines.map((l) => ({ ...l, submissionId })));
}

/**
 * Once the submission is approved, writes its rows into the register. The
 * register must still match the snapshot; otherwise the decision is rolled
 * back and the approver has to return the form.
 */
export async function applyAssetLinesIfApproved(tx: Tx, submissionId: string, actorId: string) {
  const [header] = await tx
    .select({ status: formSubmissions.status })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.id, submissionId), isNull(formSubmissions.registerAppliedAt)));
  if (header?.status !== 'approved') return;
  const lines = await tx
    .select()
    .from(formSubmissionAssetLines)
    .where(eq(formSubmissionAssetLines.submissionId, submissionId))
    .orderBy(asc(formSubmissionAssetLines.lineNo));
  if (lines.length === 0) return;
  const current = await tx
    .select({ id: assets.id, custodianEmployeeId: assets.custodianEmployeeId, status: assets.status })
    .from(assets)
    .where(inArray(assets.id, lines.map((l) => l.assetId)))
    .orderBy(asc(assets.id))
    .for('update');
  const changes = [];
  for (const line of lines) {
    const cur = current.find((c) => c.id === line.assetId);
    if (!cur || cur.custodianEmployeeId !== line.originalCustodianEmployeeId || !ACTIVE_ASSET_STATUSES.includes(cur.status as AssetStatus)) {
      abort('conflict', `財產 ${line.assetTag} 的保管資料已在送簽後變更，無法更新財產清冊，請退回申請人重新確認`);
    }
    const status = STATUS_AFTER_TRANSFER[line.reason as AssetTransferType] ?? cur!.status;
    await tx
      .update(assets)
      .set({ custodianEmployeeId: line.newCustodianEmployeeId, location: line.newLocation, status, updatedAt: sql`now()` })
      .where(eq(assets.id, line.assetId));
    changes.push({
      assetId: line.assetId,
      tag: line.assetTag,
      from: { custodian: line.originalCustodianEmployeeId, location: line.originalLocation, status: cur!.status },
      to: { custodian: line.newCustodianEmployeeId, location: line.newLocation, status },
    });
  }
  await tx.update(formSubmissions).set({ registerAppliedAt: sql`now()` }).where(eq(formSubmissions.id, submissionId));
  await recordAudit(tx, { actorEmployeeId: actorId, action: 'custom.asset_register_applied', entityType: 'custom', entityId: submissionId, details: { changes } });
}
