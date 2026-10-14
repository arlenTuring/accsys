import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { escalateIfSelfManaged, generateAssetTransferChain } from '@/lib/asset-transfers/chain';
import { ACTIVE_ASSET_STATUSES, STATUS_AFTER_TRANSFER, type AssetStatus } from '@/lib/asset-transfers/constants';
import { checkCustodianCoverage, parseAssetTransferInput, type AssetTransferInput, type NormalizedAssetTransfer } from '@/lib/asset-transfers/validate';
import { recordAudit } from '@/lib/audit/record';
import { isUuid } from '@/lib/authz/forms';
import { assetTransferItems, assetTransfers, assets, budgetCodes, departments, employees, procurementCases } from '@/lib/db/schema';
import { FORM_LABELS } from '@/lib/procurement/form-registry';
import {
  abort,
  assertApplicantBeforeFirstDecision,
  assertVersion,
  claimIdempotencyKey,
  decideCurrentStep,
  fail,
  insertSteps,
  lockForm,
  notify,
  replaceSteps,
  runInTransaction,
  storeIdempotentResult,
  withdrawForm,
  type ActionResult,
  type Failure,
  type Tx,
  type TxHooks,
} from '@/lib/workflow/tx';

export type Actor = { id: string; departmentId: string } | null;
export type CreateAssetTransferInput = AssetTransferInput & { idempotencyKey: string };
export type EditAssetTransferInput = AssetTransferInput & { expectedVersion: number };
export type CreateResult = { ok: true; transferId: string; caseNumber: string; replayed?: boolean } | Failure;

const FORM = 'asset_transfer' as const;
const LABEL = FORM_LABELS[FORM];

function normalize(input: AssetTransferInput): NormalizedAssetTransfer {
  const parsed = parseAssetTransferInput(input);
  if (!parsed.ok) abort('validation', parsed.error);
  return parsed.value;
}

type AssetTransferPlan = NormalizedAssetTransfer & {
  originalManagerEmployeeId: string;
  newManagerEmployeeId: string;
  otherManagerEmployeeId: string | null;
};

/** Each 保管單位主管 is the manager of that custodian's department, read inside the transaction. */
async function withUnitManagers(tx: Tx, form: NormalizedAssetTransfer): Promise<AssetTransferPlan> {
  const custodians = [form.originalCustodianEmployeeId, form.newCustodianEmployeeId, form.otherCustodianEmployeeId].filter(
    (id): id is string => id !== null
  );
  if (!custodians.every(isUuid)) abort('validation', '選取的保管人無效');
  const rows = await tx
    .select({ id: employees.id, name: employees.name, managerId: departments.managerEmployeeId })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(inArray(employees.id, custodians));
  const managerOf = (custodianId: string): string => {
    const row = rows.find((r) => r.id === custodianId);
    if (!row) abort('validation', '選取的保管人無效或已停用');
    if (!row!.managerId) abort('validation', `${row!.name} 所屬部門尚未設定主管，無法送出簽核，請聯絡系統管理員`);
    return row!.managerId!;
  };
  return {
    ...form,
    originalManagerEmployeeId: managerOf(form.originalCustodianEmployeeId),
    newManagerEmployeeId: managerOf(form.newCustodianEmployeeId),
    otherManagerEmployeeId: form.otherCustodianEmployeeId ? managerOf(form.otherCustodianEmployeeId) : null,
  };
}

type AssetSnapshot = { id: string; tag: string; name: string; quantity: number; custodianEmployeeId: string; location: string };

/**
 * Checks every referenced row and locks the assets (two forms cannot claim the
 * same asset at once). Returns the register snapshot of each asset.
 */
