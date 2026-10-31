import { and, eq, sql } from 'drizzle-orm';
import { allFields, isDisplayOnly, type FieldDef } from '@/lib/custom-forms/schema';
import { getDb } from '@/lib/db';
import { aiMessages, formSubmissions } from '@/lib/db/schema';
import { sanitizeBlocks, type AiMessageBlock, type FormCardField } from './blocks';
import { appendMessage, getOwnedConversation } from './conversations';
import { displayValue, planFill, type FillRequest } from './draft-fill';
import { createDraftWithFill, fillDraft, type DraftFillResult } from './draft-work';
import { loadDraftFormContext } from './drafts';
import { draftOpenResource, type OpenResourceEvent } from './open-resource';

/**
 * Cards in the chat (choices, field forms, project picks, change
 * confirmations) act through the same services as typed requests: drafts are
 * created with createDraftWithFill and changed with fillDraft, so validation,
 * permissions, version checks and audit are identical. A card is claimed
 * atomically in the stored message before anything runs, so a double click or
 * a re-sent event cannot act twice, and its outcome is saved with the card so
 * a reload shows the same state.
 */

export type CardActionResult =
  | { ok: true; replayed?: boolean; receipt: string; openResources?: OpenResourceEvent[]; block: AiMessageBlock }
  | { ok: false; code: 'not_found' | 'already_used' | 'expired' | 'invalid' | 'failed'; error: string; block?: AiMessageBlock };

type StoredCard = { messageId: string; block: Record<string, unknown> };

async function findCard(conversationId: string, blockId: string): Promise<StoredCard | null> {
  const rows = await getDb()
    .select({ id: aiMessages.id, blocks: aiMessages.blocks })
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), sql`${aiMessages.blocks} @> ${JSON.stringify([{ id: blockId }])}::jsonb`))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const block = (row.blocks as Record<string, unknown>[]).find((b) => b.id === blockId);
  return block ? { messageId: row.id, block } : null;
}

/** Atomically move a card from open to a new status; false when someone else already did. */
async function transition(messageId: string, blockId: string, from: string, patch: Record<string, unknown>): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select({ blocks: aiMessages.blocks }).from(aiMessages).where(eq(aiMessages.id, messageId)).for('update');
    if (!row) return false;
    const blocks = row.blocks as Record<string, unknown>[];
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i === -1 || (blocks[i].status ?? 'open') !== from) return false;
    const next = [...blocks];
    next[i] = { ...blocks[i], ...patch };
    await tx.update(aiMessages).set({ blocks: next }).where(eq(aiMessages.id, messageId));
    return true;
  });
}

function view(block: Record<string, unknown>, conversationId: string): AiMessageBlock {
  return sanitizeBlocks([block], conversationId)[0];
}

function receiptOf(r: Extract<DraftFillResult, { ok: true }>): string {
  const parts = [`已儲存「${r.formName}」草稿（版本 ${r.version}）`];
  if (r.saved.length) parts.push(`寫入：${r.saved.map((x) => `${x.label} ${x.value}`).join('、')}`);
  if (r.rejected.length) parts.push(`未寫入：${r.rejected.map((x) => `${x.label}（${x.message}）`).join('、')}`);
  parts.push(r.missing.length ? `尚缺必填：${r.missing.map((m) => m.label).join('、')}` : '必填已齊，可由您確認後送出');
  return `${parts.join('。')}。`;
}

