import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMySubmissions } from '@/lib/custom-forms/queries';
import { SubmissionList } from './submission-list';

export default async function MyDesignerFormsPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/f');
  const items = await getMySubmissions();
  return (
    <main className="page-shell space-y-5">
      <section>
        <p className="section-title">我的申請</p>
        <h1 className="page-title">其他申請單</h1>
        <p className="page-subtitle">由表單設計器建立的表單，送出後都在這裡。</p>
      </section>
      <SubmissionList items={items} showName />
    </main>
  );
}
