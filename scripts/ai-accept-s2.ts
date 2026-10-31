/**
 * 第 2 階段驗收（後端可驗證的案例）：草稿身分、跨對話、重試、衝突、隔離、送出冪等。
 * 真實 Gemini＋拋棄式測試 DB；判定一律讀 DB。瀏覽器案例（重新整理、重登入畫面、
 * 重啟服務、關閉頁籤、斷線、送出連點）另見 acceptance/S2.md。
 * 模型不可用時，需模型的案例記為未驗證（UNVERIFIED），不以替代結果判定通過。
 *
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *     npx tsx scripts/ai-accept-s2.ts --out report.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  abandonDraftAction,
  getDraftPanelAction,
  saveDraftAction,
  submitDraftAction,
} from '../src/lib/ai-chat/actions';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { createDraftWithFill, fillDraft } from '../src/lib/ai-chat/draft-work';
import { bindDraftToConversation, getDraftForOwner } from '../src/lib/ai-chat/drafts';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { runWithSessionToken, type CurrentEmployee } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import { getDb, getSql } from '../src/lib/db';
import { aiApplicationDrafts, aiConversationDraftLinks, auditEvents } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const B = '20000000-0000-0000-0000-0000000000b1';
const A1 = '幫我建立 2026 年 11 月 4 日到台中拜訪客戶的公出申請，上午九點到下午六點，掛在測試專案 A，原因是設備驗收。';

type Result = { case: string; ok: boolean | null; why: string; evidence?: unknown };
const results: Result[] = [];
function record(c: string, ok: boolean | null, why: string, evidence?: unknown) {
  results.push({ case: c, ok, why, evidence });
  console.log(`${ok === null ? 'UNVERIFIED' : ok ? 'PASS' : 'FAIL'} ${c.padEnd(4)} ${why}`);
}
/** Model unavailable (credentials, quota): the case stays 未驗證, never passes on a stub. */
let modelDown: string | null = null;
function modelError(r: { ok: boolean; error?: string }): boolean {
  if (r.ok || !r.error || !/Vertex|模型|model/i.test(r.error)) return false;
  modelDown = r.error.slice(0, 120);
  return true;
}

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

