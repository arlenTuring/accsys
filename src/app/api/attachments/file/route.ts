import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { readAttachmentBytes } from '@/lib/storage/local';

export async function GET(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const path = new URL(request.url).searchParams.get('path');
  if (!path || path.includes('..')) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  const bytes = await readAttachmentBytes(path);
  if (!bytes) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'inline',
    },
  });
}
