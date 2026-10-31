/**
 * 第 6 階段驗收（後端）：核准單 PDF 夾帶。真實 Gemini＋拋棄式測試 DB。
 * 送出後簽核者預覽在瀏覽器驗證（acceptance/S6.md）。
 *
 *   DATABASE_URL=…accsys_test STORAGE_LOCAL_PATH=<暫存目錄> npx tsx scripts/ai-accept-s6.ts --out report.json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { and, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { getOrCreateApprovedPdfSnapshot, readSnapshotBytes } from '../src/lib/ai-chat/approved-pdf';
import { attachApprovedSnapshotToDraft, listDraftSnapshots } from '../src/lib/ai-chat/attach-approved';
import { buildTripCarryOverCard, confirmChangeCard } from '../src/lib/ai-chat/block-actions';
import { appendMessage, createConversation } from '../src/lib/ai-chat/conversations';
import { createDraftWithFill, saveDraftFromPanel } from '../src/lib/ai-chat/draft-work';
import { getDraftForOwner, submitApplicationDraft } from '../src/lib/ai-chat/drafts';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { ensurePreviewDerivative } from '../src/lib/attachments/derivatives';
import { canAccessApprovedSnapshot, readPreviewFor } from '../src/lib/attachments/preview-access';
import { uploadAttachmentFor } from '../src/lib/attachments/service';
import { runWithSessionToken, type CurrentEmployee } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import { getDb, getSql } from '../src/lib/db';
import { aiApplicationDrafts, attachments, formSubmissions } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const B = '20000000-0000-0000-0000-0000000000b1';
const actorA = { id: A, role: 'staff' };
const actorB = { id: B, role: 'staff' };
const actorC = { id: '20000000-0000-0000-0000-000000000002', role: 'staff' };

type Result = { case: string; ok: boolean; why: string };
const results: Result[] = [];
const record = (c: string, ok: boolean, why: string) => {
  results.push({ case: c, ok, why });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.padEnd(22)} ${why}`);
};

function loadAiSettingsOnly() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^(AI_CHAT_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += c.items.map((x) => ('str' in x ? x.str : '')).join('');
  }
  return { text, pages: doc.numPages };
}

async function byNumber(suffix: string) {
  const rows = await getDb().select({ id: formSubmissions.id, n: formSubmissions.formNumber, status: formSubmissions.status, version: formSubmissions.version }).from(formSubmissions);
  return rows.find((r) => r.n.endsWith(suffix))!;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  if (!process.env.STORAGE_LOCAL_PATH) throw new Error('STORAGE_LOCAL_PATH required');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;
  await getDb().execute(sql`delete from rate_limit_buckets where bucket_key like ${'ai-chat:%'}`);
  const { token } = await createSession(getDb(), { employeeId: A, identityId: null, ttlMs: 3600_000 });
  const employee = (await resolveSession(token)) as CurrentEmployee;

  // 固定句子（真實 Gemini）
  const conv = await createConversation(A);
  const turn = await runWithSessionToken(token, () =>
    runAssistantTurn(employee, { clientMessageId: randomUUID(), conversationId: conv.id, message: '找出我已核准的台中公出申請，讓我選一張加入新的差旅報支單。' })
  );
  const blocks = turn.ok ? turn.blocks ?? [] : [];
  const picker = blocks.find((b) => b.kind === 'document_picker') as { items: { formNumber: string; summary: string; status: string; formId: string }[]; targetDraftId?: string } | undefined;
  const nums = (picker?.items ?? []).map((i) => i.formNumber);
  const [nlDraft] = await getDb().select().from(aiApplicationDrafts).where(eq(aiApplicationDrafts.conversationId, conv.id));
  record(
    'nl-picker',
    Boolean(picker) && nums.length === 2 && picker!.items.every((i) => /台中/.test(i.summary) && i.status === 'approved') && nlDraft?.formDefinitionKey === 'travel-expense',
    `候選 ${nums.join('、') || '無'}；新草稿 ${nlDraft?.formDefinitionKey ?? '無'}；工具 ${turn.ok ? turn.toolsUsed?.join(',') : turn.error}`
  );

  const t1 = await byNumber('BT0001');
  const draft = await createDraftWithFill({ conversationId: conv.id, ownerEmployeeId: A, formKey: 'travel-expense', request: {}, idempotencyKey: randomUUID() });
  if (!draft.ok) throw new Error(draft.message);

  // PDF 內容
  const snap = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: t1.id });
  if (!snap.ok) throw new Error(snap.error);
  const file = await readSnapshotBytes(snap.snapshot.id);
  const { text, pages } = await pdfText(file!.bytes);
  const wants = [t1.n, '台中市西屯區', '台中客戶需求訪談', '測試主管', '核准'];
  const missing = wants.filter((w) => !text.includes(w));
  record('pdf-content', missing.length === 0, `${pages} 頁；${missing.length ? `缺少：${missing.join('、')}` : `含單號、地點、事由、簽核人與核准紀錄`}`);
  {
    // Text extraction alone once passed on a PDF that rendered as garbage: the font must be embedded whole, labels must be people's words.
    const labelled = ['出差地點：', '出差事由：', '已核准'].every((w) => text.includes(w));
    const noInternals = !/purpose|tripStartAt|approved ·|"rows"/.test(text);
    record('pdf-readable', file!.bytes.length > 1_000_000 && file!.bytes.length < 6_000_000 && labelled && noInternals, `檔案 ${(file!.bytes.length / 1048576).toFixed(1)} MB（字型完整嵌入）；欄位為中文標籤，無內部代碼 ${noInternals}；實際渲染見 ui-approved-pdf.jpg`);
  }

  // 夾帶、重試不重複
  const l1 = await attachApprovedSnapshotToDraft({ actor: actorA, draftId: draft.draftId, expectedVersion: draft.version, snapshotId: snap.snapshot.id });
  if (!l1.ok) throw new Error('attach conflict');
  const again = await Promise.all([
    attachApprovedSnapshotToDraft({ actor: actorA, draftId: draft.draftId, expectedVersion: l1.draft.version, snapshotId: snap.snapshot.id }),
    attachApprovedSnapshotToDraft({ actor: actorA, draftId: draft.draftId, expectedVersion: l1.draft.version, snapshotId: snap.snapshot.id }),
  ]);
  const links = await listDraftSnapshots(draft.draftId, A);
  const after = (await getDraftForOwner(draft.draftId, A))!;
  record('attach-idempotent', l1.created && again.every((x) => x.ok && !x.created) && links.length === 1 && after.version === l1.draft.version, `重送 2 次 → 夾帶 ${links.length} 份，版本 v${after.version} 不變`);

  // 舊版本不留下孤立關聯
  {
    const t2 = await byNumber('BT0002');
    const s2 = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: t2.id });
    if (!s2.ok) throw new Error(s2.error);
    const stale = await attachApprovedSnapshotToDraft({ actor: actorA, draftId: draft.draftId, expectedVersion: 1, snapshotId: s2.snapshot.id });
    const n = (await listDraftSnapshots(draft.draftId, A)).length;
    record('stale-no-orphan', !stale.ok && n === 1, `舊版本附加 → ${stale.ok ? '成功!' : 'version_conflict'}；關聯數仍 ${n}`);
  }

  // 一次性帶入：卡片不寫 DB，確認才寫
  {
    const d = (await getDraftForOwner(draft.draftId, A))!;
    const [source] = await getDb().select({ data: formSubmissions.data }).from(formSubmissions).where(eq(formSubmissions.id, t1.id));
    const card = await buildTripCarryOverCard({ draftId: d.id, ownerEmployeeId: A, conversationId: conv.id, sourceData: source.data as Record<string, unknown>, sourceFormNumber: t1.n });
    const unchanged = (await getDraftForOwner(d.id, A))!;
    if (!card || card.kind !== 'change_confirm') throw new Error('no carry card');
    await appendMessage({ conversationId: conv.id, ownerEmployeeId: A, role: 'model', contentText: card.prompt, blocks: [card] });
    const yes = await confirmChangeCard({ employeeId: A, conversationId: conv.id, blockId: card.id, accept: true });
    const done = (await getDraftForOwner(d.id, A))!;
    record(
      'carry-over',
      unchanged.version === d.version && yes.ok && done.data.tripStartDate === '2026-10-14' && done.data.tripOrderNo === t1.n,
      `卡片 ${card.changes.map((c) => c.label).join('、')}；確認前 v${unchanged.version}，確認後 v${done.version}，帶入日期 ${String(done.data.tripStartDate)}、單號 ${String(done.data.tripOrderNo)}`
    );
  }

  // 未核准、無權限
  {
    const pending = await byNumber('BT0005');
    const returned = await byNumber('BT0004');
    const bTrip = await byNumber('BT0006');
    const p = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: pending.id });
    const r = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: returned.id });
    const other = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: bTrip.id });
    const bReadsA = await getOrCreateApprovedPdfSnapshot({ actor: actorB, formType: 'custom', formId: t1.id });
    let toOther = 'no-error';
    try {
      await attachApprovedSnapshotToDraft({ actor: actorB, draftId: draft.draftId, expectedVersion: 1, snapshotId: snap.snapshot.id });
    } catch (e) {
      toOther = (e as Error).message;
    }
    const access = await canAccessApprovedSnapshot(actorB, snap.snapshot.id);
    record(
      'source-target-authz',
      !p.ok && !r.ok && !other.ok && !bReadsA.ok && toOther === 'draft_not_found' && !access,
      `待簽：${p.ok ? '通過!' : p.error}；退回：${r.ok ? '通過!' : r.error}；別人的單：${other.ok ? '通過!' : other.error}；B 取 A 的核准單：${bReadsA.ok ? '通過!' : bReadsA.error}；B 寫 A 的草稿：${toOther}；B 讀 PDF：${access}`
    );
  }

  // 來源之後更動，不改寫已夾帶 PDF
  {
    const before = await readSnapshotBytes(snap.snapshot.id);
    await getDb().update(formSubmissions).set({ data: sql`jsonb_set(data, '{location}', '"（測試）來源事後被改"')`, version: sql`version + 1` }).where(eq(formSubmissions.id, t1.id));
    const later = await getOrCreateApprovedPdfSnapshot({ actor: actorA, formType: 'custom', formId: t1.id });
    const same = await readSnapshotBytes(snap.snapshot.id);
    const linked = await listDraftSnapshots(draft.draftId, A);
    record('source-change-fixed', later.ok && later.snapshot.id !== snap.snapshot.id && Buffer.compare(before!.bytes, same!.bytes) === 0 && linked[0].snapshotId === snap.snapshot.id, '來源變更產生新版快照；已夾帶的 PDF 位元組與關聯都沒變');
    await getDb().update(formSubmissions).set({ data: sql`jsonb_set(data, '{location}', '"台中市西屯區"')`, version: sql`version + 1` }).where(eq(formSubmissions.id, t1.id));
  }

  // 必附件表單：附件全在草稿上也能送出；同時重送只有一張單、附件不重複
  {
    const current = (await getDraftForOwner(draft.draftId, A))!;
    const saved = await saveDraftFromPanel({
      draftId: current.id,
      ownerEmployeeId: A,
      expectedVersion: current.version,
      data: {
        ...current.data,
        purpose: '[測試] 台中客戶需求訪談',
        companions: '無',
        budgetCodeId: '40000000-0000-0000-0000-000000000001',
        reportItems: { rows: [{ tripDate: '2026-10-14', location: '台中', itinerary: '訪談', timeSlot: '全天' }], total: null },
        costItems: { rows: [{ expenseDate: '2026-10-14', category: '交通費', fromStation: '台北', toStation: '台中', summary: '高鐵', currency: 'TWD', amount: '300.00', exchangeRate: 1, twdAmount: '300.00' }], total: null },
      },
    });
    if (!saved.ok) throw new Error(`panel save: ${saved.error}`);
    const v = saved.draft.version;
    const [r1, r2] = await runWithSessionToken(token, () =>
      Promise.all([
        submitApplicationDraft({ draftId: current.id, ownerEmployeeId: A, expectedVersion: v }),
        submitApplicationDraft({ draftId: current.id, ownerEmployeeId: A, expectedVersion: v }),
      ])
    );
    const r3 = await runWithSessionToken(token, () => submitApplicationDraft({ draftId: current.id, ownerEmployeeId: A, expectedVersion: v }));
    const ids = [r1, r2, r3].map((r) => (r.ok ? r.submissionId : `失敗：${r.error}`));
    const copies = r1.ok ? await getDb().select({ name: attachments.fileName }).from(attachments).where(and(eq(attachments.formType, 'custom'), eq(attachments.formId, r1.submissionId))) : [];
    const [{ n: subs }] = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from ai_application_drafts where id = ${current.id} and status = 'submitted' and submission_id is not null`);
    record('submit-draft-files', r1.ok && new Set(ids).size === 1 && copies.length === 1 && subs === 1, `3 次送出 → ${new Set(ids).size} 張單；附件 ${copies.length} 份（${copies.map((c) => c.name).join('、')}）`);
    if (r1.ok) {
      const asC = await readPreviewFor(actorC, (await getDb().select({ id: attachments.id }).from(attachments).where(eq(attachments.formId, r1.submissionId)))[0].id);
      const asB = await readPreviewFor(actorB, (await getDb().select({ id: attachments.id }).from(attachments).where(eq(attachments.formId, r1.submissionId)))[0].id);
      record('approver-preview-authz', asC.ok && !asB.ok && asB.status === 404, `簽核者 C：${asC.ok ? asC.kind : asC.reason}；B：${asB.ok ? '通過!' : asB.status}`);
    }
  }

  // 預覽失敗要說清楚：Office 轉換失敗不可停在「轉換中」；損壞 PDF 由瀏覽器檢視器回報
  {
    const pending = await byNumber('BT0005');
    await getDb().delete(attachments).where(and(eq(attachments.formType, 'custom'), eq(attachments.formId, pending.id)));
    const book = new ExcelJS.Workbook();
    book.addWorksheet('測試').addRow(['測試資料', 1]);
    const xlsx = Buffer.from(await book.xlsx.writeBuffer());
    const up = await uploadAttachmentFor(actorA, 'custom', pending.id, new File([xlsx], '測試報價.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    if (!up.ok) throw new Error(`office upload: ${up.error}`);
    const conv2 = await ensurePreviewDerivative(up.attachmentId);
    const seen = await readPreviewFor(actorC, up.attachmentId);
    record(
      'office-state-honest',
      conv2.ok ? seen.ok && seen.kind === 'derivative' : !seen.ok && seen.reason === 'derivative_missing',
      conv2.ok ? '真實 LibreOffice 轉換，預覽為 PDF' : `本機沒有 soffice（真實轉換未驗證）；轉換失敗回報 ${seen.ok ? '成功!' : seen.reason}，不是「轉換中」`
    );
    const bad = await uploadAttachmentFor(actorA, 'custom', pending.id, new File([Buffer.from('%PDF-1.4\n這不是有效的 PDF\n')], '損壞.pdf', { type: 'application/pdf' }));
    record('corrupt-pdf-uploaded', bad.ok, bad.ok ? `已掛在 ${pending.n}，供瀏覽器確認檢視器訊息` : bad.error);

    // 宣稱支援的格式都要能由簽核者站內預覽
    const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
    const samples: [string, string, Uint8Array][] = [
      ['image/png', 'invoice-match.png', readFileSync('tmp/ai-attachments/invoice-match.png')],
      ['image/webp', 'sample.webp', webp],
      ['image/heic', 'invoice-match.heic', readFileSync('tmp/ai-attachments/invoice-match.heic')],
    ];
    const seenKinds: string[] = [];
    for (const [mime, name, bytes] of samples) {
      const u = await uploadAttachmentFor(actorA, 'custom', pending.id, new File([Buffer.from(bytes)], name, { type: mime }));
      if (!u.ok) throw new Error(`${name}: ${u.error}`);
      if (mime === 'image/heic') await ensurePreviewDerivative(u.attachmentId);
      const v = await readPreviewFor(actorC, u.attachmentId);
      seenKinds.push(v.ok ? `${name}→${v.kind}:${v.mimeType}` : `${name}→失敗 ${v.reason}`);
    }
    record('format-preview', seenKinds.every((k) => !k.includes('失敗')), seenKinds.join('；'));
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ when: new Date().toISOString(), draft: draft.draftId, conversation: conv.id, results }, null, 2));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
