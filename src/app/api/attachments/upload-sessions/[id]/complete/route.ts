import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { completeUploadSession } from '@/lib/attachments/upload-sessions';
import { uploadAttachmentFor } from '@/lib/attachments/service';
import { ensurePreviewDerivative } from '@/lib/attachments/derivatives';
import { runInvoiceCheckForAttachment } from '@/lib/attachments/invoice-check';

export const dynamic = 'force-dynamic';

/**
 * Completes a chunked upload and, for form purpose, persists via the normal
 * attachment pipeline (scan + auth). Returns attachmentId when formType/formId set.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    formType?: string;
    formId?: string;
    runInvoiceCheck?: boolean;
  };

  const assembled = await completeUploadSession({
    actor: { id: employee.id, role: employee.role },
    sessionId: id,
  });
  if (!assembled.ok) return NextResponse.json({ error: assembled.error }, { status: 400 });

  if (body.formType && body.formId) {
    const file = new File([Buffer.from(assembled.bytes)], assembled.fileName, { type: assembled.mime });
    const uploaded = await uploadAttachmentFor(
      { id: employee.id, role: employee.role },
      body.formType,
      body.formId,
      file
    );
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: 400 });

    void ensurePreviewDerivative(uploaded.attachmentId).catch(() => undefined);
    let invoice = null;
    if (body.runInvoiceCheck !== false) {
      try {
        invoice = await runInvoiceCheckForAttachment(uploaded.attachmentId);
      } catch {
        invoice = null;
      }
    }
    return NextResponse.json({
      ok: true,
      attachmentId: uploaded.attachmentId,
      scanStatus: uploaded.scanStatus,
      sha256: assembled.sha256,
      mime: assembled.mime,
      invoice,
    });
  }

  return NextResponse.json({
    ok: true,
    sha256: assembled.sha256,
    mime: assembled.mime,
    fileName: assembled.fileName,
    size: assembled.bytes.length,
    // Caller (AI chat) must stage via existing action with bytes from a follow-up if needed.
    note: 'assembled_only',
  });
}