/** Run a fill for a card; the card's own version is the expected version (stale cards never write). */
async function runFill(
  employeeId: string,
  conversationId: string,
  card: StoredCard,
  draftId: string,
  draftVersion: number,
  request: FillRequest,
  /** The person's side of the exchange, written from what was actually stored (names, not ids). */
  userText: (saved: { label: string; value: string }[]) => string
): Promise<CardActionResult> {
  const blockId = String(card.block.id);
  if (!(await transition(card.messageId, blockId, 'open', { status: 'answered', outcome: '處理中…' }))) {
    const again = await findCard(conversationId, blockId);
    return again && again.block.status === 'answered'
      ? { ok: true, replayed: true, receipt: String(again.block.outcome ?? '已處理'), block: view(again.block, conversationId) }
      : { ok: false, code: 'already_used', error: '這張卡片已用過或已過期。', block: again ? view(again.block, conversationId) : undefined };
  }
  const result = await fillDraft({ draftId, ownerEmployeeId: employeeId, conversationId, expectedVersion: draftVersion, request });
  if (!result.ok) {
    const expired = result.error === 'version_conflict';
    await transition(card.messageId, blockId, 'answered', {
      status: expired ? 'expired' : 'open',
      outcome: expired ? `草稿已更新到 v${result.version ?? '?'}，這張卡片已過期，沒有寫入。` : undefined,
    });
    const now = await findCard(conversationId, blockId);
    return { ok: false, code: expired ? 'expired' : 'failed', error: result.message, block: now ? view(now.block, conversationId) : undefined };
  }
  if (result.saved.length === 0 && result.rejected.length > 0) {
    // Nothing was stored: keep the card usable and say why.
    await transition(card.messageId, blockId, 'answered', { status: 'open', outcome: undefined });
    const now = await findCard(conversationId, blockId);
    return {
      ok: false,
      code: 'invalid',
      error: `沒有寫入：${result.rejected.map((x) => `${x.label}（${x.message}）`).join('、')}`,
      block: now ? view(now.block, conversationId) : undefined,
    };
  }
  const receipt = receiptOf(result);
  await transition(card.messageId, blockId, 'answered', { outcome: receipt, answeredVersion: result.version });
  await appendMessage({ conversationId, ownerEmployeeId: employeeId, role: 'user', contentText: userText(result.saved) });
  await appendMessage({
    conversationId,
    ownerEmployeeId: employeeId,
    role: 'model',
    // The receipt block carries the details; the work state gives the model the same facts next turn.
    contentText: '卡片內容已處理，結果如下：',
    blocks: [{ kind: 'action_result', id: `card_${blockId}_v${result.version}`, action: '卡片填寫', ok: result.rejected.length === 0, message: receipt }],
  });
  const now = await findCard(conversationId, blockId);
  return {
    ok: true,
    receipt,
    block: view(now!.block, conversationId),
    openResources: [draftOpenResource({ draftId, title: result.formName, version: result.version, operation: 'updated', formKey: result.formKey, status: 'draft' })],
  };
}

const CARD_TYPES: Partial<Record<FieldDef['type'], FormCardField['type']>> = {
  text: 'text',
  textarea: 'textarea',
  date: 'date',
  datetime: 'datetime',
  money: 'money',
  number: 'number',
  select: 'select',
  radio: 'select',
  employee: 'employee',
  project: 'project',
};

/** Build a field_form card for a draft from its schema (the model only names fields). */
export async function buildFieldFormCard(input: {
  draftId: string;
  ownerEmployeeId: string;
  conversationId: string;
  fieldIds: string[];
  prompt: string;
}): Promise<{ ok: true; block: AiMessageBlock } | { ok: false; error: string }> {
  const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
  if (!ctx) return { ok: false, error: 'not_found_or_forbidden' };
  const byId = new Map(allFields(ctx.schema).map((f) => [f.id, f]));
  const fields: FormCardField[] = [];
  for (const id of input.fieldIds.slice(0, 8)) {
    const f = byId.get(id);
    if (!f || isDisplayOnly(f)) continue;
    const type = CARD_TYPES[f.type];
    if (!type) continue;
    const options =
      f.type === 'select' || f.type === 'radio'
        ? f.options.map((o) => ({ value: o.value, label: o.label }))
        : f.type === 'employee'
          ? ctx.options.employees.map((e) => ({ value: e.id, label: e.label }))
          : undefined;
    const raw = ctx.draft.data[id];
    fields.push({
      id,
      label: f.label,
      type,
      required: f.required,
      options,
      current: raw === undefined || raw === null || raw === '' ? undefined : f.type === 'project' ? displayValue(f, raw, ctx.options) : String(raw),
    });
  }
  if (fields.length === 0) return { ok: false, error: 'no_fillable_fields' };
  const block: AiMessageBlock = {
    kind: 'field_form',
    id: `form_${input.draftId.slice(0, 8)}_v${ctx.draft.version}_${fields.map((f) => f.id).join('-').slice(0, 30)}`,
    prompt: input.prompt,
    conversationId: input.conversationId,
    draftId: input.draftId,
    draftVersion: ctx.draft.version,
    formName: ctx.name,
    fields,
    status: 'open',
  };
  return { ok: true, block };
}