async function resolveRefs(tx: Tx, form: AssetTransferPlan, excludeTransferId?: string): Promise<Map<string, AssetSnapshot>> {
  const deptIds = [...new Set([form.departmentId, form.useDepartmentId])];
  if (!deptIds.every(isUuid)) abort('validation', '選取的部門無效');
  const depts = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, deptIds));
  if (depts.length !== deptIds.length) abort('validation', '選取的部門無效');

  if (!isUuid(form.useBudgetCodeId)) abort('validation', '選取的使用專案/客戶名稱無效');
  const [code] = await tx.select({ id: budgetCodes.id }).from(budgetCodes).where(eq(budgetCodes.id, form.useBudgetCodeId));
  if (!code) abort('validation', '選取的使用專案/客戶名稱無效');

  const people = [
    form.originalCustodianEmployeeId,
    form.newCustodianEmployeeId,
    form.otherCustodianEmployeeId,
    form.originalManagerEmployeeId,
    form.newManagerEmployeeId,
    form.otherManagerEmployeeId,
    ...form.items.map((i) => i.newCustodianEmployeeId),
  ].filter((id): id is string => id !== null);
  const personIds = [...new Set(people)];
  if (!personIds.every(isUuid)) abort('validation', '選取的人員無效');
  const found = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(inArray(employees.id, personIds), eq(employees.accessEnabled, true)));
  if (found.length !== personIds.length) abort('validation', '選取的保管人或主管無效或已停用');

  const assetIds = form.items.map((i) => i.assetId);
  if (!assetIds.every(isUuid)) abort('validation', '選取的財產編號無效');
  const rows = await tx
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of assetIds) {
    const a = byId.get(id);
    if (!a) abort('validation', '選取的財產編號無效');
    if (!ACTIVE_ASSET_STATUSES.includes(a!.status as AssetStatus)) abort('validation', `財產 ${a!.tag} 已不在財產清冊中，無法異動`);
  }

  const busy = await tx
    .select({ tag: assetTransferItems.assetTag })
    .from(assetTransferItems)
    .innerJoin(assetTransfers, eq(assetTransfers.id, assetTransferItems.assetTransferId))
    .where(
      and(
        inArray(assetTransferItems.assetId, assetIds),
        eq(assetTransfers.status, 'pending_approval'),
        excludeTransferId ? ne(assetTransfers.id, excludeTransferId) : undefined
      )
    )
    .limit(1);
  if (busy.length > 0) abort('conflict', `財產 ${busy[0].tag} 已在另一張簽核中的${LABEL}，請等該單完成後再申請`);

  const coverage = checkCustodianCoverage(
    form,
    (id) => byId.get(id)!.custodianEmployeeId,
    (id) => byId.get(id)!.tag
  );
  if (coverage) abort('validation', coverage);
  return byId;
}

/** Never empty: someone other than the applicant always approves a register change. */
async function chainFor(tx: Tx, actorId: string, form: AssetTransferPlan) {
  const parties = { applicantEmployeeId: actorId, ...form };
  const top = await tx
    .select({ id: employees.id, isGeneralManager: employees.isGeneralManager, isChairman: employees.isChairman })
    .from(employees)
    .where(and(eq(employees.accessEnabled, true), or(eq(employees.isGeneralManager, true), eq(employees.isChairman, true))))
    .orderBy(asc(employees.createdAt), asc(employees.id));
  const chain = escalateIfSelfManaged(generateAssetTransferChain(parties), parties, {
    generalManagerEmployeeId: top.find((e) => e.isGeneralManager)?.id ?? null,
    chairmanEmployeeId: top.find((e) => e.isChairman)?.id ?? null,
  });
  if (!chain || chain.length === 0) abort('validation', '找不到申請人以外可簽核的主管，無法送出，請聯絡系統管理員');
  return chain!;
}

function headerColumns(form: AssetTransferPlan) {
  return {
    departmentId: form.departmentId,
    useDepartmentId: form.useDepartmentId,
    useBudgetCodeId: form.useBudgetCodeId,
    transferTypes: form.transferTypes,
    remark: form.remark,
    originalCustodianEmployeeId: form.originalCustodianEmployeeId,
    newCustodianEmployeeId: form.newCustodianEmployeeId,
    otherCustodianEmployeeId: form.otherCustodianEmployeeId,
    originalManagerEmployeeId: form.originalManagerEmployeeId,
    newManagerEmployeeId: form.newManagerEmployeeId,
    otherManagerEmployeeId: form.otherManagerEmployeeId,
  };
}

async function writeItems(tx: Tx, transferId: string, form: AssetTransferPlan, snapshots: Map<string, AssetSnapshot>) {
  await tx.insert(assetTransferItems).values(
    form.items.map((i, idx) => {
      const a = snapshots.get(i.assetId)!;
      return {
        assetTransferId: transferId,
        lineNo: idx + 1,
        assetId: a.id,
        assetTag: a.tag,
        assetName: a.name,
        quantity: a.quantity,
        originalCustodianEmployeeId: a.custodianEmployeeId,
        originalLocation: a.location,
        reason: i.reason,
        newCustodianEmployeeId: i.newCustodianEmployeeId,
        newLocation: i.newLocation,
      };
    })
  );
}

