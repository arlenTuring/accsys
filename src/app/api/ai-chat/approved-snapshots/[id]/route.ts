import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readSnapshotBytes } from '@/lib/ai-chat/approved-pdf';
import { canAccessApprovedSnapshot } from '@/lib/attachments/preview-access';
import { contentDispositionInline } from '@/lib/attachments/validate';

export const dynamic = 'force-dynamic';

/**
 * Inline PDF for approved snapshots. Authorization is target-document based:
 * source readers, draft owners who linked it, or readers of the submitted form.
 * Does not grant access to other fields on the source application.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const employee = await getCurrentEmployee();
  if (!employee) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const actor = { id: employee.id, role: employee.role };
  if (!(await canAccessApprovedSnapshot(actor, id))) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }

  try {
    const file = await readSnapshotBytes(id);
    if (!file) return new NextResponse('Not found', { status: 404 });
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDispositionInline(file.fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Hash': file.contentHash,
      },
    });
  } catch {
    return new NextResponse('Conflict', { status: 409 });
  }
}
