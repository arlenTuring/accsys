import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { stageAiChatImage } from '@/lib/ai-chat/staged-images';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Multipart upload for AI chat staging — keeps the original file; avoids base64 inflation through Server Actions.
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
    bytes,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, code: result.code },
      { status: result.code === 'too_large' ? 413 : 400 }
    );
  }

  // After security scan passes, start AI analysis in the background (no confirm gate).
  if (result.staged.scanStatus === 'ready') {
    const { startStagedChecks } = await import('@/lib/ai-chat/staged-invoice');
    void startStagedChecks(employee.id, [result.staged.id]).catch(() => undefined);
  }
  return NextResponse.json({ ok: true, staged: result.staged, scanStatus: result.staged.scanStatus });
}
