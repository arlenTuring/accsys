/**
 * 第 4 階段驗收（後端）：附件三階段。真實 Gemini 檢查固定附件測試組；判定讀 DB 與儲存檔案。
 * 掃描器：本機沒有 ClamAV 時，案例 scan-infected 使用「替身 clamd」驗證程式對 FOUND 回應的處理，
 * 真實 ClamAV 的偵測列為未驗證。
 *
 *   npx tsx scripts/gen-ai-attachment-fixtures.ts tmp/ai-attachments <公司統編>
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *     STORAGE_LOCAL_PATH=<暫存目錄> npx tsx scripts/ai-accept-s4.ts --out report.json
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { and, eq } from 'drizzle-orm';
import { attachStagedFilesToDraft } from '../src/lib/ai-chat/attach-staged';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { createDraftWithFill } from '../src/lib/ai-chat/draft-work';
import { getDraftForOwner } from '../src/lib/ai-chat/drafts';
import { getReadyStagedImagesForOwner, stageAiChatImage } from '../src/lib/ai-chat/staged-images';
import { confirmStagedInvoiceReminder, getStagedCheckStates, hasStagedInvoiceConfirmation, startStagedChecks } from '../src/lib/ai-chat/staged-invoice';
import { runWithSessionToken } from '../src/lib/auth/current-employee';
import { createSession } from '../src/lib/auth/sessions';
import { upsertCompanyProfile } from '../src/lib/company/service';
import { invoiceStatusNeedsConfirm } from '../src/lib/attachments/invoice-reminder';
import { getDb, getSql } from '../src/lib/db';
import { aiChatStagedAttachments, aiDraftFileAttachments } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const DIR = 'tmp/ai-attachments';

type Result = { case: string; ok: boolean | null; why: string };
const results: Result[] = [];
const record = (c: string, ok: boolean | null, why: string) => {
  results.push({ case: c, ok, why });
  console.log(`${ok === null ? 'UNVERIFIED' : ok ? 'PASS' : 'FAIL'} ${c.padEnd(20)} ${why}`);
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

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const actor = { id: A, role: 'staff' };

async function stage(conversationId: string, file: string) {
  const bytes = new Uint8Array(readFileSync(path.join(DIR, file)));
  const r = await stageAiChatImage({ ownerEmployeeId: A, conversationId, clientAttachmentId: randomUUID(), fileName: file, bytes });
  return { r, bytes };
}

async function row(id: string) {
  const [x] = await getDb().select().from(aiChatStagedAttachments).where(eq(aiChatStagedAttachments.id, id));
  return x;
}

async function check(id: string, timeoutMs = 150_000) {
  await startStagedChecks(A, [id]);
  const end = Date.now() + timeoutMs;
  for (;;) {
    const [st] = await getStagedCheckStates(A, [id]);
    if (st?.state === 'done') return st.result!;
    if (Date.now() > end) throw new Error(`check timeout ${id}`);
    await new Promise((r) => setTimeout(r, 800));
  }
}

async function newDraft(conversationId: string) {
  const r = await createDraftWithFill({ conversationId, ownerEmployeeId: A, formKey: 'business-trip', request: {}, idempotencyKey: randomUUID() });
  if (!r.ok) throw new Error(r.message);
  return r.draftId;
}

async function draftFiles(draftId: string) {
  return getDb().select().from(aiDraftFileAttachments).where(eq(aiDraftFileAttachments.draftId, draftId));
}

/** Minimal clamd stand-in speaking the INSTREAM protocol; flags the EICAR test string. */
function fakeClamd(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let data = Buffer.alloc(0);
      sock.on('data', (c) => {
        data = Buffer.concat([data, c]);
        if (data.subarray(-4).equals(Buffer.alloc(4))) {
          sock.write(data.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          sock.end();
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }));
  });
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  if (!process.env.STORAGE_LOCAL_PATH) throw new Error('STORAGE_LOCAL_PATH must point at a scratch directory');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;

  const conv = await createConversation(A);

  // 新版：上傳＋安全掃描後可自動開始 AI（不再需要「確認並檢查」）。
  // 此腳本仍先驗證上傳保留原檔，再顯式呼叫檢查以取得可斷言結果。
  const { r: upMatch, bytes: matchBytes } = await stage(conv.id, 'invoice-match.jpg');
  if (!upMatch.ok) throw new Error(upMatch.error);
  const before = await row(upMatch.staged.id);
  record(
    'upload-keeps-original-then-ai-allowed',
    before.sha256 === sha(matchBytes),
    `上傳後可進行 AI（analysis_status=${String(before.analysisStatus)}）；原檔雜湊 ${before.sha256.slice(0, 12)}…`
  );
  record('original-kept', before.sha256 === sha(matchBytes), `儲存檔雜湊與原檔相同（${before.sha256.slice(0, 12)}…）`);

  // 統編符合：檢查後直接加入。
  const dMatch = await newDraft(conv.id);
  const mr = await check(upMatch.staged.id);
  const after = await row(upMatch.staged.id);
  const att = await attachStagedFilesToDraft({ actor, conversationId: conv.id, draftId: dMatch, expectedVersion: 1, stagedIds: [upMatch.staged.id] });
  const files = await draftFiles(dMatch);
  record('tax-id-match', mr.overallStatus === 'match' && att.ok && files.length === 1 && files[0].sha256 === sha(matchBytes), `結果 ${mr.overallStatus}（${mr.summary}）；草稿附件 ${files.length} 個，雜湊與原檔相同`);
  record('provenance', after.analysisContentSha256 === after.sha256 && after.analysisCompanyVersion === 1 && Boolean(after.analysisRulesVersion), `分析記錄：檔案 ${String(after.analysisContentSha256).slice(0, 12)}…、公司設定 v${after.analysisCompanyVersion}、規則 ${after.analysisRulesVersion}`);

  // 重試、連點：不重複，版本不變。
  const v1 = (await getDraftForOwner(dMatch, A))!.version;
  const twice = await Promise.all([
    attachStagedFilesToDraft({ actor, conversationId: conv.id, draftId: dMatch, expectedVersion: v1, stagedIds: [upMatch.staged.id] }),
    attachStagedFilesToDraft({ actor, conversationId: conv.id, draftId: dMatch, expectedVersion: v1, stagedIds: [upMatch.staged.id] }),
  ]);
  const filesAfter = await draftFiles(dMatch);
  const v2 = (await getDraftForOwner(dMatch, A))!.version;
  record('attach-idempotent', twice.every((t) => t.ok) && filesAfter.length === 1 && v2 === v1, `並行重送 2 次 → 附件 ${filesAfter.length} 個，版本 v${v1}→v${v2}`);

  // HEIC、PNG。
  for (const f of ['invoice-match.heic', 'invoice-match.png']) {
    const { r } = await stage(conv.id, f);
    if (!r.ok) {
      record(`format-${f}`, false, r.error);
      continue;
    }
    const res = await check(r.staged.id);
    record(`format-${f.split('.').pop()}`, res.overallStatus === 'match', `真實格式 ${r.staged.mimeType}；結果 ${res.overallStatus}（${res.summary.slice(0, 40)}）`);
  }

  // 統編不符／缺少／模糊：提醒，不能無確認加入；確認與草稿綁定。
  for (const [f, label, allowed] of [
    ['invoice-mismatch.jpg', 'tax-id-mismatch', ['mismatch']],
    ['invoice-missing.jpg', 'tax-id-missing', ['not_found', 'unclear']],
    ['invoice-blurry.jpg', 'tax-id-blurry', ['unclear', 'not_found']],
  ] as const) {
    const { r } = await stage(conv.id, f);
    if (!r.ok) throw new Error(r.error);
    const res = await check(r.staged.id);
    const reminded = (allowed as readonly string[]).includes(res.overallStatus) && invoiceStatusNeedsConfirm(res.overallStatus);
    const d = await newDraft(conv.id);
    const other = await newDraft(conv.id);
    const conf = await confirmStagedInvoiceReminder({ actorId: A, stagedId: r.staged.id, draftId: d, userNote: '測試：確認提醒' });
    const onOther = await hasStagedInvoiceConfirmation({ stagedId: r.staged.id, draftId: other, contentSha256: (await row(r.staged.id)).sha256 });
    record(label, reminded && conf.ok && !onOther, `結果 ${res.overallStatus}（${res.summary.slice(0, 50)}）；確認只對指定草稿有效：另一張草稿 ${onOther ? '也通過!' : '未確認'}`);
  }

  // 非發票：正確描述，不捏造。
  {
    const { r } = await stage(conv.id, 'not-invoice.jpg');
    if (!r.ok) throw new Error(r.error);
    const res = await check(r.staged.id);
    const p = res.pages[0];
    record('not-invoice', res.overallStatus === 'not_invoice' && !p?.buyerTaxId && !p?.amount, `結果 ${res.overallStatus}（${res.summary.slice(0, 40)}）；買方統編 ${String(p?.buyerTaxId)}、金額 ${String(p?.amount)}`);
  }

  // 多頁 PDF、大檔。
  {
    const { r } = await stage(conv.id, 'multipage.pdf');
    if (!r.ok) throw new Error(r.error);
    const res = await check(r.staged.id);
    record('multipage-pdf', res.pagesTotal === 3 && res.overallStatus !== 'match', `共 ${res.pagesTotal} 頁、檢查 ${res.pagesAnalysed} 頁；結果 ${res.overallStatus}`);
    const big = await stage(conv.id, 'large-30mb.pdf');
    if (!big.r.ok) throw new Error(big.r.error);
    const bigRes = await check(big.r.staged.id);
    record('large-pdf', bigRes.pagesTotal === 30 && bigRes.overallStatus !== 'match', `${(big.bytes.length / 1048576).toFixed(1)} MB 未被拒絕；共 ${bigRes.pagesTotal} 頁、檢查 ${bigRes.pagesAnalysed} 頁；結果 ${bigRes.overallStatus}；${bigRes.summary.slice(0, 50)}`);
    const png = await stage(conv.id, 'large-6mb.png');
    if (!png.r.ok) throw new Error(png.r.error);
    const pngRow = await row(png.r.staged.id);
    const pngRes = await check(png.r.staged.id);
    record('over-3mb', pngRow.sha256 === sha(png.bytes) && pngRes.overallStatus !== 'match', `${(png.bytes.length / 1048576).toFixed(1)} MB 原檔保留；結果 ${pngRes.overallStatus}`);
  }

  // 損毀、偽裝。
  {
    const { r } = await stage(conv.id, 'corrupt.jpg');
    if (r.ok) {
      const res = await check(r.staged.id);
      record('corrupt', res.overallStatus !== 'match', `結果 ${res.overallStatus}（不得標成通過）`);
    } else record('corrupt', true, `上傳即被拒：${r.error}`);
    const sp = await stage(conv.id, 'spoofed-pdf.jpg');
    record('spoofed-mime', sp.r.ok ? sp.r.staged.mimeType === 'application/pdf' : true, sp.r.ok ? `.jpg 檔名但實際判定 ${sp.r.staged.mimeType}` : sp.r.error);
  }

  // AI 不可用：未完成檢查，不能標成通過。
  {
    const { r } = await stage(conv.id, 'invoice-match.jpg');
    if (!r.ok) throw new Error(r.error);
    const prev = process.env.AI_CHAT_MODEL;
    process.env.AI_CHAT_MODEL = 'model-that-does-not-exist';
    const res = await check(r.staged.id);
    process.env.AI_CHAT_MODEL = prev;
    record('ai-unavailable', res.overallStatus === 'analysis_failed' && !res.complete && invoiceStatusNeedsConfirm(res.overallStatus), `結果 ${res.overallStatus}：${res.summary.slice(0, 60)}`);
  }

  // 關聯失敗：不顯示已加入，可重試。
  {
    const { r } = await stage(conv.id, 'cjk-small-transparent.png');
    if (!r.ok) throw new Error(r.error);
    await check(r.staged.id);
    const d = await newDraft(conv.id);
    process.env.AI_FAULT_INJECT = 'attach_link';
    const fail = await attachStagedFilesToDraft({ actor, conversationId: conv.id, draftId: d, expectedVersion: 1, stagedIds: [r.staged.id] });
    delete process.env.AI_FAULT_INJECT;
    const none = await draftFiles(d);
    const retry = await attachStagedFilesToDraft({ actor, conversationId: conv.id, draftId: d, expectedVersion: 1, stagedIds: [r.staged.id] });
    const one = await draftFiles(d);
    record('attach-failure', !fail.ok && none.length === 0 && retry.ok && one.length === 1, `故障時回報失敗、附件 ${none.length} 個；重試後 ${one.length} 個`);
  }

  // 公司資訊只有管理員能改。
  {
    const { token } = await createSession(getDb(), { employeeId: A, identityId: null, ttlMs: 600_000 });
    const res = await runWithSessionToken(token, () => upsertCompanyProfile({ legalName: '不該改成功', taxId: '12345675' }));
    record('company-admin-only', !res.ok, res.ok ? '一般員工竟可修改' : `一般員工被拒：${res.error}`);
  }

  // 安全掃描（替身 clamd）：判定感染 → 隔離，不能夾帶。
  {
    const clam = await fakeClamd();
    process.env.ATTACHMENT_SCAN = 'clamav';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.CLAMAV_PORT = String(clam.port);
    const convX = await createConversation(A);
    // A file that passes the type check but carries the test signature reaches the scanner.
    const eicar = readFileSync(path.join(DIR, 'eicar.txt'));
    const hit = {
      r: await stageAiChatImage({
        ownerEmployeeId: A,
        conversationId: convX.id,
        clientAttachmentId: randomUUID(),
        fileName: 'eicar-in.pdf',
        bytes: new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.4\n'), eicar])),
      }),
    };
    const bad = await stage(convX.id, 'eicar-as.pdf');
    const clean = await stage(convX.id, 'multipage.pdf');
    delete process.env.ATTACHMENT_SCAN;
    clam.close();
    const rows = await getDb().select().from(aiChatStagedAttachments).where(and(eq(aiChatStagedAttachments.conversationId, convX.id), eq(aiChatStagedAttachments.scanStatus, 'failed')));
    const ready = await getReadyStagedImagesForOwner(A, convX.id, rows.map((x) => x.id));
    record(
      'scan-infected(stub)',
      !hit.r.ok && (hit.r as { code: string }).code === 'infected' && rows.length >= 1 && ready.length === 0 && clean.r.ok,
      `替身掃描器：含 EICAR 的 PDF → ${hit.r.ok ? '通過!' : (hit.r as { code: string }).code}；非 PDF 內容改副檔名 → ${bad.r.ok ? '通過' : (bad.r as { code: string }).code}；被擋 ${rows.length} 筆都不可夾帶；乾淨檔通過`
    );

    // 真實掃描器：REAL_CLAMAV_PORT 指向 clamd 時走同一條流程，沒有設定就維持未驗證。
    const realPort = process.env.REAL_CLAMAV_PORT?.trim();
    if (!realPort) {
      record('scan-real-clamav', null, '未設定 REAL_CLAMAV_PORT，真實掃描器未驗證');
    } else {
      process.env.ATTACHMENT_SCAN = 'clamav';
      process.env.CLAMAV_HOST = '127.0.0.1';
      process.env.CLAMAV_PORT = realPort;
      const convR = await createConversation(A);
      // EICAR only counts at the start of a file, so it goes in a compressed PDF stream, which clamd unpacks.
      const packed = deflateSync(eicar);
      const hitReal = await stageAiChatImage({
        ownerEmployeeId: A,
        conversationId: convR.id,
        clientAttachmentId: randomUUID(),
        fileName: 'eicar-in-stream.pdf',
        bytes: new Uint8Array(
          Buffer.concat([
            Buffer.from(`%PDF-1.4\n1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n2 0 obj\n<</Type/Pages/Kids[]/Count 0>>\nendobj\n3 0 obj\n<</Length ${packed.length}/Filter/FlateDecode>>\nstream\n`),
            packed,
            Buffer.from('\nendstream\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n'),
          ])
        ),
      });
      const cleanReal = await stage(convR.id, 'multipage.pdf');
      delete process.env.ATTACHMENT_SCAN;
      const failed = await getDb().select().from(aiChatStagedAttachments).where(and(eq(aiChatStagedAttachments.conversationId, convR.id), eq(aiChatStagedAttachments.scanStatus, 'failed')));
      const usable = await getReadyStagedImagesForOwner(A, convR.id, failed.map((x) => x.id));
      record(
        'scan-real-clamav',
        !hitReal.ok && (hitReal as { code: string }).code === 'infected' && failed.length === 1 && usable.length === 0 && cleanReal.r.ok,
        `真實 clamd：PDF 串流內含 EICAR → ${hitReal.ok ? '通過!' : (hitReal as { code: string }).code}；隔離 ${failed.length} 筆、可夾帶 ${usable.length} 筆；乾淨 PDF → ${cleanReal.r.ok ? '通過' : '被擋!'}`
      );
    }
  }

  const n = (v: boolean | null) => results.filter((r) => r.ok === v).length;
  console.log(`\n${n(true)} passed, ${n(false)} failed, ${n(null)} unverified`);
  const outIdx = process.argv.indexOf('--out');
  if (outIdx >= 0) writeFileSync(process.argv[outIdx + 1], JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  process.exitCode = n(false) ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
