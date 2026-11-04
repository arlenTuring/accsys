import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canManageSurveys, createSurvey } from '@/lib/surveys/service';

/** Create a draft and open the single editor page (title + questions together). */
export default async function AdminSurveyNewPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!(await canManageSurveys(employee))) redirect('/surveys');

  const result = await createSurvey(employee, {
    title: '未命名問卷',
    description: '',
  });
  if (!result.ok) {
    redirect('/admin/surveys?error=create_failed');
  }
  redirect(`/admin/surveys/${result.survey.id}/edit`);
}
