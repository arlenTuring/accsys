import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readPreviewFor } from '@/lib/attachments/preview-access';
import { contentDispositionInline } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

/**
 * Controlled in-app preview. Not a public CDN URL.
 * Download remains on GET /api/attachments/[id] with attachment disposition.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  const actor = employee ? { id: employee.id, role: employee.role } : null;
  const result = await readPreviewFor(actor, id);
  if (!result.ok) {
    const body =
      result.reason === 'derivative_pending'
        ? { error: 'preview_pending', message: '預覽轉換中，請稍後再試' }
        : result.reason === 'unsupported_preview'
          ? { error: 'preview_unsupported', message: '此格式無法站內預覽，請下載原檔' }
          : result.reason === 'scan_blocked'
            ? { error: 'not_available', message: '附件尚未通過安全掃描' }
            : result.reason === 'derivative_missing'
              ? { error: 'preview_failed', message: '預覽服務無法轉換此檔案。檔案本身沒有問題，請下載原檔查看。' }
              : { error: 'not_found', message: '找不到附件或沒有權限。' };
    return NextResponse.json(body, {
      status: result.status,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': result.mimeType,
      'Content-Length': String(result.bytes.length),
      'Content-Disposition': contentDispositionInline(result.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
      'X-Attachment-Id': result.attachmentId,
      'X-Preview-Kind': result.kind,
      ...(result.note ? { 'X-Preview-Note': encodeURIComponent(result.note) } : {}),
    },
  });
}
