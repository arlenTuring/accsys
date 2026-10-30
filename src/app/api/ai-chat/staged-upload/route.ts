import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { stageAiChatImage } from '@/lib/ai-chat/staged-images';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Multipart upload for AI chat staging — avoids base64 inflation through Server Actions.
 * Body still subject to proxyClientMaxBodySize (configured 55mb).
 */
export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '無法讀取上傳內容', code: 'bad_body' }, { status: 400 });
  }

  const file = form.get('file');
  const conversationId = String(form.get('conversationId') ?? '');
  const clientAttachmentId = String(form.get('clientAttachmentId') ?? '');
  if (!(file instanceof File) || !conversationId || !clientAttachmentId) {
    return NextResponse.json({ error: '缺少檔案或對話識別', code: 'invalid' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await stageAiChatImage({
    ownerEmployeeId: employee.id,
    conversationId,
    clientAttachmentId,
    fileName: file.name || 'image',
    mimeType: file.type || 'application/octet-stream',
    bytes,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.code === 'too_large' ? 413 : 400 }
    );
  }

  // Business invoice check after security scan — remind, never block staging.
  let invoice: import('@/lib/attachments/invoice-check').InvoiceCheckResult | null = null;
  try {
    const { analyzeStagedAttachment } = await import('@/lib/ai-chat/staged-invoice');
    const analyzed = await analyzeStagedAttachment({
      ownerEmployeeId: employee.id,
      stagedId: result.staged.id,
    });
    if (analyzed.ok) {
      invoice = analyzed.result;
    } else {
      invoice = {
        complete: false,
        pagesAnalysed: 0,
        pagesTotal: null,
        overallStatus: 'analysis_failed',
        summary: '無法完成發票／統編檢查；安全掃描已通過，確認後仍可夾帶',
        pages: [],
        usedVision: false,
      };
    }
  } catch (err) {
    console.warn('[staged-upload] invoice analyze:', (err as Error).message);
    invoice = {
      complete: false,
      pagesAnalysed: 0,
      pagesTotal: null,
      overallStatus: 'analysis_failed',
      summary: '發票檢查發生錯誤；安全掃描已通過，確認後仍可夾帶',
      pages: [],
      usedVision: false,
    };
  }

  return NextResponse.json({
    ok: true,
    staged: result.staged,
    scanStatus: result.staged.scanStatus,
    invoice,
  });
}