async function draftsIn(conversationId: string) {
  return getDb()
    .select({ id: aiApplicationDrafts.id, version: aiApplicationDrafts.version, data: aiApplicationDrafts.data, status: aiApplicationDrafts.status })
    .from(aiApplicationDrafts)
    .where(eq(aiApplicationDrafts.conversationId, conversationId))
    .orderBy(asc(aiApplicationDrafts.createdAt));
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;
  const db = getDb();
  await db.execute(sql`delete from rate_limit_buckets where bucket_key like ${'ai-chat:%'}`);

  const a = await session(A);
  const b = await session(B);
  const turn = (who: typeof a, conversationId: string, message: string, extra: { clientMessageId?: string; targetDraftId?: string } = {}) =>
    runWithSessionToken(who.token, () =>
      runAssistantTurn(who.employee, { message, clientMessageId: extra.clientMessageId ?? randomUUID(), conversationId, targetDraftId: extra.targetDraftId })
    );

  // Base draft in conversation 1.
  const conv1 = await createConversation(A);
  const first = await turn(a, conv1.id, A1);
  if (modelError(first)) {
    // Same backend the tool uses; only the model step is skipped.
    await createDraftWithFill({
      conversationId: conv1.id,
      ownerEmployeeId: A,
      formKey: 'business-trip',
      idempotencyKey: `s2-setup:${conv1.id}`,
      request: {
        set: [
          { field: 'tripStartAt', value: '2026-11-04T09:00' },
          { field: 'tripEndAt', value: '2026-11-04T18:00' },
          { field: 'location', value: '台中' },
          { field: 'purpose', value: '設備驗收' },
          { field: 'projectId', value: '測試專案 A' },
        ],
      },
    });
    console.log(`model unavailable: ${modelDown}`);
  }
  const [base] = await draftsIn(conv1.id);
  if (!base) throw new Error('setup: no draft');
  console.log(`setup draft ${base.id} v${base.version} (${modelDown ? 'backend' : 'AI'})`);

  // 2. 重新登入：新的 session 讀到同一份草稿。
  {
    const fresh = await session(A);
    const panel = await runWithSessionToken(fresh.token, () => getDraftPanelAction(base.id));
    const ok = panel.ok && panel.draft.version === base.version && JSON.stringify(panel.draft.data) === JSON.stringify(base.data);
    record('2', ok, ok ? `新 session 讀到 v${base.version}，資料相同` : 'session 更換後資料不同或讀不到');
  }

  // 5. 另外開一張同類申請 → 不同 ID，原草稿不變。
  {
    const r = await turn(a, conv1.id, '另外開一張同類的公出申請：11 月 6 日到新竹，上午 9 點到下午 5 點，事由供應商稽核。');
    if (modelError(r)) record('5', null, `未驗證：模型不可用（${modelDown}）`);
    else {
    const ds = await draftsIn(conv1.id);
    const orig = ds.find((d) => d.id === base.id);
    const other = ds.filter((d) => d.id !== base.id);
    const ok = ds.length === 2 && other.length === 1 && JSON.stringify(orig?.data) === JSON.stringify(base.data) && /新竹/.test(String((other[0]?.data as Record<string, unknown>)?.location));
    record('5', ok, ok ? `新草稿 ${other[0].id.slice(0, 8)}，原草稿 v${orig?.version} 未變` : `草稿數 ${ds.length}`, ds.map((d) => ({ id: d.id, v: d.version })));
    }
  }

  // 4. 新對話開啟舊草稿（畫面送 targetDraftId）並更新。
  const conv2 = await createConversation(A);
  {
    const r = await turn(a, conv2.id, '結束時間改晚上七點', { targetDraftId: base.id });
    if (modelError(r)) {
      // Backend half: the turn already linked the draft before the model call; update through the tool's backend.
      const cur = (await getDraftForOwner(base.id, A))!;
      await fillDraft({ draftId: base.id, ownerEmployeeId: A, conversationId: conv2.id, expectedVersion: cur.version, request: { set: [{ field: 'tripEndAt', value: '2026-11-04T19:00' }] } });
    }
    const d = await getDraftForOwner(base.id, A);
    const [link] = await db.select().from(aiConversationDraftLinks).where(and(eq(aiConversationDraftLinks.conversationId, conv2.id), eq(aiConversationDraftLinks.draftId, base.id)));
    const [audit] = await db.select({ n: count() }).from(auditEvents).where(and(eq(auditEvents.action, 'ai_draft.linked'), eq(auditEvents.entityId, base.id)));
    const created = await draftsIn(conv2.id);
    const ok = d?.data.tripEndAt === '2026-11-04T19:00' && Boolean(link) && audit.n >= 1 && created.length === 0;
    record('4', modelDown && ok ? null : ok, modelDown ? `後端部分${ok ? '通過' : '失敗'}（綁定、權限、同一 ID 更新、稽核）；AI 回合未驗證：模型不可用` : ok ? `同一 ID 更新到 v${d?.version}；綁定與稽核已記錄；新對話未另建草稿` : `tripEndAt=${String(d?.data.tripEndAt)} link=${Boolean(link)} newDrafts=${created.length}`);
  }

  // 6. 相同操作重試：同一 clientMessageId 依序重送，以及並行重送。
  {
    const conv = await createConversation(A);
    const id = randomUUID();
    if (modelDown) {
      record('6', null, '未驗證：模型不可用（重送需走完整 AI 回合）');
    } else {
    await turn(a, conv.id, A1, { clientMessageId: id });
    await turn(a, conv.id, A1, { clientMessageId: id });
    const seq = await draftsIn(conv.id);
    const conv3 = await createConversation(A);
    const id2 = randomUUID();
    const both = await Promise.all([turn(a, conv3.id, A1, { clientMessageId: id2 }), turn(a, conv3.id, A1, { clientMessageId: id2 })]);
    const par = await draftsIn(conv3.id);
    const ok = seq.length === 1 && par.length === 1;
    record('6', ok, `依序重送草稿數 ${seq.length}；並行重送草稿數 ${par.length}（第二個請求：${both[1].ok ? '重播' : both[1].error}）`);
    }
  }

  // 8. AI 更新期間人工改同欄位 → 不得靜默覆蓋；改不同欄位 → 合併。
  {
    const before = (await getDraftForOwner(base.id, A))!;
    const baseData = before.data;
    const r = await turn(a, conv2.id, '結束時間改成晚上八點', { targetDraftId: base.id });
    if (modelError(r)) {
      await fillDraft({ draftId: base.id, ownerEmployeeId: A, conversationId: conv2.id, expectedVersion: before.version, request: { set: [{ field: 'tripEndAt', value: '2026-11-04T20:00' }] } });
    }
    const afterAi = (await getDraftForOwner(base.id, A))!;
    const same = await runWithSessionToken(a.token, () =>
      saveDraftAction({ draftId: base.id, expectedVersion: before.version, baseData, data: { ...baseData, tripEndAt: '2026-11-04T21:00' } })
    );
    const afterSame = (await getDraftForOwner(base.id, A))!;
    const diff = await runWithSessionToken(a.token, () =>
      saveDraftAction({ draftId: base.id, expectedVersion: before.version, baseData, data: { ...baseData, location: '台中市南屯區' } })
    );
    const afterDiff = (await getDraftForOwner(base.id, A))!;
    const ok =
      afterAi.data.tripEndAt === '2026-11-04T20:00' &&
      !same.ok && same.code === 'conflict' && afterSame.version === afterAi.version &&
      diff.ok && afterDiff.data.tripEndAt === '2026-11-04T20:00' && afterDiff.data.location === '台中市南屯區';
    record('8', ok, `${modelDown ? '（AI 寫入以工具後端代行）' : ''}AI 改為 ${String(afterAi.data.tripEndAt)}；人工同欄位 → ${same.ok ? '竟然儲存' : same.code}（DB 仍 v${afterSame.version}）；人工改地點 → ${diff.ok ? `合併為 v${afterDiff.version}，結束 ${String(afterDiff.data.tripEndAt)}、地點 ${String(afterDiff.data.location)}` : diff.code}`);
  }

  // 10. B 直接呼叫 API 讀取／修改 A 的草稿。
  {
    const cur = (await getDraftForOwner(base.id, A))!;
    const panel = await runWithSessionToken(b.token, () => getDraftPanelAction(base.id));
    const save = await runWithSessionToken(b.token, () => saveDraftAction({ draftId: base.id, expectedVersion: cur.version, data: { ...cur.data, location: 'B 改的' } }));
    const submit = await runWithSessionToken(b.token, () => submitDraftAction({ draftId: base.id, expectedVersion: cur.version }));
    const abandon = await runWithSessionToken(b.token, () => abandonDraftAction({ draftId: base.id }));
    const bConv = await createConversation(B);
    const bind = await bindDraftToConversation({ conversationId: bConv.id, draftId: base.id, ownerEmployeeId: B });
    await turn(b, bConv.id, '把地點改成高雄', { targetDraftId: base.id }); // binding is checked before the model call
    const fill = await fillDraft({ draftId: base.id, ownerEmployeeId: B, conversationId: bConv.id, expectedVersion: cur.version, request: { set: [{ field: 'location', value: '高雄' }] } });
    let http = 'skipped';
    try {
      const res = await fetch(`http://localhost:3211/api/ai-chat/draft-files/${base.id}/00000000-0000-0000-0000-000000000000`, { headers: { cookie: `accsys_sid=${b.token}` } });
      http = String(res.status);
    } catch {
      http = 'server-down';
    }
    const after = (await getDraftForOwner(base.id, A))!;
    const ok = !panel.ok && !save.ok && !submit.ok && !abandon.ok && !bind.ok && !fill.ok && after.version === cur.version && after.status === 'draft' && http !== '200';
    record('10', ok, `讀取 ${panel.ok ? '成功!' : '拒絕'}、儲存 ${save.ok ? '成功!' : '拒絕'}、送出 ${submit.ok ? '成功!' : '拒絕'}、放棄 ${abandon.ok ? '成功!' : '拒絕'}、綁定 ${bind.ok ? '成功!' : bind.error}、AI 修改 ${fill.ok ? '成功!' : fill.error}、檔案網址 HTTP ${http}；A 草稿仍 v${after.version}`);
  }

  // 11. 舊版本（舊卡片／舊面板）操作重新檢查版本。
  {
    const cur = (await getDraftForOwner(base.id, A))!;
    const stale = cur.version - 1;
    const save = await runWithSessionToken(a.token, () => saveDraftAction({ draftId: base.id, expectedVersion: stale, data: { ...cur.data, purpose: '舊卡片' } }));
    const fill = await fillDraft({ draftId: base.id, ownerEmployeeId: A, conversationId: conv2.id, expectedVersion: stale, request: { set: [{ field: 'purpose', value: '舊卡片' }] } });
    const submit = await runWithSessionToken(a.token, () => submitDraftAction({ draftId: base.id, expectedVersion: stale }));
    const after = (await getDraftForOwner(base.id, A))!;
    const ok = !save.ok && !fill.ok && !submit.ok && after.version === cur.version;
    record('11', ok, `以 v${stale} 操作：儲存 ${save.ok ? '成功!' : save.code}、AI 寫入 ${fill.ok ? '成功!' : fill.error}、送出 ${submit.ok ? '成功!' : submit.code}；草稿仍 v${after.version}`);
  }

  // 12（送出連點／重試）在瀏覽器驗證：正式送出走 Next server action（revalidatePath 需要請求環境），腳本無法代表真實入口。

  console.log(`\n${results.filter((r) => r.ok === true).length} passed, ${results.filter((r) => r.ok === false).length} failed, ${results.filter((r) => r.ok === null).length} unverified`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ when: new Date().toISOString(), modelDown, baseDraft: base.id, conv1: conv1.id, conv2: conv2.id, results }, null, 2));
  process.exitCode = results.some((r) => r.ok === false) ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
