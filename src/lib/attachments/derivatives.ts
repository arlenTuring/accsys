import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { attachmentDerivatives, attachments } from '@/lib/db/schema';
import { readNoFollow, writeNew } from '@/lib/attachments/storage';
import { sniffAllowedType } from '@/lib/attachments/validate';

export const RENDERER_VERSION = 'accsys-preview-1';

async function runIsolated(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number }
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf8').slice(0, 4000);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stderr: err.message });
    });
  });
}

/** Convert HEIC/HEIF bytes to JPEG using heic-convert (wasm) when available. */
export async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Optional dependency — install heic-convert for production HEIC support.
    const mod = (await import('heic-convert')) as {
      default?: (o: { buffer: Buffer; format: string; quality: number }) => Promise<Buffer>;
    };
    const convert = mod.default ?? (mod as unknown as (o: { buffer: Buffer; format: string; quality: number }) => Promise<Buffer>);
    const out = await convert({ buffer: Buffer.from(bytes), format: 'JPEG', quality: 0.9 });
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

/** Office → PDF via LibreOffice if `soffice` exists on PATH (optional). */
export async function officeToPdf(bytes: Uint8Array, fileName: string): Promise<Uint8Array | null> {
  const dir = await mkdtemp(join(tmpdir(), 'accsys-office-'));
  try {
    const input = join(dir, fileName.replace(/[^\w.\u4e00-\u9fff-]+/g, '_').slice(0, 80) || 'doc.docx');
    await writeFile(input, bytes);
    const { code, stderr } = await runIsolated(
      'soffice',
      ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--convert-to', 'pdf', '--outdir', dir, input],
      { cwd: dir, timeoutMs: 60_000 }
    );
    if (code !== 0) {
      console.warn('[derivatives] soffice failed:', stderr.slice(0, 500));
      return null;
    }
    const base = input.replace(/\.[^.]+$/, '') + '.pdf';
    const pdf = await readFile(base);
    if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') return null;
    return new Uint8Array(pdf);
  } catch (err) {
    console.warn('[derivatives] office convert unavailable:', (err as Error).message);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function ensurePreviewDerivative(attachmentId: string): Promise<
  | { ok: true; derivativeId: string; mimeType: string }
  | { ok: false; error: string; pending?: boolean }
> {
  const db = getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row) return { ok: false, error: 'not_found' };

  const [existing] = await db
    .select()
    .from(attachmentDerivatives)
    .where(
      and(
        eq(attachmentDerivatives.attachmentId, attachmentId),
        eq(attachmentDerivatives.status, 'ready')
      )
    )
    .limit(1);
  if (existing) return { ok: true, derivativeId: existing.id, mimeType: existing.mimeType };

  let bytes: Buffer;
  try {
    bytes = await readNoFollow(row.storagePath);
  } catch {
    return { ok: false, error: 'read_failed' };
  }
  const sniffed = sniffAllowedType(bytes);
  if (sniffed !== row.mimeType) return { ok: false, error: 'type_mismatch' };
  const sourceSha = row.sha256 ?? createHash('sha256').update(bytes).digest('hex');

  let out: Uint8Array | null = null;
  let outMime = 'image/jpeg';
  let kind: 'preview_image' | 'preview_pdf' = 'preview_image';

  if (row.mimeType === 'image/heic' || row.mimeType === 'image/heif') {
    out = await heicToJpeg(bytes);
    outMime = 'image/jpeg';
    kind = 'preview_image';
  } else if (row.mimeType.startsWith('application/vnd.openxmlformats')) {
    out = await officeToPdf(bytes, row.fileName);
    outMime = 'application/pdf';
    kind = 'preview_pdf';
  } else {
    return { ok: false, error: 'no_derivative_needed' };
  }

  const derId = randomUUID();
  const storagePath = `derivatives/${row.formType}/${row.formId}/${derId}`;

  if (!out) {
    await db.insert(attachmentDerivatives).values({
      id: derId,
      attachmentId,
      kind,
      mimeType: outMime,
      storagePath,
      fileSizeBytes: 0,
      sourceSha256: sourceSha,
      rendererVersion: RENDERER_VERSION,
      status: 'failed',
      error: 'conversion_failed',
    });
    return { ok: false, error: 'conversion_failed' };
  }

  await writeNew(storagePath, out);
  await db.insert(attachmentDerivatives).values({
    id: derId,
    attachmentId,
    kind,
    mimeType: outMime,
    storagePath,
    fileSizeBytes: out.length,
    sourceSha256: sourceSha,
    rendererVersion: RENDERER_VERSION,
    status: 'ready',
  });
  return { ok: true, derivativeId: derId, mimeType: outMime };
}
