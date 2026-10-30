import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDraftForOwner } from '@/lib/ai-chat/drafts';
import { readDraftFileBytes } from '@/lib/ai-chat/attach-staged';
import { contentDispositionInline } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

/** Inline preview / download for files attached to an AI draft. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ draftId: string; fileId: string }> }
) {
  const employee = await getCurrentEmployee();
  if (!employee) return new NextResponse('Unauthorized', { status: 401 });
  const { draftId, fileId } = await ctx.params;
  const draft = await getDraftForOwner(draftId, employee.id);
  if (!draft) return new NextResponse('Not found', { status: 404 });
  const file = await readDraftFileBytes(draftId, fileId);
  if (!file) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': contentDispositionInline(file.fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
