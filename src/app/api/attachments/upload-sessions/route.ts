import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { createUploadSession } from '@/lib/attachments/upload-sessions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const result = await createUploadSession({
    actor: { id: employee.id, role: employee.role },
    purpose: body.purpose === 'ai_chat' || body.purpose === 'draft' ? body.purpose : 'form',
    clientUploadId: String(body.clientUploadId ?? ''),
    fileName: String(body.fileName ?? 'file'),
    declaredSizeBytes: Number(body.declaredSizeBytes),
    declaredMime: typeof body.declaredMime === 'string' ? body.declaredMime : null,
    formType: typeof body.formType === 'string' ? body.formType : null,
    formId: typeof body.formId === 'string' ? body.formId : null,
    conversationId: typeof body.conversationId === 'string' ? body.conversationId : null,
    chunkSizeBytes: typeof body.chunkSizeBytes === 'number' ? body.chunkSizeBytes : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
