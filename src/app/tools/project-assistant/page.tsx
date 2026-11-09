import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  filterYearGroupsForViewer,
  HISTORICAL_YEAR_GROUPS,
} from '@/lib/projects/historical-projects-data';
import { ProjectAssistantClient } from './project-assistant-client';

export default async function ProjectAssistantPage() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    redirect('/login?returnTo=/tools/project-assistant');
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
