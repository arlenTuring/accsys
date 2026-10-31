/**
 * 第 7 階段驗收（後端）：主動提醒與退回補件。拋棄式測試 DB＋真實 Gemini（補件對話）。
 * 瀏覽器部分見 acceptance/S7.md。
 *
 *   DATABASE_URL=…accsys_test STORAGE_LOCAL_PATH=<暫存目錄> npx tsx scripts/ai-accept-s7.ts --out report.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { and, eq, like, sql } from 'drizzle-orm';
import { attachStagedFilesToDraft } from '../src/lib/ai-chat/attach-staged';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { getDraftForOwner, submitApplicationDraft } from '../src/lib/ai-chat/drafts';
import { saveDraftFromPanel } from '../src/lib/ai-chat/draft-work';
import { describeEvent, pollLauncherEvents, type LauncherEvent } from '../src/lib/ai-chat/launcher-events';
import { executeNudge } from '../src/lib/ai-chat/nudge';
import { startResubmission } from '../src/lib/ai-chat/resubmit';
import { stageAiChatImage } from '../src/lib/ai-chat/staged-images';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { buildWelcomeSummary } from '../src/lib/ai-chat/welcome';
import { loadAssistantInbox } from '../src/lib/ai-chat/inbox';
import { runWithSessionToken, type CurrentEmployee } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import * as customService from '../src/lib/custom-forms/service';
import { getDb, getSql } from '../src/lib/db';
import { aiNudgeEvents, approvalSteps, attachments, auditEvents, formSubmissions, notifications } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const B = '20000000-0000-0000-0000-0000000000b1';
const C = '20000000-0000-0000-0000-000000000002';
const D = '20000000-0000-0000-0000-000000000004';
const asStaff = (id: string) => ({ id, role: 'staff' });

type Result = { case: string; ok: boolean; why: string };
const results: Result[] = [];
const record = (c: string, ok: boolean, why: string) => {
  results.push({ case: c, ok, why });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.padEnd(24)} ${why}`);
};

function loadAiSettingsOnly() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^(AI_CHAT_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function byNumber(suffix: string) {
  const [row] = await getDb()
    .select()
    .from(formSubmissions)
    .where(like(formSubmissions.formNumber, `%${suffix}`))
    .limit(1);
  return row;
}

async function drain(id: string, scope: 'fresh' | 'delivered', limit?: number) {
  const out: LauncherEvent[] = [];
  let after: string | null = null;
  let pages = 0;
  for (; pages < 40; pages++) {
    const r = await pollLauncherEvents({ actor: asStaff(id), scope, after, limit });
    out.push(...r.events);
    if (!r.hasMore) break;
    after = r.nextAfter;
  }
  return { events: out, pages: pages + 1 };
}

async function session(id: string) {
  const { token } = await createSession(getDb(), { employeeId: id, identityId: null, ttlMs: 3600_000 });
  return { token, employee: (await resolveSession(token)) as CurrentEmployee };
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  if (!process.env.STORAGE_LOCAL_PATH) throw new Error('STORAGE_LOCAL_PATH required');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;
  const db = getDb();
  await db.execute(sql`delete from rate_limit_buckets where bucket_key like ${'ai-chat:%'}`);
  await db.execute(sql`delete from ai_assistant_event_acks`);
  await db.execute(sql`delete from ai_nudge_events`);
  await db.delete(notifications).where(like(notifications.eventKey, 's7:%'));
  await db.execute(sql`update notifications set is_read = false where event_key like '%approval_requested%' and recipient_employee_id = ${C} and form_id in (select id from form_submissions where status = 'pending_approval')`);

  const sa = await session(A);
  const sc = await session(C);

  // 一輪重跑時，補件案例已把 BT0004 重新送出：先由 C 再退回，退回通知因此是真實流程產生。
  const b4Start = await byNumber('BT0004');
  if (b4Start.status === 'pending_approval') {
    const back = await customService.returnSubmissionStep({ id: C }, b4Start.id, '請補上客戶名稱與訪談對象（驗收重跑）', b4Start.version);
    if (!back.ok) throw new Error(`return: ${back.error}`);
  }

  // 1, 5：待簽通知內容，全部與原單比對
  const cAll = await drain(C, 'fresh');
  const b5 = await byNumber('BT0005');
  {
    const ev = cAll.events.find((e) => e.formId === b5.id)!;
    const d = b5.data as Record<string, string>;
    record('1-pending-content', Boolean(ev) && ev.body.includes('測試員工') && ev.body.includes(d.purpose) && ev.body.includes(d.tripStartAt.replace('T', ' ')), `「${ev?.title}」${ev?.body}`);
    let checked = 0;
    const wrong: string[] = [];
    for (const e of cAll.events) {
      const [s] = await db.select().from(formSubmissions).where(eq(formSubmissions.id, e.formId!));
      if (!s) continue;
      const data = s.data as Record<string, string>;
      checked += 1;
      if (data.purpose && !e.body.includes(data.purpose.slice(0, 50))) wrong.push(`${s.formNumber} 事由`);
      if (data.location && !e.body.includes(data.location)) wrong.push(`${s.formNumber} 地點`);
      if (s.totalAmount !== null && !e.body.includes(Number(s.totalAmount).toLocaleString('en-US'))) wrong.push(`${s.formNumber} 金額`);
      if (e.caseNumber !== s.formNumber) wrong.push(`${s.formNumber} 單號`);
    }
    record('5-facts-match-record', checked > 0 && wrong.length === 0, `比對 ${checked} 則提醒與原單：${wrong.length ? wrong.join('、') : '事由、地點、金額、單號全部一致'}`);
  }

  // 2：退回內容來自簽核紀錄
  const aAll = await drain(A, 'fresh');
  const b4 = await byNumber('BT0004');
  {
    const ev = aAll.events.find((e) => e.formId === b4.id && e.kind === 'request_returned');
    const [step] = await db.select({ comment: approvalSteps.comment }).from(approvalSteps).where(and(eq(approvalSteps.formId, b4.id), eq(approvalSteps.status, 'returned')));
    record('2-return-real-reason', Boolean(ev) && ev!.reason?.full === step.comment && ev!.canResubmit === true, `原因「${ev?.reason?.full}」與簽核紀錄${ev?.reason?.full === step.comment ? '相同' : '不同'}；補件入口 ${ev?.canResubmit}`);
  }

  // 3, 4：拒絕與未填理由
  {
    const facts = { label: '公出差旅申請單', formNumber: 'X', applicantId: A, applicantName: '測試員工', filerId: A, status: 'rejected', what: null, when: null, where: null, amount: null };
    const r = describeEvent({ type: 'request_returned', nudge: false, message: '', facts, reason: '不予核准', viewerId: A });
    record('3-reject-no-resubmit', r.kind === 'request_rejected' && r.canResubmit === false && !r.title.includes('退回'), `${r.title}；補件入口 ${r.canResubmit}（工作流程目前沒有拒絕狀態，以狀態值驗證）`);

    const [step] = await db.select({ id: approvalSteps.id, comment: approvalSteps.comment }).from(approvalSteps).where(and(eq(approvalSteps.formId, b4.id), eq(approvalSteps.status, 'returned')));
    await db.update(approvalSteps).set({ comment: null }).where(eq(approvalSteps.id, step.id));
    await db.insert(notifications).values({ recipientEmployeeId: A, type: 'request_returned', formType: 'custom', formId: b4.id, caseNumber: b4.formNumber, message: `${b4.formNumber} 已被退回：`, eventKey: `s7:no-reason:${randomUUID()}` });
    const ev = (await drain(A, 'fresh')).events.find((e) => e.eventKey.startsWith('s7:no-reason'));
    await db.update(approvalSteps).set({ comment: step.comment }).where(eq(approvalSteps.id, step.id));
    record('4-no-reason-honest', ev?.reason?.missing === true && ev.body.includes('退回時未提供原因'), ev?.body.replace('\n', '｜') ?? '沒有事件');
  }

  // 6：總數
  {
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from approval_steps s join form_submissions f on f.id = s.form_id
      where s.form_type = 'custom' and s.approver_employee_id = ${C} and s.status = 'pending' and f.status = 'pending_approval' and f.current_step_order = s.step_order`);
    const conv = await createConversation(C);
    const w = await runWithSessionToken(sc.token, () => buildWelcomeSummary(conv.id));
    record('6-total-beyond-page', n > 8 && w.pendingCount === n && w.text.includes(`${n} 張單待簽核`), `DB ${n} 張；歡迎訊息「${w.text.split('（')[0]}」`);
  }

  // 7：超過兩批、相同時間、晚提交
  {
    const at = new Date('2026-10-31T01:00:00.000Z');
    await db.insert(notifications).values(
      Array.from({ length: 95 }, (_, i) => ({ recipientEmployeeId: D, type: 'request_approved', formType: 'custom', formId: b5.id, caseNumber: b5.formNumber, message: `批次 ${i}`, eventKey: `s7:batch:${i}:${randomUUID()}`, createdAt: at }))
    );
    const first = await drain(D, 'fresh', 40);
    const keys = first.events.filter((e) => e.eventKey.startsWith('s7:batch')).map((e) => e.eventKey);
    const restored = await drain(D, 'delivered', 40);
    const rkeys = restored.events.filter((e) => e.eventKey.startsWith('s7:batch')).map((e) => e.eventKey);
    await db.insert(notifications).values({ recipientEmployeeId: D, type: 'request_approved', formType: 'custom', formId: b5.id, caseNumber: b5.formNumber, message: '較早時間、較晚提交', eventKey: `s7:late:${randomUUID()}`, createdAt: new Date('2026-01-01T00:00:00Z') });
    const late = await drain(D, 'fresh');
    record(
      '7-no-loss-across-pages',
      keys.length === 95 && new Set(keys).size === 95 && rkeys.length === 95 && new Set(rkeys).size === 95 && late.events.some((e) => e.eventKey.startsWith('s7:late')),
      `同時間 95 則：${first.pages} 頁取得 ${new Set(keys).size} 則不重複；重新載入還原 ${new Set(rkeys).size} 則；時間較早但晚提交的通知 ${late.events.length} 則也取得`
    );
  }

  // 8：重連、多裝置
  {
    const again = await drain(C, 'fresh');
    await db.insert(notifications).values({ recipientEmployeeId: C, type: 'approval_requested', formType: 'custom', formId: b5.id, caseNumber: b5.formNumber, message: '新事件', eventKey: `s7:two-devices:${randomUUID()}` });
    const [one, two] = await Promise.all([pollLauncherEvents({ actor: asStaff(C), scope: 'fresh' }), pollLauncherEvents({ actor: asStaff(C), scope: 'fresh' })]);
    const popped = one.events.length + two.events.length;
    record('8-reconnect-no-repeat', again.events.length === 0 && popped === 1, `重連再輪詢 ${again.events.length} 則；兩裝置同時輪詢共彈出 ${popped} 次`);
  }

  // 9：已讀不完成待辦
  {
    const before = await runWithSessionToken(sc.token, () => loadAssistantInbox(8));
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.recipientEmployeeId, C), eq(notifications.formId, b5.id)));
    const after = await runWithSessionToken(sc.token, () => loadAssistantInbox(8));
    const [{ status }] = await db.select({ status: approvalSteps.status }).from(approvalSteps).where(and(eq(approvalSteps.formId, b5.id), eq(approvalSteps.approverEmployeeId, C)));
    const restored = await drain(C, 'delivered');
    record('9-read-keeps-todo', before.pendingTotal === after.pendingTotal && status === 'pending' && !restored.events.some((e) => e.formId === b5.id), `已讀後待簽 ${before.pendingTotal} → ${after.pendingTotal}，簽核步驟仍 ${status}；該則不再提醒`);
  }

  // 10, 11：催簽
  {
    const noon = new Date('2030-03-10T04:00:00.000Z');
    const pair = await Promise.all(
      [1, 2].map(async () => {
        const s = await session(A);
        return runWithSessionToken(s.token, () => executeNudge({ formType: 'custom', formId: b5.id, now: noon }));
      })
    );
    const statuses = pair.map((r) => (r.ok ? r.status : `失敗:${r.error}`)).sort();
    const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from notifications where form_id = ${b5.id} and event_key like '%:nudge:2030-03-10'`);
    record('10-nudge-once-per-day', statuses.join() === 'already_today,notified' && n === 1, `兩裝置同時：${statuses.join('、')}；通知 ${n} 則`);

    const at = (iso: string) => runWithSessionToken(sa.token, () => executeNudge({ formType: 'custom', formId: b5.id, now: new Date(iso) }));
    const before = await at('2031-01-01T15:59:00.000Z'); // 台北 23:59
    const same = await at('2031-01-01T15:59:30.000Z');
    const next = await at('2031-01-01T16:01:00.000Z'); // 台北隔日 00:01
    const days = (await db.select({ d: aiNudgeEvents.businessDate }).from(aiNudgeEvents).where(eq(aiNudgeEvents.formId, b5.id))).map((r) => String(r.d)).sort();
    record(
      '11-day-boundary-taipei',
      before.ok && before.status === 'notified' && same.ok && same.status === 'already_today' && next.ok && next.status === 'notified' && before.businessDate === '2031-01-01' && next.businessDate === '2031-01-02',
      `23:59 ${before.ok && before.status}；同分鐘 ${same.ok && same.status}；00:01 ${next.ok && next.status}（${days.join('、')}）`
    );
    const others = await session(B);
    const denied = await runWithSessionToken(others.token, () => executeNudge({ formType: 'custom', formId: b5.id }));
    record('nudge-api-authz', !denied.ok, `B 直接呼叫：${denied.ok ? '成功!' : denied.error}`);
  }

  // 12：模型不可用
  {
    const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/nonexistent';
    const conv = await createConversation(A);
    const w = await runWithSessionToken(sa.token, () => buildWelcomeSummary(conv.id));
    const restored = await drain(A, 'delivered');
    if (saved === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
    const ev = restored.events.find((e) => e.formId === b4.id && e.kind === 'request_returned');
    record('12-no-model-needed', !w.loadError && Boolean(ev?.reason?.full), `憑證失效時：「${w.text.split('（')[0]}」；退回提醒仍有原因（摘要由原單產生，不呼叫模型）`);
  }

  // 補件：真實 Gemini 開草稿與修改，後端確定性送出
  {
    const conv = await createConversation(A);
    const turn = await runWithSessionToken(sa.token, () =>
      runAssistantTurn(sa.employee, { clientMessageId: randomUUID(), conversationId: conv.id, message: '我那張被退回的高雄公出申請要補件，把出差事由改成「[測試] 高雄客戶王小明需求訪談」。' })
    );
    const [draftRow] = await db.execute<{ id: string; version: number }>(sql`select id, version from ai_application_drafts where resubmit_of_submission_id = ${b4.id} and status = 'draft'`);
    const usedTools = turn.ok ? (turn.toolsUsed ?? []) : [];
    const draft = draftRow ? await getDraftForOwner(draftRow.id, A) : null;
    record(
      'resubmit-natural-language',
      Boolean(draft) && String(draft?.data.purpose).includes('王小明') && draft!.formVersionId === b4.versionId,
      `工具 ${usedTools.join('、')}；事由「${String(draft?.data.purpose)}」；沿用原單版本 ${draft?.formVersionId === b4.versionId}`
    );
    if (!draft) throw new Error('no resubmission draft');

    const reuse = await startResubmission({ ownerEmployeeId: A, submissionId: b4.id });
    const byB = await startResubmission({ ownerEmployeeId: B, submissionId: b4.id });
    const pending = await startResubmission({ ownerEmployeeId: A, submissionId: b5.id });
    record(
      'resubmit-authz',
      reuse.ok && reuse.draft.id === draft.id && !byB.ok && byB.code === 'not_found' && !pending.ok && pending.code === 'not_returned',
      `再開同一張 → 同一草稿 ${reuse.ok && reuse.draft.id === draft.id}；B：${byB.ok ? '成功!' : byB.code}；非退回單：${pending.ok ? '成功!' : pending.code}`
    );

    // 舊基準版本不能蓋掉原單
    const fresh = (await getDraftForOwner(draft.id, A))!;
    await db.update(formSubmissions).set({ version: sql`version + 1` }).where(eq(formSubmissions.id, b4.id));
    const stale = await runWithSessionToken(sa.token, () => submitApplicationDraft({ draftId: fresh.id, ownerEmployeeId: A, expectedVersion: fresh.version }));
    await db.update(formSubmissions).set({ version: sql`version - 1` }).where(eq(formSubmissions.id, b4.id));
    const staleStatus = (await byNumber('BT0004')).status;
    record('resubmit-stale-blocked', !stale.ok && staleStatus === 'returned', stale.ok ? '送出成功!' : `被擋：${stale.error}；原單仍 ${staleStatus}`);

    const before = (await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.formId, b4.id))).length;
    const staged = await stageAiChatImage({ ownerEmployeeId: A, conversationId: conv.id, clientAttachmentId: randomUUID(), fileName: 'invoice-match.jpg', bytes: readFileSync('tmp/ai-attachments/invoice-match.jpg') });
    if (!staged.ok) throw new Error(`stage: ${staged.error}`);
    const added = await attachStagedFilesToDraft({ actor: asStaff(A), conversationId: conv.id, draftId: fresh.id, expectedVersion: fresh.version, stagedIds: [staged.staged.id] });
    if (!added.ok) throw new Error(`attach: ${JSON.stringify(added)}`);
    const ready = (await getDraftForOwner(draft.id, A))!;
    const saved = await saveDraftFromPanel({ draftId: ready.id, ownerEmployeeId: A, expectedVersion: ready.version, data: ready.data });
    if (!saved.ok) throw new Error(`save: ${saved.error}`);

    const numbers = (await db.select({ id: formSubmissions.id }).from(formSubmissions)).length;
    const [r1, r2] = await runWithSessionToken(sa.token, () =>
      Promise.all([
        submitApplicationDraft({ draftId: ready.id, ownerEmployeeId: A, expectedVersion: saved.draft.version }),
        submitApplicationDraft({ draftId: ready.id, ownerEmployeeId: A, expectedVersion: saved.draft.version }),
      ])
    );
    const r3 = await runWithSessionToken(sa.token, () => submitApplicationDraft({ draftId: ready.id, ownerEmployeeId: A, expectedVersion: saved.draft.version }));
    const after = await byNumber('BT0004');
    const files = await db.select({ name: attachments.fileName }).from(attachments).where(eq(attachments.formId, b4.id));
    const count = (await db.select({ id: formSubmissions.id }).from(formSubmissions)).length;
    const audits = await db.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.entityId, b4.id));
    record(
      'resubmit-same-form',
      (r1.ok || r2.ok) && r3.ok && after.status === 'pending_approval' && after.formNumber === b4.formNumber && count === numbers && files.length === before + 1 && String((after.data as Record<string, unknown>).purpose).includes('王小明') && audits.filter((x) => x.action === 'custom.resubmitted').length >= 1,
      `3 次送出：同一單號 ${after.formNumber}，狀態 ${after.status}，單據總數不變；附件 ${before} → ${files.length}；稽核 custom.resubmitted`
    );
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
