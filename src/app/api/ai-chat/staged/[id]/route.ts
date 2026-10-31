import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readStagedImageForOwner } from '@/lib/ai-chat/staged-images';
import { readEditOutput } from '@/lib/ai-chat/file-edits';
import { heicToJpeg } from '@/lib/attachments/derivatives';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const file = await readStagedImageForOwner(employee.id, id);
  if (!file) return new NextResponse('Not found', { status: 404 });
  // The current edit is what people see; ?original=1 always gives the file as uploaded.
  const q = new URL(req.url).searchParams;
  if (file.activeEditId && !q.has('original')) {
    const edited = await readEditOutput(file.activeEditId, employee.id);
    if (edited) {
      return new NextResponse(Buffer.from(edited.bytes), { status: 200, headers: { 'Content-Type': edited.mimeType, 'Cache-Control': 'private, no-store' } });
    }
  }
  // ?preview=1: a JPEG view of HEIC for browsers that cannot show it; the stored original is unchanged.
  if (new URL(req.url).searchParams.has('preview') && /^image\/hei[cf]$/.test(file.mimeType)) {
    const jpeg = await heicToJpeg(file.bytes);
    if (!jpeg) return new NextResponse('Preview failed', { status: 422 });
    return new NextResponse(Buffer.from(jpeg), { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
  }
  return new NextResponse(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
