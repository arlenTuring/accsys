import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';
import {
  filterYearGroupsForViewer,
  HISTORICAL_YEAR_GROUPS,
} from '@/lib/projects/historical-projects-data';
import { ProjectAssistantClient } from './project-assistant-client';

export default async function ProjectAssistantPage() {
  const [employee, featureFlags] = await Promise.all([
    getCurrentEmployee(),
    getSystemFeatureFlags(),
  ]);

  if (!employee) {
    redirect('/login?returnTo=/tools/project-assistant');
  }

  if (!featureFlags.project_assistant) {
    return (
      <main className="page-shell flex min-h-[70vh] items-center justify-center">
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl">
            🔒
          </div>
          <h1 className="text-lg font-bold text-td-blue-dark">
            「專案助手」功能目前為關閉狀態
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            此功能預設為關閉。若您需要啟用「專案助手（GWS 歷年專案知識庫與共編助手）」，請由系統管理員至「系統管理 → 功能授權」將其開啟。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {employee.role === 'admin' && (
              <Link
                href="/admin/feature-flags"
                className="rounded-lg bg-td-blue px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-td-blue-dark"
              >
                ⚙️ 前往「系統管理 → 功能授權」開啟
              </Link>
            )}
            <Link
              href="/applications"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              返回我的待辦
            </Link>
          </div>
        </div>
      </main>
    );
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

  // Strictly filter out any projects, folders, or files (including filenames)
  // that this account is not authorized to view BEFORE sending data to the client.
  const visibleGroups = filterYearGroupsForViewer(HISTORICAL_YEAR_GROUPS, viewer);

  return (
    <main className="flex h-full w-full flex-col overflow-hidden">
      <ProjectAssistantClient groups={visibleGroups} viewer={viewer} />
    </main>
  );
}
