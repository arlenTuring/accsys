import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { getApprovalTimeline } from '@/lib/approval/timeline';
import { canReadForm, type Actor } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import {
  approvedDocumentSnapshots,
  formDefinitions,
  formSubmissions,
} from '@/lib/db/schema';
import { writeNew } from '@/lib/attachments/storage';

export const APPROVED_PDF_RENDERER_VERSION = 'accsys-approved-pdf-v1';

export type ApprovedSnapshot = {
  id: string;
  sourceFormType: string;
  sourceFormId: string;
  sourceFormNumber: string;
  sourceFormKey: string | null;
  sourceVersion: number;
  approvalRoundKey: string;
  approvedAt: Date;
  contentHash: string;
  rendererVersion: string;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  generatedAt: Date;
};

let fontBytesCache: Uint8Array | null = null;

async function loadNotoSansTc(): Promise<Uint8Array> {
  if (fontBytesCache) return fontBytesCache;
  const candidates = [
    path.join(process.cwd(), 'assets/fonts/NotoSansTC-Regular.otf'),
    path.join(process.cwd(), 'assets/fonts/NotoSansCJKtc-Regular.otf'),
    path.join(process.cwd(), 'node_modules/@fontsource/noto-sans-tc/files/noto-sans-tc-chinese-traditional-400-normal.woff'),
  ];
  for (const p of candidates) {
    try {
      fontBytesCache = new Uint8Array(await readFile(p));
      return fontBytesCache;
    } catch {
      /* try next */
    }
  }
  throw new Error('cjk_font_missing: place NotoSansTC-Regular.otf under assets/fonts/');
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const ch of para) {
      if (cur.length >= maxChars) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [''];
}

async function loadCustomSubmission(formId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: formSubmissions.id,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      version: formSubmissions.version,
      data: formSubmissions.data,
      applicantEmployeeId: formSubmissions.applicantEmployeeId,
      definitionId: formSubmissions.definitionId,
      submittedAt: formSubmissions.submittedAt,
    })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, formId))
    .limit(1);
  if (!row) return null;
  const [def] = await db
    .select({ key: formDefinitions.key, name: formDefinitions.name })
    .from(formDefinitions)
    .where(eq(formDefinitions.id, row.definitionId))
    .limit(1);
  return { ...row, formKey: def?.key ?? null, formName: def?.name ?? '自訂表單' };
}

/**
 * Generate or reuse an immutable PDF snapshot of an approved custom submission.
 * Never overwrites an existing snapshot binary.
 */
export async function getOrCreateApprovedPdfSnapshot(input: {
  actor: Actor;
  formType: 'custom';
  formId: string;
}): Promise<{ ok: true; snapshot: ApprovedSnapshot; reused: boolean } | { ok: false; error: string }> {
  if (!(await canReadForm(input.actor, input.formType, input.formId))) {
    return { ok: false, error: '找不到單據或無權限。' };
  }
  const submission = await loadCustomSubmission(input.formId);
  if (!submission) return { ok: false, error: '找不到單據。' };
  if (submission.status !== 'approved') {
    return { ok: false, error: '僅已核准的單據可產生核准 PDF 快照。' };
  }

  const timeline = await getApprovalTimeline(input.formType, input.formId, input.actor);
  if (!timeline || timeline.formStatus !== 'approved') {
    return { ok: false, error: '核准歷程不完整，無法產生快照。' };
  }

  const approvedNodes = timeline.nodes.filter((n) => n.state === 'approved' || n.state === 'auto_approved');
  const lastActed = approvedNodes.map((n) => n.actedAt).filter(Boolean).sort().at(-1) ?? submission.submittedAt?.toISOString();
  if (!lastActed) return { ok: false, error: '找不到核准時間。' };

  const approvalRoundKey = `final:${submission.version}:${lastActed}`;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(approvedDocumentSnapshots)
    .where(
      and(
        eq(approvedDocumentSnapshots.sourceFormType, input.formType),
        eq(approvedDocumentSnapshots.sourceFormId, input.formId),
        eq(approvedDocumentSnapshots.sourceVersion, submission.version),
        eq(approvedDocumentSnapshots.approvalRoundKey, approvalRoundKey)
      )
    )
    .limit(1);
  if (existing) {
    return { ok: true, reused: true, snapshot: mapSnapshot(existing) };
  }

  const pdfBytes = await renderApprovedPdf({
    formName: submission.formName,
    formNumber: submission.formNumber,
    formKey: submission.formKey,
    version: submission.version,
    applicantName: timeline.applicantName,
    submittedAt: timeline.submittedAt,
    approvedAt: lastActed,
    data: (submission.data as Record<string, unknown>) ?? {},
    nodes: timeline.nodes,
    previousRounds: timeline.previousRounds,
  });

  const contentHash = createHash('sha256').update(pdfBytes).digest('hex');
  const id = randomUUID();
  const storagePath = `approved-snapshots/${input.formType}/${input.formId}/${id}.pdf`;
  const fileName = `${submission.formNumber}-核准結果.pdf`;
  await writeNew(storagePath, pdfBytes);

  const [row] = await db
    .insert(approvedDocumentSnapshots)
    .values({
      id,
      sourceFormType: input.formType,
      sourceFormId: input.formId,
      sourceFormNumber: submission.formNumber,
      sourceFormKey: submission.formKey,
      sourceVersion: submission.version,
      approvalRoundKey,
      approvedAt: new Date(lastActed),
      contentHash,
      rendererVersion: APPROVED_PDF_RENDERER_VERSION,
      storagePath,
      fileName,
      fileSizeBytes: pdfBytes.length,
      generatedByEmployeeId: input.actor.id,
    })
    .returning();

  return { ok: true, reused: false, snapshot: mapSnapshot(row) };
}

