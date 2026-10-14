import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export const dynamic = 'force-dynamic';

/** Internal reference documents for signed-in employees. Files under public/ skip the session check. */
const DOCUMENTS: Record<string, string> = {
  'nda-mou-review-notes.pdf': 'nda-mou-review-notes.pdf',
};

const DOCS_DIR = path.join(process.cwd(), 'assets', 'docs');

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const name = Object.hasOwn(DOCUMENTS, file) ? DOCUMENTS[file] : undefined;
  const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!name || !(await getCurrentEmployee())) return notFound();
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(DOCS_DIR, name));
  } catch (err) {
    console.error(`[docs] cannot read ${name}:`, (err as Error).message);
    return notFound();
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
