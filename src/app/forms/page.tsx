import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getFormCatalog } from '@/lib/forms/catalog-server';

export default async function FormsHubPage() {
  if (!(await getCurrentEmployee())) redirect('/login?returnTo=/forms');
  const categories = await getFormCatalog();
  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">申請表單</p>
        <h1 className="page-title">我要申請</h1>
        <p className="page-subtitle">依用途選擇表單；已送出的表單可在各分類下方的「我的申請」查看進度。</p>
      </section>

      {categories.map((category) => (
        <section key={category.id} id={category.id} className="card scroll-mt-24">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-td-blue-dark">{category.title}</h2>
              <p className="mt-1 text-sm text-td-muted">{category.description}</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {category.records.map((r) => (
                <Link key={r.href} href={r.href} className="text-sm font-semibold text-td-blue hover:underline">
                  {r.label} →
                </Link>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {category.forms.map((f) => (
              <Link
                key={f.href}
                href={f.href}
                className="group flex flex-col rounded-lg border border-td-border bg-white px-4 py-3 transition hover:border-td-blue/50 hover:bg-td-blue-light/30"
              >
                <span className="font-semibold text-td-blue-dark">{f.title}</span>
                <span className="mt-1 flex-1 text-sm text-td-muted">{f.description}</span>
                <span className="mt-2 text-sm font-semibold text-td-blue group-hover:underline">填寫 →</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
