import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { getApprovalTimeline } from '@/lib/approval/timeline';
import { canReadForm, type Actor } from '@/lib/authz/forms';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { referenceLabels } from '@/lib/custom-forms/queries';
import { allFields, isDisplayOnly, type FieldDef, type FormSchema } from '@/lib/custom-forms/schema';
import { maskSensitive } from '@/lib/custom-forms/sensitive';
import { getDb } from '@/lib/db';
import {
  approvedDocumentSnapshots,
  formDefinitions,
  formDefinitionVersions,
  formSubmissions,
} from '@/lib/db/schema';
import { writeNew } from '@/lib/attachments/storage';

export const APPROVED_PDF_RENDERER_VERSION = 'accsys-approved-pdf-v2';

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

const COMMON_FONT = 'assets/fonts/NotoSansTC-Common.otf';
const FULL_FONT = 'assets/fonts/NotoSansCJKtc-Regular.otf';
const fontCache = new Map<string, Uint8Array>();

async function loadFont(file: string): Promise<Uint8Array | null> {
  const hit = fontCache.get(file);
  if (hit) return hit;
  try {
    const bytes = new Uint8Array(await readFile(path.join(process.cwd(), file)));
    fontCache.set(file, bytes);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * The font to embed, in full: the fontkit subsetter loses glyphs, so a subset
 * PDF extracts fine and renders as garbage. The 4 MB common font covers nearly
 * every document; only a character outside it pulls in the 16 MB one.
 */
async function pickFont(text: string): Promise<Uint8Array> {
  const common = await loadFont(COMMON_FONT);
  if (common) {
    const parsed = fontkit.create(common) as unknown as { hasGlyphForCodePoint(c: number): boolean };
    const covered = [...text].every((ch) => ch === '\n' || parsed.hasGlyphForCodePoint(ch.codePointAt(0)!));
    if (covered) return common;
  }
  const full = await loadFont(FULL_FONT);
  if (full) return full;
  if (common) return common;
  throw new Error('cjk_font_missing: see assets/fonts/README.md');
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
      versionId: formSubmissions.versionId,
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
  const [ver] = await db
    .select({ schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
    .from(formDefinitionVersions)
    .where(eq(formDefinitionVersions.id, row.versionId))
    .limit(1);
  const parsed = ver ? parseDefinition(ver.schema, ver.flow) : null;
  return { ...row, formKey: def?.key ?? null, formName: def?.name ?? '自訂表單', schema: parsed?.ok ? parsed.schema : null };
}

const amountText = (v: unknown) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

function cellText(col: Extract<FieldDef, { type: 'table' }>['columns'][number], v: unknown, labels: Record<string, string>): string {
  if (col.type === 'employee' || col.type === 'asset' || col.type === 'budget_code') return labels[String(v)] ?? '（資料已移除）';
  if (col.type === 'money') return amountText(v);
  if (col.type === 'select') return col.options?.find((o) => o.value === v)?.label ?? String(v);
  return String(v);
}

/** Lines of one filled-in field, as the form page shows it; nothing for an empty one. */
function fieldLines(f: FieldDef, v: unknown, labels: Record<string, string>): string[] {
  if (v === null || v === undefined || v === '') return [];
  switch (f.type) {
    case 'table': {
      const table = v as { rows?: Record<string, unknown>[]; total?: unknown };
      const rows = table.rows ?? [];
      if (rows.length === 0) return [];
      const lines = rows.map((row, i) => {
        const cells = f.columns
          .filter((c) => row[c.id] !== null && row[c.id] !== undefined && row[c.id] !== '')
          .map((c) => `${c.label} ${cellText(c, row[c.id], labels)}`);
        return `  ${i + 1}. ${cells.join('｜')}`;
      });
      const total = table.total === null || table.total === undefined ? '' : `（合計 ${amountText(table.total)}）`;
      return [`${f.label}${total}：`, ...lines];
    }
    case 'money':
      return [`${f.label}：NT$ ${amountText(v)}`];
    case 'datetime':
      return [`${f.label}：${String(v).replace('T', ' ')}`];
    case 'select':
    case 'radio':
      return [`${f.label}：${f.options.find((o) => o.value === v)?.label ?? String(v)}`];
    case 'checkboxes': {
      const list = Array.isArray(v) ? v : [];
      if (list.length === 0) return [];
      return [`${f.label}：${list.map((x) => f.options.find((o) => o.value === x)?.label ?? String(x)).join('、')}`];
    }
    case 'boolean':
      return [`${f.label}：${v === true ? f.trueLabel : f.falseLabel}`];
    case 'employee':
    case 'department':
    case 'budget_code':
    case 'project':
    case 'supplier':
    case 'asset':
    case 'source':
      return [`${f.label}：${labels[String(v)] ?? '（資料已移除）'}`];
    default:
      return [`${f.label}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`];
  }
}

/** Sensitive fields stay masked: this PDF is read by whoever handles the form it is attached to. */
async function formLines(schema: FormSchema | null, data: Record<string, unknown>): Promise<string[]> {
  if (!schema) return ['（表單定義無法讀取，內容未列出）'];
  const fields = allFields(schema).filter((f) => !isDisplayOnly(f));
  const labels = await referenceLabels(fields, data);
  const shown = maskSensitive(schema, data);
  return fields.flatMap((f) => fieldLines(f, shown[f.id], labels));
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
    formLines: await formLines(submission.schema, (submission.data as Record<string, unknown>) ?? {}),
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
  formLines: string[];
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
  const lines: { text: string; size: number }[] = [];
  const add = (text: string, size = 10) => lines.push({ text: text.replace(/[^\S\n\u3000]/g, ' '), size });
  const gap = () => lines.push({ text: '', size: 0 });

  add(input.formName, 14);
  add(`正式單號：${input.formNumber}`);
  add(`申請人：${input.applicantName}`);
  add(`送出時間：${formatTw(input.submittedAt)}`);
  add(`最終核准時間：${formatTw(input.approvedAt)}`);
  add(`PDF 產生時間（Asia/Taipei）：${formatTw(new Date().toISOString())}`);
  gap();
  add('—— 表單內容 ——', 11);
  for (const line of input.formLines) add(line);
  gap();
  add('—— 簽核歷程（最終核准輪次）——', 11);
  for (const n of input.nodes) {
    const who = n.approverName ?? '—';
    const proxy = n.delegatedFromName ? `（代理 ${n.delegatedFromName}）` : '';
    add(`${n.label}：${STATE_LABEL[n.state] ?? n.state} · ${who}${proxy} · ${formatTw(n.actedAt)}`);
    if (n.comment) add(`  意見：${n.comment}`);
  }
  if (input.previousRounds.length) {
    gap();
    add('—— 歷史輪次（退回後重送）——', 11);
    for (const r of input.previousRounds) {
      add(`輪次結束 ${formatTw(r.endedAt)}（送出 ${formatTw(r.submittedAt)}）`);
    }
  }
  gap();
  add('本文件為核准當下之不可變 PDF 快照，來源單後續變更不會改寫此檔。');
  add(`列印姓名不等於數位簽章；雜湊僅供完整性核對。（表單版本 v${input.version}，${APPROVED_PDF_RENDERER_VERSION}）`, 9);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await pickFont(lines.map((l) => l.text).join('\n')), { subset: false });
  const margin = 48;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const lineH = 16;
  const maxW = 42;
  const color = rgb(0.1, 0.15, 0.25);

  for (const { text, size } of lines) {
    if (size === 0) {
      y -= 8;
      continue;
    }
    for (const line of wrap(text, maxW)) {
      if (y < margin + lineH) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line || ' ', { x: margin, y: y - size, size, font, color });
      y -= lineH;
    }
  }

  return doc.save();
}

const STATE_LABEL: Record<string, string> = {
  approved: '已核准',
  auto_approved: '系統代簽',
  skipped: '略過',
  returned: '已退回',
  pending: '待簽核',
};

function formatTw(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
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
