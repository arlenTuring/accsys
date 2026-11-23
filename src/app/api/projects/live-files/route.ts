import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';
import { syncProjectFilesFromDrive } from '@/lib/projects/live-drive-sync';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const [employee, featureFlags] = await Promise.all([
    getCurrentEmployee(),
    getSystemFeatureFlags(),
  ]);
  if (!employee) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!featureFlags.project_assistant) {
    return NextResponse.json(
      { error: '專案助手功能目前未獲授權或已關閉，禁止存取。' },
      { status: 403 }
    );
  }

  const projectId = request.nextUrl.searchParams.get('projectId')?.trim();
  if (!projectId) {
    return NextResponse.json({ error: 'missing projectId' }, { status: 400 });
  }

  const viewer = {
    name: employee.name,
    email: employee.email,
    role: employee.role,
    departmentCode: employee.departmentCode,
    departmentName: employee.departmentName,
    isGeneralManager: employee.isGeneralManager,
    isChairman: employee.isChairman,
  };

  const result = await syncProjectFilesFromDrive(projectId, viewer);
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