/** Dry-run a change for a confirmation card: what would change, nothing written. */
export async function buildChangeConfirmCard(input: {
  draftId: string;
  ownerEmployeeId: string;
  conversationId: string;
  set: { field: string; value: string }[];
  prompt: string;
}): Promise<{ ok: true; block: AiMessageBlock; rejected: string[] } | { ok: false; error: string }> {
  const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
  if (!ctx) return { ok: false, error: 'not_found_or_forbidden' };
  const plan = planFill(ctx.schema, ctx.options, ctx.draft.data, { set: input.set }, ctx.today);
  const byId = new Map(allFields(ctx.schema).map((f) => [f.id, f]));
  const changes = plan.changed.map((id) => ({
    field: id,
    label: byId.get(id)?.label ?? id,
    from: displayValue(byId.get(id), ctx.draft.data[id], ctx.options),
    to: displayValue(byId.get(id), plan.data[id], ctx.options),
    value: String(plan.data[id] ?? ''),
  }));
  if (changes.length === 0) return { ok: false, error: plan.rejected.length ? plan.rejected.map((r) => `${r.label}：${r.message}`).join('；') : 'no_change' };
  return {
    ok: true,
    rejected: plan.rejected.map((r) => `${r.label}：${r.message}`),
    block: {
      kind: 'change_confirm',
      id: `confirm_${input.draftId.slice(0, 8)}_v${ctx.draft.version}_${changes.map((c) => c.field).join('-').slice(0, 30)}`,
      prompt: input.prompt,
      conversationId: input.conversationId,
      draftId: input.draftId,
      draftVersion: ctx.draft.version,
      formName: ctx.name,
      changes,
      status: 'open',
    },
  };
}

export async function submitFieldFormCard(input: {
  employeeId: string;
  conversationId: string;
  blockId: string;
  values: Record<string, string>;
}): Promise<CardActionResult> {
  if (!(await getOwnedConversation(input.employeeId, input.conversationId))) return { ok: false, code: 'not_found', error: '找不到對話。' };
  const card = await findCard(input.conversationId, input.blockId);
  if (!card || card.block.kind !== 'field_form') return { ok: false, code: 'not_found', error: '找不到這張卡片。' };
  const allowed = new Set((card.block.fields as { id: string }[]).map((f) => f.id));
  const set = Object.entries(input.values)
    .filter(([k, v]) => allowed.has(k) && typeof v === 'string' && v.trim() !== '')
    .map(([field, value]) => ({ field, value }));
  if (set.length === 0) return { ok: false, code: 'invalid', error: '請至少填一個欄位。' };
  return runFill(
    input.employeeId,
    input.conversationId,
    card,
    String(card.block.draftId),
    Number(card.block.draftVersion),
    { set },
    (saved) => `（卡片）填寫：${saved.map((x) => `${x.label} ${x.value}`).join('、') || '（沒有欄位變更）'}`
  );
}

export async function confirmChangeCard(input: { employeeId: string; conversationId: string; blockId: string; accept: boolean }): Promise<CardActionResult> {
  if (!(await getOwnedConversation(input.employeeId, input.conversationId))) return { ok: false, code: 'not_found', error: '找不到對話。' };
  const card = await findCard(input.conversationId, input.blockId);
  if (!card || card.block.kind !== 'change_confirm') return { ok: false, code: 'not_found', error: '找不到這張卡片。' };
  const changes = card.block.changes as { field: string; label: string; to: string; value: string }[];
  if (!input.accept) {
    if (!(await transition(card.messageId, input.blockId, 'open', { status: 'answered', outcome: '已取消，草稿沒有變更。' }))) {
      return { ok: false, code: 'already_used', error: '這張卡片已用過或已過期。' };
    }
    await appendMessage({ conversationId: input.conversationId, ownerEmployeeId: input.employeeId, role: 'user', contentText: '（卡片）取消這些修改' });
    const now = await findCard(input.conversationId, input.blockId);
    return { ok: true, receipt: '已取消，草稿沒有變更。', block: view(now!.block, input.conversationId) };
  }
  return runFill(
    input.employeeId,
    input.conversationId,
    card,
    String(card.block.draftId),
    Number(card.block.draftVersion),
    { set: changes.map((c) => ({ field: c.field, value: c.value })) },
    () => `（卡片）確認修改：${changes.map((c) => `${c.label} → ${c.to}`).join('、')}`
  );
}

