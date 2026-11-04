import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readRegulationAttachmentFor } from '@/lib/regulations/attachments';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; fileId: string }> }
) {
  const employee = await getCurrentEmployee();
  const { id, fileId } = await context.params;
  const res = await readRegulationAttachmentFor(employee, id, fileId);
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status });
  }
  const encodedName = encodeURIComponent(res.fileName);
  return new NextResponse(new Uint8Array(res.bytes), {
    status: 200,
    headers: {
      'Content-Type': res.mimeType,
      'Content-Length': String(res.bytes.byteLength),
      'Content-Disposition': `inline; filename*=UTF-8''${encodedName}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
