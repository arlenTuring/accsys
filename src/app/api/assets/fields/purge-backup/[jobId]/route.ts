import { NextResponse } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { actorHas } from '@/lib/authz/access';
import { getPurgeJobBackupPath, readFieldPurgeBackup } from '@/lib/assets/fields/purge-backup';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const allowed =
    (await actorHas(employee, 'finance.assets_fields_purge')) ||
    employee.role === 'admin' ||
    (await actorHas(employee, 'finance.assets_fields'));
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const backupPath = await getPurgeJobBackupPath(jobId);
  if (!backupPath) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const doc = await readFieldPurgeBackup(backupPath);
  if (!doc) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="asset-field-purge-${jobId.slice(0, 8)}.json"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