/** Project picked in a project_picker card: written through the same fill path (permission via the form's legal choices). */
export async function pickProjectCard(input: { employeeId: string; conversationId: string; blockId: string; projectId: string }): Promise<CardActionResult> {
  if (!(await getOwnedConversation(input.employeeId, input.conversationId))) return { ok: false, code: 'not_found', error: '找不到對話。' };
  const card = await findCard(input.conversationId, input.blockId);
  if (!card || card.block.kind !== 'project_picker') return { ok: false, code: 'not_found', error: '找不到這張卡片。' };
  const draftId = typeof card.block.draftId === 'string' ? card.block.draftId : null;
  if (!draftId || typeof card.block.draftVersion !== 'number') return { ok: false, code: 'invalid', error: '這張卡片沒有指定草稿。' };
  const fieldId = typeof card.block.fieldId === 'string' ? card.block.fieldId : 'projectId';
  return runFill(input.employeeId, input.conversationId, card, draftId, card.block.draftVersion, { set: [{ field: fieldId, value: input.projectId }] }, (saved) =>
    saved.length ? `（卡片）選擇專案：${saved.map((x) => x.value).join('、')}` : '（卡片）選擇專案'
  );
}

/**
 * One-time carry-over from an approved 公出差旅申請單 into a 差旅報支單 draft:
 * a confirmation card (no write until the person confirms). Later changes to
 * the source do not touch the draft. Null when there is nothing to offer.
 */
export async function buildTripCarryOverCard(input: {
  draftId: string;
  ownerEmployeeId: string;
  conversationId: string;
  sourceData: Record<string, unknown>;
  sourceFormNumber: string;
}): Promise<AiMessageBlock | null> {
  const ctx = await loadDraftFormContext(input.draftId, input.ownerEmployeeId);
  if (!ctx || ctx.formKey !== 'travel-expense') return null;
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');
  const wanted = [
    { field: 'tripStartDate', value: day(input.sourceData.tripStartAt) },
    { field: 'tripEndDate', value: day(input.sourceData.tripEndAt) },
    { field: 'purpose', value: typeof input.sourceData.purpose === 'string' ? input.sourceData.purpose : '' },
    { field: 'tripOrderNo', value: input.sourceFormNumber },
  ].filter((w) => w.value);
  const card = await buildChangeConfirmCard({
    draftId: input.draftId,
    ownerEmployeeId: input.ownerEmployeeId,
    conversationId: input.conversationId,
    set: wanted,
    prompt: `要把公出單 ${input.sourceFormNumber} 的資料帶入這張報支單嗎？（只帶入一次）`,
  });
  return card.ok ? card.block : null;
}

/** After an approved trip PDF landed on a 差旅報支單 draft: post the carry-over offer in the chat. */
export async function offerTripCarryOver(input: {
  draftId: string;
  ownerEmployeeId: string;
  conversationId: string;
  sourceFormId: string;
  sourceFormNumber: string;
}): Promise<void> {
  const [source] = await getDb().select({ data: formSubmissions.data }).from(formSubmissions).where(eq(formSubmissions.id, input.sourceFormId)).limit(1);
  const card = await buildTripCarryOverCard({ ...input, sourceData: (source?.data ?? {}) as Record<string, unknown> });
  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: input.ownerEmployeeId,
    role: 'model',
    contentText: `已把核准單 ${input.sourceFormNumber} 的 PDF 加入草稿（固定版本）。`,
    blocks: card ? [card] : [],
  });
}