/**
 * Once the last step approved, writes the rows into the register. The register
 * must still match the snapshot taken at submission; otherwise the decision is
 * rolled back and the approver has to return the form.
 */
async function applyIfApproved(tx: Tx, transferId: string, actorId: string) {
  const [header] = await tx
    .select({ status: assetTransfers.status, appliedAt: assetTransfers.appliedAt })
    .from(assetTransfers)
    .where(eq(assetTransfers.id, transferId));
  if (header.status !== 'approved' || header.appliedAt) return;

  const rows = await tx
    .select()
    .from(assetTransferItems)
    .where(eq(assetTransferItems.assetTransferId, transferId))
    .orderBy(asc(assetTransferItems.lineNo));
  const current = await tx
    .select({ id: assets.id, custodianEmployeeId: assets.custodianEmployeeId, status: assets.status })
    .from(assets)
    .where(
      inArray(
        assets.id,
        rows.map((r) => r.assetId)
      )
    )
    .orderBy(asc(assets.id))
    .for('update');
  const changes = [];
  for (const row of rows) {
    const cur = current.find((c) => c.id === row.assetId);
    if (!cur || cur.custodianEmployeeId !== row.originalCustodianEmployeeId || !ACTIVE_ASSET_STATUSES.includes(cur.status as AssetStatus)) {
      abort('conflict', `財產 ${row.assetTag} 的保管資料已在送簽後變更，無法更新財產清冊，請退回申請人重新確認`);
    }
    const status = STATUS_AFTER_TRANSFER[row.reason as keyof typeof STATUS_AFTER_TRANSFER] ?? cur!.status;
    await tx
      .update(assets)
      .set({ custodianEmployeeId: row.newCustodianEmployeeId, location: row.newLocation, status, updatedAt: sql`now()` })
      .where(eq(assets.id, row.assetId));
    changes.push({
      assetId: row.assetId,
      tag: row.assetTag,
      from: { custodian: row.originalCustodianEmployeeId, location: row.originalLocation, status: cur!.status },
      to: { custodian: row.newCustodianEmployeeId, location: row.newLocation, status },
    });
  }
  await tx.update(assetTransfers).set({ appliedAt: sql`now()` }).where(eq(assetTransfers.id, transferId));
  await recordAudit(tx, { actorEmployeeId: actorId, action: `${FORM}.applied`, entityType: FORM, entityId: transferId, details: { changes } });
}

type Claimed = { ok: true; transferId: string; caseNumber: string };

export function createAssetTransfer(actor: Actor, input: CreateAssetTransferInput, hooks?: TxHooks): Promise<CreateResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料，請聯絡系統管理員'));
  const operation = `${FORM}.create`;
  return runInTransaction<Claimed & { replayed?: boolean }>(
    operation,
    async (tx, outbox) => {
      const { idempotencyKey, ...request } = input ?? ({} as CreateAssetTransferInput);
      const claim = await claimIdempotencyKey<Claimed>(tx, { actorId: actor.id, operation, key: idempotencyKey, request });
      if ('replay' in claim) return { ...claim.replay, replayed: true };

      const form = await withUnitManagers(tx, { ...normalize(request), departmentId: actor.departmentId });
      const snapshots = await resolveRefs(tx, form);
      const chain = await chainFor(tx, actor.id, form);
      const [{ caseNumber }] = await tx.execute<{ caseNumber: string }>(sql`select next_case_number() as "caseNumber"`);
      const [pcase] = await tx
        .insert(procurementCases)
        .values({ caseNumber, createdByEmployeeId: actor.id, caseType: FORM })
        .returning({ id: procurementCases.id });
      const [row] = await tx
        .insert(assetTransfers)
        .values({
          procurementCaseId: pcase.id,
          applicantEmployeeId: actor.id,
          ...headerColumns(form),
          status: 'pending_approval',
          currentStepOrder: 1,
        })
        .returning({ id: assetTransfers.id });
      await writeItems(tx, row.id, form, snapshots);
      await insertSteps(tx, FORM, row.id, chain);
      await notify(tx, outbox, {
        recipientEmployeeId: chain[0].approverEmployeeId,
        type: 'approval_requested',
        formType: FORM,
        formId: row.id,
        caseNumber,
        version: 1,
        message: `${LABEL} ${caseNumber} 待您簽核`,
      });
      await recordAudit(tx, {
        actorEmployeeId: actor.id,
        action: `${FORM}.created`,
        entityType: FORM,
        entityId: row.id,
        details: { caseNumber, transferTypes: form.transferTypes, lines: form.items.length },
      });
      const result: Claimed = { ok: true, transferId: row.id, caseNumber };
      await storeIdempotentResult(tx, { actorId: actor.id, operation, key: idempotencyKey, result });
      return result;
    },
    hooks
  );
}

