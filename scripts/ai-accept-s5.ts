/**
 * 第 5 階段驗收（後端）：編輯版本、原檔不變、AI 只讀不含註解的版本、權限。
 * 瀏覽器操作（畫布裁切、旋轉、註解、取消、方向）見 acceptance/S5.md。
 *
 *   DATABASE_URL=…accsys_test STORAGE_LOCAL_PATH=<暫存目錄> npx tsx scripts/ai-accept-s5.ts --out report.json
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { attachStagedFilesToDraft, listDraftFiles, readDraftFileBytes } from '../src/lib/ai-chat/attach-staged';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { createDraftWithFill } from '../src/lib/ai-chat/draft-work';
import { editState, parseOperations, readEditOutput, restoreOriginal, saveFileEdit } from '../src/lib/ai-chat/file-edits';
import { listPendingStaged, readStagedImageForOwner, stageAiChatImage } from '../src/lib/ai-chat/staged-images';
import { getStagedCheckStates, startStagedChecks } from '../src/lib/ai-chat/staged-invoice';
import { getDb, getSql } from '../src/lib/db';
import { aiChatStagedAttachments } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const B = '20000000-0000-0000-0000-0000000000b1';
const DIR = 'tmp/ai-attachments';
const OPS = { rotation: 0 as const, crop: { x: 0, y: 0, w: 1, h: 0.8 }, annotations: [{ kind: 'text', at: { x: 0.1, y: 0.1 }, text: '統編正確' }] };

type Result = { case: string; ok: boolean; why: string };
const results: Result[] = [];
const record = (c: string, ok: boolean, why: string) => {
  results.push({ case: c, ok, why });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.padEnd(20)} ${why}`);
};
const read = (f: string) => new Uint8Array(readFileSync(path.join(DIR, f)));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function loadAiSettingsOnly() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^(AI_CHAT_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function check(id: string) {
  await startStagedChecks(A, [id]);
  const end = Date.now() + 120_000;
  for (;;) {
    const [st] = await getStagedCheckStates(A, [id]);
    if (st?.state === 'done') return st.result!;
    if (Date.now() > end) throw new Error('check timeout');
    await new Promise((r) => setTimeout(r, 800));
  }
}

const stage = async (conversationId: string, f: string) => {
  const r = await stageAiChatImage({ ownerEmployeeId: A, conversationId, clientAttachmentId: randomUUID(), fileName: f, bytes: read(f) });
  if (!r.ok) throw new Error(r.error);
  return r.staged;
};

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  if (!process.env.STORAGE_LOCAL_PATH) throw new Error('STORAGE_LOCAL_PATH required');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;
  const conv = await createConversation(A);
  const output = read('invoice-match.jpg');
  const missing = read('invoice-missing.jpg');

  // 7. 註解不當證據：output 看得到「買方統編相符」，analysis 沒有。
  {
    const s = await stage(conv.id, 'invoice-missing.jpg');
    const first = await check(s.id);
    const saved = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: null, operations: OPS, output, analysis: missing });
    const [after] = await getDb().select().from(aiChatStagedAttachments).where(eq(aiChatStagedAttachments.id, s.id));
    record('old-result-cleared', saved.ok && after.analysisStatus === null && after.analysisResult === null, `編輯前結果 ${first.overallStatus}；儲存編輯後 analysis_status=${String(after.analysisStatus)}`);
    const res = await check(s.id);
    const [row] = await getDb().select().from(aiChatStagedAttachments).where(eq(aiChatStagedAttachments.id, s.id));
    record('annotation-not-evidence', res.overallStatus === 'not_found' || res.overallStatus === 'unclear', `畫面版含買方統編，AI 讀的版本沒有 → ${res.overallStatus}（不是 match）`);
    record('analysis-version', row.analysisContentSha256 === sha(missing), `分析記錄的檔案雜湊 = 不含註解版本（${String(row.analysisContentSha256).slice(0, 12)}…）`);
  }

  // 5. 原檔不變、還原原圖、版本。
  {
    const s = await stage(conv.id, 'invoice-match.jpg');
    const orig = sha(read('invoice-match.jpg'));
    const v1 = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: null, operations: OPS, output: missing, analysis: missing });
    if (!v1.ok) throw new Error(v1.error);
    const stale = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: null, operations: OPS, output: missing, analysis: missing });
    const v2 = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: v1.editId, operations: { ...OPS, rotation: 90 }, output, analysis: missing });
    const state = await editState('staged', s.id, A);
    const stored = await readStagedImageForOwner(A, s.id);
    const restored = await restoreOriginal({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id });
    const after = await editState('staged', s.id, A);
    record('versions-kept', v2.ok && v2.version === 2 && state?.history.length === 2 && !stale.ok && stale.code === 'conflict', `版本 ${state?.history.map((h) => h.version).join(',')}；舊基準再存 → ${stale.ok ? '成功!' : stale.code}`);
    record('original-unchanged', sha(stored!.bytes) === orig, `編輯兩次後原檔雜湊不變（${orig.slice(0, 12)}…）`);
    record('restore-original', restored.ok && after?.activeEditId === null && after?.history.length === 2, `還原後目前版本為原圖，歷史仍有 ${after?.history.length} 個版本`);
  }

  // 夾入草稿後：草稿檔案沿用編輯版，可再編輯，原檔仍在。
  {
    const s = await stage(conv.id, 'invoice-match.png');
    const v = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: null, operations: OPS, output, analysis: missing });
    if (!v.ok) throw new Error(v.error);
    const d = await createDraftWithFill({ conversationId: conv.id, ownerEmployeeId: A, formKey: 'business-trip', request: {}, idempotencyKey: randomUUID() });
    if (!d.ok) throw new Error(d.message);
    const att = await attachStagedFilesToDraft({ actor: { id: A, role: 'staff' }, conversationId: conv.id, draftId: d.draftId, expectedVersion: 1, stagedIds: [s.id] });
    const [f] = await listDraftFiles(d.draftId, A);
    const orig = await readDraftFileBytes(d.draftId, f.id);
    const shown = await readEditOutput(f.activeEditId!, A);
    record('edit-carried-to-draft', att.ok && f.activeEditId === v.editId && sha(orig!.bytes) === sha(read('invoice-match.png')) && sha(shown!.bytes) === sha(output), '草稿顯示編輯版；草稿內原檔雜湊與上傳時相同');
    const again = await saveFileEdit({ ownerEmployeeId: A, kind: 'draft_file', sourceId: f.id, expectedEditId: v.editId, operations: { ...OPS, rotation: 180 }, output: missing, analysis: missing });
    const files = await listDraftFiles(d.draftId, A);
    record('edit-in-draft', again.ok && files[0].checkState === 'none', `草稿內再次編輯 → v${again.ok ? again.version : '?'}；舊 AI 結果標為需重新檢查（${files[0].checkState}）`);
    const other = await saveFileEdit({ ownerEmployeeId: B, kind: 'draft_file', sourceId: f.id, expectedEditId: null, operations: OPS, output, analysis: missing });
    const otherRead = await readEditOutput(v.editId, B);
    const otherState = await editState('draft_file', f.id, B);
    record('other-user-denied', !other.ok && other.code === 'not_found' && otherRead === null && otherState === null, 'B 不能編輯、讀取 A 的檔案或編輯版本');
  }

  // 非圖片內容不接受；操作內容驗證。
  {
    const s = await stage(conv.id, 'invoice-mismatch.jpg');
    const bad = await saveFileEdit({ ownerEmployeeId: A, kind: 'staged', sourceId: s.id, expectedEditId: null, operations: OPS, output: new TextEncoder().encode('not an image'), analysis: missing });
    record('rejects-non-image', !bad.ok && bad.code === 'invalid', `回傳 ${bad.ok ? 'ok' : bad.code}`);
    record('rejects-bad-ops', parseOperations({ rotation: 45, crop: null, annotations: [] }) === null && parseOperations({ rotation: 90, crop: { x: 0, y: 0, w: 2, h: 1 }, annotations: [] }) === null, '不合法旋轉與裁切被拒');
  }

  // 重新整理後待處理檔案仍在（第 4 階段遺留）。
  {
    const c2 = await createConversation(A);
    const s = await stage(c2.id, 'invoice-match.jpg');
    const pending = await listPendingStaged(A, c2.id);
    record('pending-survive-reload', pending.some((p) => p.id === s.id), `對話待處理檔案 ${pending.length} 個`);
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