/** Form type picked in a choice card: a new draft (same create path as typed requests) plus a card for its key fields. */
export async function chooseFormCard(input: {
  employeeId: string;
  conversationId: string;
  blockId: string;
  optionId: string;
}): Promise<CardActionResult & { draftId?: string }> {
  if (!(await getOwnedConversation(input.employeeId, input.conversationId))) return { ok: false, code: 'not_found', error: '找不到對話。' };
  const card = await findCard(input.conversationId, input.blockId);
  if (!card || card.block.kind !== 'choice') return { ok: false, code: 'not_found', error: '找不到這張卡片。' };
  const option = (card.block.options as { id: string; label: string; value: string }[]).find((o) => o.id === input.optionId);
  if (!option) return { ok: false, code: 'invalid', error: '選項不存在。' };
  if (!(await transition(card.messageId, input.blockId, 'open', { status: 'answered', selectedOptionId: option.id }))) {
    const again = await findCard(input.conversationId, input.blockId);
    return again?.block.selectedOptionId === option.id
      ? { ok: true, replayed: true, receipt: `已選擇「${option.label}」`, block: view(again.block, input.conversationId) }
      : { ok: false, code: 'already_used', error: '這張卡片已用過。' };
  }
  await appendMessage({ conversationId: input.conversationId, ownerEmployeeId: input.employeeId, role: 'user', contentText: `選擇：${option.label}` });
  const created = await createDraftWithFill({
    conversationId: input.conversationId,
    ownerEmployeeId: input.employeeId,
    formKey: option.value,
    request: {},
    idempotencyKey: `card:${input.blockId}:${option.value}`,
  });
  const now = await findCard(input.conversationId, input.blockId);
  if (!created.ok) {
    return { ok: true, receipt: `已選擇「${option.label}」`, block: view(now!.block, input.conversationId) };
  }
  // Ask for the required fields (and project / proxy when the form has them) in one card.
  const ctx = await loadDraftFormContext(created.draftId, input.employeeId);
  const keyFields = ctx
    ? allFields(ctx.schema)
        .filter((f) => !isDisplayOnly(f) && CARD_TYPES[f.type] && (f.required || f.type === 'project' || f.type === 'employee'))
        .map((f) => f.id)
    : [];
  const form = await buildFieldFormCard({
    draftId: created.draftId,
    ownerEmployeeId: input.employeeId,
    conversationId: input.conversationId,
    fieldIds: keyFields,
    prompt: '請填寫以下欄位（可直接點選或輸入）：',
  });
  const receipt = `已建立「${created.formName}」草稿（版本 ${created.version}）。`;
  await appendMessage({
    conversationId: input.conversationId,
    ownerEmployeeId: input.employeeId,
    role: 'model',
    contentText: receipt,
    blocks: [
      { kind: 'draft_reference', id: `draft_${created.draftId}`, draftId: created.draftId, formKey: created.formKey, formName: created.formName, version: created.version, status: 'draft' },
      ...(form.ok ? [form.block] : []),
    ],
  });
  return {
    ok: true,
    receipt,
    draftId: created.draftId,
    block: view(now!.block, input.conversationId),
    openResources: [draftOpenResource({ draftId: created.draftId, title: created.formName, version: created.version, operation: 'created', formKey: created.formKey, status: 'draft' })],
  };
}

/** A fresh copy of an expired field_form card against the draft's current version. */
export async function refreshFieldFormCard(input: { employeeId: string; conversationId: string; blockId: string }): Promise<CardActionResult> {
  if (!(await getOwnedConversation(input.employeeId, input.conversationId))) return { ok: false, code: 'not_found', error: '找不到對話。' };
  const card = await findCard(input.conversationId, input.blockId);
  if (!card || card.block.kind !== 'field_form' || card.block.status !== 'expired') return { ok: false, code: 'not_found', error: '只有已過期的卡片可以重新產生。' };
  const fresh = await buildFieldFormCard({
    draftId: String(card.block.draftId),
    ownerEmployeeId: input.employeeId,
    conversationId: input.conversationId,
    fieldIds: (card.block.fields as { id: string }[]).map((f) => f.id),
    prompt: String(card.block.prompt),
  });
  if (!fresh.ok) return { ok: false, code: 'failed', error: '無法重新產生卡片。' };
  await appendMessage({ conversationId: input.conversationId, ownerEmployeeId: input.employeeId, role: 'model', contentText: '已依最新版本重新產生卡片。', blocks: [fresh.block] });
  return { ok: true, receipt: '已依最新版本重新產生卡片。', block: fresh.block };
}