async function lockOrFail(tx: Tx, id: string) {
  if (!isUuid(id)) abort('not_found', `找不到這張${LABEL}`);
  const form = await lockForm(tx, FORM, id);
  if (!form) abort('not_found', `找不到這張${LABEL}`);
  return form!;
}

export function approveAssetTransferStep(actor: Actor, id: string, expectedVersion: number, hooks?: TxHooks): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(
    `${FORM}.approve`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      assertVersion(form, expectedVersion);
      await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'approve' });
      await applyIfApproved(tx, form.id, actor.id);
      return { ok: true as const };
    },
    hooks
  );
}

export function returnAssetTransferStep(actor: Actor, id: string, reason: string, expectedVersion: number): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  if (typeof reason !== 'string' || reason.trim() === '') return Promise.resolve(fail('validation', '請填寫退回原因'));
  if (reason.length > 1000) return Promise.resolve(fail('validation', '退回原因過長'));
  return runInTransaction(`${FORM}.return`, async (tx, outbox) => {
    const form = await lockOrFail(tx, id);
    assertVersion(form, expectedVersion);
    await decideCurrentStep(tx, outbox, { formType: FORM, form, actorId: actor.id, decision: 'return', reason });
    return { ok: true as const };
  });
}

export function reviseAssetTransfer(
  actor: Actor,
  id: string,
  input: EditAssetTransferInput,
  mode: 'update' | 'resubmit',
  hooks?: TxHooks
): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction<{ ok: true }>(
    `${FORM}.${mode}`,
    async (tx, outbox) => {
      const form = await lockOrFail(tx, id);
      if (mode === 'update') {
        assertApplicantBeforeFirstDecision(form, actor.id, '修改', FORM);
      } else {
        if (form.applicantEmployeeId !== actor.id) abort('forbidden', `只有申請人可以重新送出這張${LABEL}`);
        if (form.status !== 'returned') abort('conflict', `只有被退回的${LABEL}可以重新送出`);
      }
      assertVersion(form, input?.expectedVersion);
      const next = await withUnitManagers(tx, { ...normalize(input), departmentId: form.departmentId });
      const snapshots = await resolveRefs(tx, next, id);
      const chain = await chainFor(tx, actor.id, next);

      const previousItems = await tx.select().from(assetTransferItems).where(eq(assetTransferItems.assetTransferId, id));
      await tx.delete(assetTransferItems).where(eq(assetTransferItems.assetTransferId, id));
      await writeItems(tx, id, next, snapshots);
      await tx.update(assetTransfers).set(headerColumns(next)).where(eq(assetTransfers.id, id));
      await replaceSteps(tx, outbox, {
        formType: FORM,
        form,
        chain,
        actorId: actor.id,
        action: `${FORM}.${mode === 'update' ? 'updated' : 'resubmitted'}`,
        previousItems,
        message: mode === 'update' ? `${LABEL} ${form.caseNumber} 已修改，待您簽核` : `${LABEL} ${form.caseNumber} 已重新送出，待您簽核`,
      });
      return { ok: true as const };
    },
    hooks
  );
}

export function withdrawAssetTransfer(actor: Actor, id: string): Promise<ActionResult> {
  if (!actor) return Promise.resolve(fail('unauthenticated', '找不到您的員工資料'));
  return runInTransaction(`${FORM}.withdraw`, async (tx) => {
    const form = await lockOrFail(tx, id);
    await withdrawForm(tx, { formType: FORM, form, actorId: actor.id });
    return { ok: true as const };
  });
}
