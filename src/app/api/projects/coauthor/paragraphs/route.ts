import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readGoogleDocument } from '@/lib/projects/anchored-doc-write';
import { paragraphsFromDocument } from '@/lib/projects/doc-selection';
import { getCandidateDriveWriteTokens } from '@/lib/projects/drive-doc-writer';

/**
 * Returns the body paragraphs (text + Google Docs indices) of a Drive document the
 * current employee can read with their own token. The co-author client matches the
 * clipboard text against these locally, so unrelated clipboard content never reaches
 * the server.
 */
export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const driveFileId = request.nextUrl.searchParams.get('driveFileId')?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(driveFileId)) {
    return NextResponse.json({ reason: 'missing_file_id' }, { status: 400 });
  }

  const tokens = await getCandidateDriveWriteTokens(employee.email, { currentUserOnly: true });
  if (!tokens[0]) return NextResponse.json({ reason: 'no_tokens' }, { headers: { 'Cache-Control': 'no-store' } });

  const read = await readGoogleDocument(driveFileId, tokens[0]);
  if (!read.ok) return NextResponse.json({ reason: read.reason }, { headers: { 'Cache-Control': 'no-store' } });
  if (!read.doc.revisionId) return NextResponse.json({ reason: 'api_error' }, { headers: { 'Cache-Control': 'no-store' } });

  return NextResponse.json(
    { driveFileId, revisionId: read.doc.revisionId, paragraphs: paragraphsFromDocument(read.doc) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
