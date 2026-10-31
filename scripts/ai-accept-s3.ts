/**
 * 第 3 階段驗收（後端）：卡片動作與自然語言走同一服務、專案權限、卡片冪等與過期。
 * 卡片動作直接呼叫按鈕背後的同一組後端函式（block-actions）；自然語言用真實 Gemini。
 * 瀏覽器操作（只靠點選、重新整理、鍵盤、手機寬度）見 acceptance/S3.md。
 *
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *     npx tsx scripts/ai-accept-s3.ts --out report.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { buildChangeConfirmCard, chooseFormCard, confirmChangeCard, pickProjectCard, submitFieldFormCard } from '../src/lib/ai-chat/block-actions';
import { executeAiChatTool } from '../src/lib/ai-chat/tools';
import { appendMessage, createConversation, listMessages } from '../src/lib/ai-chat/conversations';
import { fillDraft } from '../src/lib/ai-chat/draft-work';
import { getDraftForOwner } from '../src/lib/ai-chat/drafts';
import { searchProjectsPaged } from '../src/lib/ai-chat/projects';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { runWithSessionToken, type CurrentEmployee } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import * as customService from '../src/lib/custom-forms/service';
import { getDb, getSql } from '../src/lib/db';
import { aiApplicationDrafts } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const B = '20000000-0000-0000-0000-0000000000b1';
const MGR = '20000000-0000-0000-0000-000000000002';
const PRJ_A = '30000000-0000-0000-0000-00000000000a';
const PRJ_X = '30000000-0000-0000-0000-00000000000c';

type Result = { case: string; ok: boolean; why: string };
const results: Result[] = [];
const record = (c: string, ok: boolean, why: string) => {
  results.push({ case: c, ok, why });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.padEnd(18)} ${why}`);
};

function loadAiSettingsOnly() {
  let text = '';
  try {
    text = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^(AI_CHAT_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function session(employeeId: string) {
  const { token } = await createSession(getDb(), { employeeId, identityId: null, ttlMs: 3600_000 });
  return { token, employee: (await resolveSession(token)) as CurrentEmployee };
}

/** A choice card listing business-trip, stored the way presentFormChoicesAction stores it. */
async function formChoiceCard(conversationId: string) {
  const id = `forms_${randomUUID().slice(0, 8)}`;
  await appendMessage({
    conversationId,
    ownerEmployeeId: A,
    role: 'model',
    contentText: '要建立哪一種單據？',
    blocks: [{ kind: 'choice', id, prompt: '選擇表單類型', options: [{ id: 'business-trip', label: '公出差旅申請單', value: 'business-trip' }], conversationId, status: 'open' }],
  });
  return id;
}

async function latestFieldForm(conversationId: string) {
  const { messages } = await listMessages(conversationId, A, 50);
  for (const m of [...messages].reverse()) {
    const b = (m.blocks as { kind: string; id: string; status: string; fields?: { id: string }[] }[]).find((x) => x.kind === 'field_form');
    if (b) return b;
  }
  return null;
}

