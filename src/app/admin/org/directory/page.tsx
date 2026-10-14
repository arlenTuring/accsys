import { redirect } from 'next/navigation';
import { getDirectoryPageData } from '@/lib/admin/directory/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { DirectoryReview } from './directory-review';

export const dynamic = 'force-dynamic';

export default async function OrgDirectoryPage() {
  const employee = await getCurrentEmployee();
  if (!employee || employee.role !== 'admin') redirect('/dashboard');
  return <DirectoryReview currentEmployeeId={employee.id} data={await getDirectoryPageData()} />;
}
