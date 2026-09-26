import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readAttachmentFor } from '@/lib/attachments/service';
import { contentDisposition } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await readAttachmentFor(await getCurrentEmployee(), id);
  if (!result.ok) {
    const error = result.status === 409 ? 'not_available' : 'not_found';
    return NextResponse.json({ error }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': result.mimeType,
      'Content-Length': String(result.bytes.length),
      // Always a download: never rendered as a page on the app origin.
      'Content-Disposition': contentDisposition(result.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
