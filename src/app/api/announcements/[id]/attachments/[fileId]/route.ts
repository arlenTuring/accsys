import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readAnnouncementAttachmentFor } from '@/lib/announcements/attachments';
import { contentDisposition } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;
  const employee = await getCurrentEmployee();
  const result = await readAnnouncementAttachmentFor({
    actor: employee,
    announcementId: id,
    attachmentId: fileId,
  });
  if (!result.ok) {
    const error = result.status === 409 ? 'not_available' : 'not_found';
    return NextResponse.json({ error }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': result.mimeType,
      'Content-Length': String(result.bytes.length),
      'Content-Disposition': contentDisposition(result.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