const strip = (d: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== null && v !== ''));

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;
  await getDb().execute(sql`delete from rate_limit_buckets where bucket_key like ${'ai-chat:%'}`);
  const a = await session(A);

  // GUI：只靠卡片完成缺少專案、日期、代理人的公出單。
  const convGui = await createConversation(A);
  const choiceId = await formChoiceCard(convGui.id);
  const chosen = await chooseFormCard({ employeeId: A, conversationId: convGui.id, blockId: choiceId, optionId: 'business-trip' });
  const again = await chooseFormCard({ employeeId: A, conversationId: convGui.id, blockId: choiceId, optionId: 'business-trip' });
  const guiDrafts = await getDb().select({ id: aiApplicationDrafts.id }).from(aiApplicationDrafts).where(eq(aiApplicationDrafts.conversationId, convGui.id));
  record('choice-idempotent', chosen.ok && again.ok && Boolean(again.replayed) && guiDrafts.length === 1, `選表單兩次 → 草稿 ${guiDrafts.length} 張，第二次${again.ok && again.replayed ? '重播' : '未重播'}`);
  const card = await latestFieldForm(convGui.id);
  const fields = (card?.fields ?? []).map((f) => f.id);
  record('form-card-fields', ['tripStartAt', 'tripEndAt', 'location', 'purpose', 'projectId', 'jobProxyEmployeeId'].every((f) => fields.includes(f)), `卡片欄位：${fields.join(',')}`);
  const values = {
    tripStartAt: '2026-11-18T09:00',
    tripEndAt: '2026-11-18T17:30',
    location: '台南',
    purpose: '設備驗收',
    projectId: PRJ_A,
    jobProxyEmployeeId: MGR,
  };
  const [r1, r2] = await Promise.all([
    submitFieldFormCard({ employeeId: A, conversationId: convGui.id, blockId: card!.id, values }),
    submitFieldFormCard({ employeeId: A, conversationId: convGui.id, blockId: card!.id, values }),
  ]);
  const guiDraft = (await getDraftForOwner(guiDrafts[0].id, A))!;
  const okWrites = [r1, r2].filter((r) => r.ok && !r.replayed).length;
  record('form-card-double', okWrites === 1 && guiDraft.version === 2, `並行送出卡片兩次 → 實際寫入 ${okWrites} 次，草稿 v${guiDraft.version}`);
  record(
    'gui-only-draft',
    guiDraft.data.projectId === PRJ_A && guiDraft.data.jobProxyEmployeeId === MGR && guiDraft.data.tripStartAt === '2026-11-18T09:00',
    `DB：${JSON.stringify(strip(guiDraft.data))}`
  );

  // 自然語言：同一件事，DB 結果應一致。
  const convNl = await createConversation(A);
  const nl = await runWithSessionToken(a.token, () =>
    runAssistantTurn(a.employee, {
      clientMessageId: randomUUID(),
      conversationId: convNl.id,
      message: '幫我開公出申請：2026 年 11 月 18 日上午九點到下午五點半去台南做設備驗收，專案是測試專案 A，職務代理人是測試主管。',
    })
  );
  const [nlRow] = await getDb().select().from(aiApplicationDrafts).where(eq(aiApplicationDrafts.conversationId, convNl.id));
  const keys = ['tripStartAt', 'tripEndAt', 'location', 'projectId', 'jobProxyEmployeeId'];
  const nlData = (nlRow?.data ?? {}) as Record<string, unknown>;
  const diff = keys.filter((k) => JSON.stringify(nlData[k]) !== JSON.stringify(guiDraft.data[k]));
  const purposeOk = /設備驗收/.test(String(nlData.purpose ?? ''));
  record('gui-equals-nl', nl.ok && diff.length === 0 && purposeOk, diff.length || !purposeOk ? `不同欄位：${diff.join(',')}${purposeOk ? '' : ' purpose'}；NL=${JSON.stringify(strip(nlData))}` : '日期、地點、專案、代理人與卡片結果相同，事由含設備驗收');

  // 卡片過期：草稿在卡片之後被改，舊卡片不能寫入。
  const convStale = await createConversation(A);
  const choice2 = await formChoiceCard(convStale.id);
  const made = await chooseFormCard({ employeeId: A, conversationId: convStale.id, blockId: choice2, optionId: 'business-trip' });
  const card2 = await latestFieldForm(convStale.id);
  const d2 = (await getDraftForOwner((made as { draftId: string }).draftId, A))!;
  await fillDraft({ draftId: d2.id, ownerEmployeeId: A, conversationId: convStale.id, expectedVersion: d2.version, request: { set: [{ field: 'location', value: '高雄' }] } });
  const late = await submitFieldFormCard({ employeeId: A, conversationId: convStale.id, blockId: card2!.id, values: { location: '台北' } });
  const d2after = (await getDraftForOwner(d2.id, A))!;
  const lateCard = await latestFieldForm(convStale.id);
  record('stale-card', !late.ok && late.code === 'expired' && d2after.data.location === '高雄' && lateCard?.status === 'expired', `舊卡片送出 → ${late.ok ? '竟然成功' : late.code}；地點仍 ${String(d2after.data.location)}；卡片狀態 ${lateCard?.status}`);

  // 專案權限：A 搜不到也寫不進限制專案 X；B 可以。
  const aSearch = await searchProjectsPaged({ query: '測試', employeeId: A });
  const bSearch = await searchProjectsPaged({ query: '測試', employeeId: B });
  record('project-search', !aSearch.projects.some((p) => p.id === PRJ_X) && bSearch.projects.some((p) => p.id === PRJ_X), `A 結果 ${aSearch.projects.map((p) => p.code).join(',')}；B 結果 ${bSearch.projects.map((p) => p.code).join(',')}`);
  const dA = (await getDraftForOwner(guiDraft.id, A))!;
  const fillX = await fillDraft({ draftId: dA.id, ownerEmployeeId: A, conversationId: convGui.id, expectedVersion: dA.version, request: { set: [{ field: 'projectId', value: PRJ_X }] } });
  const xRejected = fillX.ok && fillX.rejected.some((r) => r.field === 'projectId') && fillX.saved.length === 0;
  const direct = await customService.createSubmission({ id: A }, 'business-trip', {
    data: { ...strip(dA.data), projectId: PRJ_X },
    fileCount: 0,
    idempotencyKey: `s3-direct-x-${randomUUID()}`,
  });
  record('project-write', xRejected && !direct.ok, `AI／卡片寫入 X → ${xRejected ? '拒絕' : '未拒絕'}；直接呼叫正式送出服務帶 X → ${direct.ok ? '竟然成功' : `拒絕（${(direct as { message?: string }).message ?? ''}）`}`);

  // 專案卡（最近專案與搜尋）：卡片選限制專案被拒，選合法專案寫入；同一卡片不能再用。
  {
    const conv = await createConversation(A);
    const ch = await formChoiceCard(conv.id);
    const made = (await chooseFormCard({ employeeId: A, conversationId: conv.id, blockId: ch, optionId: 'business-trip' })) as { draftId: string };
    const ctx = { conversationId: conv.id, ownerEmployeeId: A, actor: a.employee };
    const pp = await executeAiChatTool('propose_project_picker', { prompt: '請選擇專案', draft_id: made.draftId, field_id: 'projectId' }, ctx);
    const block = pp.blocks?.[0] as { id: string; draftVersion?: number } | undefined;
    await appendMessage({ conversationId: conv.id, ownerEmployeeId: A, role: 'model', contentText: '請選擇專案', blocks: pp.blocks ?? [] });
    const x = await pickProjectCard({ employeeId: A, conversationId: conv.id, blockId: block!.id, projectId: PRJ_X });
    const afterX = (await getDraftForOwner(made.draftId, A))!;
    const ppb = await executeAiChatTool('propose_project_picker', { prompt: '請選擇專案', draft_id: made.draftId, field_id: 'projectId' }, ctx);
    await appendMessage({ conversationId: conv.id, ownerEmployeeId: A, role: 'model', contentText: '請選擇專案', blocks: ppb.blocks ?? [] });
    const okPick = await pickProjectCard({ employeeId: A, conversationId: conv.id, blockId: (ppb.blocks![0] as { id: string }).id, projectId: PRJ_A });
    const reuse = await pickProjectCard({ employeeId: A, conversationId: conv.id, blockId: (ppb.blocks![0] as { id: string }).id, projectId: PRJ_A });
    const final = (await getDraftForOwner(made.draftId, A))!;
    record(
      'project-card',
      block?.draftVersion === 1 && !x.ok && x.code === 'invalid' && !afterX.data.projectId && okPick.ok && final.data.projectId === PRJ_A && reuse.ok && Boolean(reuse.replayed),
      `卡片帶版本 v${block?.draftVersion}；選 X → ${x.ok ? '寫入!' : `${x.code}：${x.error}`}；選 A → ${okPick.ok ? '寫入' : okPick.code}；同卡再點 → ${reuse.ok && reuse.replayed ? '重播' : '再次執行'}`
    );
  }

  // 修改差異確認：先預覽不寫入，確認才寫；過期卡片不寫。
  {
    const d = (await getDraftForOwner(guiDraft.id, A))!;
    const card = await buildChangeConfirmCard({ draftId: d.id, ownerEmployeeId: A, conversationId: convGui.id, set: [{ field: 'tripEndAt', value: '2026-11-18T19:00' }, { field: 'location', value: '台南市安平區' }], prompt: '確認修改？' });
    const afterPreview = (await getDraftForOwner(d.id, A))!;
    if (!card.ok) throw new Error(card.error);
    await appendMessage({ conversationId: convGui.id, ownerEmployeeId: A, role: 'model', contentText: '確認修改？', blocks: [card.block] });
    const yes = await confirmChangeCard({ employeeId: A, conversationId: convGui.id, blockId: card.block.id, accept: true });
    const afterYes = (await getDraftForOwner(d.id, A))!;
    const card2 = await buildChangeConfirmCard({ draftId: d.id, ownerEmployeeId: A, conversationId: convGui.id, set: [{ field: 'location', value: '嘉義' }], prompt: '再改？' });
    if (!card2.ok) throw new Error(card2.error);
    await appendMessage({ conversationId: convGui.id, ownerEmployeeId: A, role: 'model', contentText: '再改？', blocks: [card2.block] });
    await fillDraft({ draftId: d.id, ownerEmployeeId: A, conversationId: convGui.id, expectedVersion: afterYes.version, request: { set: [{ field: 'purpose', value: '設備驗收（更新）' }] } });
    const stale = await confirmChangeCard({ employeeId: A, conversationId: convGui.id, blockId: card2.block.id, accept: true });
    const afterStale = (await getDraftForOwner(d.id, A))!;
    const changes = card.block.kind === 'change_confirm' ? card.block.changes.map((c) => `${c.label}:${c.from}→${c.to}`).join('；') : '';
    record(
      'change-confirm',
      afterPreview.version === d.version && yes.ok && afterYes.data.tripEndAt === '2026-11-18T19:00' && !stale.ok && stale.code === 'expired' && afterStale.data.location === '台南市安平區',
      `預覽（${changes}）後 DB 仍 v${afterPreview.version}；確認 → v${afterYes.version}；過期卡片 → ${stale.ok ? '寫入!' : stale.code}，地點仍 ${String(afterStale.data.location)}`
    );
  }

  // 已核准單據摘要選擇：只列 A 自己已核准的單據。
  {
    const conv = await createConversation(A);
    const pick = await executeAiChatTool('propose_approved_document_picker', { form_key: 'business-trip' }, { conversationId: conv.id, ownerEmployeeId: A, actor: a.employee });
    const items = (pick.blocks?.[0] as { items?: { formNumber: string; status: string; summary?: string }[] } | undefined)?.items ?? [];
    const okItems = items.length === 3 && items.every((i) => i.status === 'approved');
    record('approved-picker', okItems, `候選 ${items.length} 張：${items.map((i) => `${i.formNumber} ${i.summary ?? ''}`.slice(0, 40)).join('／')}`);
  }

  // 真實模型：資訊不足時應出卡片（或提問），不得亂填。
  {
    const conv = await createConversation(A);
    const r = await runWithSessionToken(a.token, () => runAssistantTurn(a.employee, { clientMessageId: randomUUID(), conversationId: conv.id, message: '幫我開一張公出申請單' }));
    const kinds = r.ok ? (r.blocks ?? []).map((b) => b.kind) : [];
    const [row] = await getDb().select().from(aiApplicationDrafts).where(eq(aiApplicationDrafts.conversationId, conv.id));
    const filled = Object.keys(strip((row?.data ?? {}) as Record<string, unknown>));
    record('model-uses-card', r.ok && filled.length === 0 && (kinds.includes('field_form') || /時間|地點|事由/.test(r.reply)), `卡片：${kinds.join(',') || '無'}；草稿已填欄位：${filled.join(',') || '無'}；回覆：${r.ok ? r.reply.replace(/\s+/g, ' ').slice(0, 80) : r.error}`);
  }

  // 失敗回合留下說明（模型不可用時）：以錯誤的模型設定模擬。
  const convFail = await createConversation(A);
  const prevModel = process.env.AI_CHAT_MODEL;
  process.env.AI_CHAT_MODEL = 'model-that-does-not-exist';
  const failed = await runWithSessionToken(a.token, () => runAssistantTurn(a.employee, { clientMessageId: randomUUID(), conversationId: convFail.id, message: '測試：模型不可用時' }));
  process.env.AI_CHAT_MODEL = prevModel;
  const { messages: failMsgs } = await listMessages(convFail.id, A, 10);
  const note = failMsgs.find((m) => m.role === 'system' && /沒有處理完成/.test(m.contentText));
  record('failed-turn-note', !failed.ok && Boolean(note), note ? `已存系統說明：${note.contentText.slice(0, 60)}` : `回覆 ${failed.ok ? 'ok' : failed.error}，但沒有存說明`);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ when: new Date().toISOString(), guiDraft: guiDraft.id, nlDraft: nlRow?.id, results }, null, 2));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
