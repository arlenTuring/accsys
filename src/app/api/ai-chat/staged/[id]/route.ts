import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readStagedImageForOwner } from '@/lib/ai-chat/staged-images';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const file = await readStagedImageForOwner(employee.id, id);
  if (!file) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.fileName)}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
