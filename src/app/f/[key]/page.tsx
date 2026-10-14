import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getFilableDefinitions, getMySubmissions } from '@/lib/custom-forms/queries';
import { SubmissionList } from '../submission-list';

export default async function DesignerFormListPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!(await getCurrentEmployee())) redirect(`/login?returnTo=/f/${encodeURIComponent(key)}`);
  const [items, filable] = await Promise.all([getMySubmissions(key), getFilableDefinitions()]);
  const def = filable.find((d) => d.key === key);
  // Forms the viewer can no longer file still list what they submitted earlier.
  if (!def && items.length === 0) notFound();
  const name = def?.name ?? items[0].name;
  return (
    <main className="page-shell space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">我的申請</p>
          <h1 className="page-title">我的{name}</h1>
        </div>
        {def && (
          <Link href={`/f/${key}/new`} className="btn-primary">
            填寫新申請
          </Link>
        )}
      </section>
      <SubmissionList items={items} showName={false} />
    </main>
  );
}
