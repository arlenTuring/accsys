import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { buildPropertyRegisterWorkbookBuffer } from '@/lib/assets/export-property-workbook';
import { getScopedAssetRegister } from '@/lib/assets/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const rawScope = request.nextUrl.searchParams.get('scope');
  const includeLeft = request.nextUrl.searchParams.get('includeLeft') === 'true';
  const stageFilter = request.nextUrl.searchParams.get('stage');
  const wantScope: 'mine' | 'department' | 'company' =
    rawScope === 'company' || rawScope === 'department' || rawScope === 'mine'
      ? rawScope
      : employee.role === 'finance' || employee.role === 'admin'
        ? 'company'
        : 'mine';

  const { rows: allRows, scope } = await getScopedAssetRegister({ scope: wantScope });
  const rows = allRows.filter((r) => {
    if (!includeLeft && r.status !== 'in_custody' && r.status !== 'lent') return false;
    if (stageFilter && stageFilter !== 'all' && r.inventoryConfirmStage !== stageFilter) return false;
    return true;
  });

  const scopeLabel =
    scope === 'company' ? '全公司財產清冊' : scope === 'department' ? '轄下部門財產清冊' : '個人名下保管財產清冊';

  const buffer = await buildPropertyRegisterWorkbookBuffer(rows, {
    scopeLabel,
    exportedBy: employee.name,
  });

  const datePart = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const filename = `財產保管清冊-盤點表-${datePart}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="property-register-${datePart}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