async function renderApprovedPdf(input: {
  formName: string;
  formNumber: string;
  formKey: string | null;
  version: number;
  applicantName: string;
  submittedAt: string | null;
  approvedAt: string;
  data: Record<string, unknown>;
  nodes: Array<{
    label: string;
    approverName: string | null;
    delegatedFromName: string | null;
    state: string;
    actedAt: string | null;
    comment: string | null;
  }>;
  previousRounds: Array<{ submittedAt: string | null; endedAt: string }>;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await loadNotoSansTc(), { subset: true });
  const margin = 48;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const lineH = 16;
  const maxW = 42;

  const draw = (text: string, size = 10, color = rgb(0.1, 0.15, 0.25)) => {
    for (const line of wrap(text, maxW)) {
      if (y < margin + lineH) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line || ' ', { x: margin, y: y - size, size, font, color });
      y -= lineH;
    }
  };

  draw(`${input.formName}`, 14);
  draw(`正式單號：${input.formNumber}${input.formKey ? `（${input.formKey}）` : ''}`);
  draw(`申請人：${input.applicantName}`);
  draw(`表單版本：v${input.version}`);
  draw(`送出時間：${formatTw(input.submittedAt)}`);
  draw(`最終核准時間：${formatTw(input.approvedAt)}`);
  draw(`PDF 產生時間（Asia/Taipei）：${formatTw(new Date().toISOString())}`);
  draw(`產生器：${APPROVED_PDF_RENDERER_VERSION}`);
  y -= 8;
  draw('—— 表單內容 ——', 11);
  for (const [k, v] of Object.entries(input.data)) {
    if (k.startsWith('_')) continue;
    const shown = formatValue(v);
    draw(`${k}：${shown}`);
  }
  y -= 8;
  draw('—— 簽核歷程（最終核准輪次）——', 11);
  for (const n of input.nodes) {
    const who = n.approverName ?? '—';
    const proxy = n.delegatedFromName ? `（代理 ${n.delegatedFromName}）` : '';
    draw(`${n.label}：${n.state} · ${who}${proxy} · ${formatTw(n.actedAt)}`);
    if (n.comment) draw(`  意見：${n.comment}`);
  }
  if (input.previousRounds.length) {
    y -= 8;
    draw('—— 歷史輪次（退回後重送）——', 11);
    for (const r of input.previousRounds) {
      draw(`輪次結束 ${formatTw(r.endedAt)}（送出 ${formatTw(r.submittedAt)}）`);
    }
  }
  y -= 8;
  draw('本文件為核准當下之不可變 PDF 快照，來源單後續變更不會改寫此檔。');
  draw('列印姓名不等於數位簽章；雜湊僅供完整性核對。', 9);

  return doc.save();
}

function formatTw(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  } catch {
    return iso;
  }
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function mapSnapshot(row: {
  id: string;
  sourceFormType: string;
  sourceFormId: string;
  sourceFormNumber: string;
  sourceFormKey: string | null;
  sourceVersion: number;
  approvalRoundKey: string;
  approvedAt: Date;
  contentHash: string;
  rendererVersion: string;
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  generatedAt: Date;
}): ApprovedSnapshot {
  return {
    id: row.id,
    sourceFormType: row.sourceFormType,
    sourceFormId: row.sourceFormId,
    sourceFormNumber: row.sourceFormNumber,
    sourceFormKey: row.sourceFormKey,
    sourceVersion: row.sourceVersion,
    approvalRoundKey: row.approvalRoundKey,
    approvedAt: row.approvedAt,
    contentHash: row.contentHash,
    rendererVersion: row.rendererVersion,
    storagePath: row.storagePath,
    fileName: row.fileName,
    fileSizeBytes: row.fileSizeBytes,
    generatedAt: row.generatedAt,
  };
}

export async function readSnapshotBytes(snapshotId: string): Promise<{ bytes: Buffer; fileName: string; contentHash: string } | null> {
  const db = getDb();
  const [row] = await db.select().from(approvedDocumentSnapshots).where(eq(approvedDocumentSnapshots.id, snapshotId)).limit(1);
  if (!row) return null;
  const { readNoFollow } = await import('@/lib/attachments/storage');
  const bytes = await readNoFollow(row.storagePath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== row.contentHash) throw new Error('snapshot_hash_mismatch');
  return { bytes, fileName: row.fileName, contentHash: row.contentHash };
}
