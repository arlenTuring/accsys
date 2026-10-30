import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { putUploadChunk } from '@/lib/attachments/upload-sessions';
import { UPLOAD_CHUNK_BYTES } from '@/lib/attachments/policy';

export const dynamic = 'force-dynamic';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id, index } = await params;
  const chunkIndex = Number(index);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: 'invalid_index' }, { status: 400 });
  }
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > UPLOAD_CHUNK_BYTES) {
    return NextResponse.json({ error: 'chunk_too_large' }, { status: 413 });
  }
  const result = await putUploadChunk({
    actor: { id: employee.id, role: employee.role },
    sessionId: id,
    chunkIndex,
    bytes: buf,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
