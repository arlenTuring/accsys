import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { contentDispositionInline } from '@/lib/attachments/validate';
import { readSurveyMediaFor } from '@/lib/surveys/media';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id, fileId } = await params;
  const employee = await getCurrentEmployee();
  const result = await readSurveyMediaFor({
    actor: employee,
    surveyId: id,
    mediaId: fileId,
  });
  if (!result.ok) {
    const status = result.status === 403 ? 403 : result.status;
    const error = result.status === 409 ? 'not_available' : result.status === 403 ? 'forbidden' : 'not_found';
    return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      'Content-Type': result.mimeType,
      'Content-Length': String(result.bytes.length),
      'Content-Disposition': contentDispositionInline(result.fileName),
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
    },
  });
}
