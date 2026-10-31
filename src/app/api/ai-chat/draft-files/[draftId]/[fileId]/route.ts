import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDraftForOwner } from '@/lib/ai-chat/drafts';
import { readDraftFileBytes } from '@/lib/ai-chat/attach-staged';
import { readEditOutput } from '@/lib/ai-chat/file-edits';
import { heicToJpeg } from '@/lib/attachments/derivatives';
import { contentDispositionInline } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

/** Inline preview / download for files attached to an AI draft. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ draftId: string; fileId: string }> }
) {
  const employee = await getCurrentEmployee();
  if (!employee) return new NextResponse('Unauthorized', { status: 401 });
  const { draftId, fileId } = await ctx.params;
  const draft = await getDraftForOwner(draftId, employee.id);
  if (!draft) return new NextResponse('Not found', { status: 404 });
  const file = await readDraftFileBytes(draftId, fileId);
  if (!file) return new NextResponse('Not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  if (file.activeEditId && !q.has('original')) {
    const edited = await readEditOutput(file.activeEditId, employee.id);
    if (edited) {
      return new NextResponse(Buffer.from(edited.bytes), { status: 200, headers: { 'Content-Type': edited.mimeType, 'Cache-Control': 'private, no-store' } });
    }
  }
  if (q.has('preview') && /^image\/hei[cf]$/.test(file.mimeType)) {
    const jpeg = await heicToJpeg(file.bytes);
    if (!jpeg) return new NextResponse('Preview failed', { status: 422 });
    return new NextResponse(Buffer.from(jpeg), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
  }
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
