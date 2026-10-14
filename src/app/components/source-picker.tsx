import Link from 'next/link';

/** First step of forms that continue an earlier form in the procurement chain. */
export function SourcePicker({
  title,
  hint,
  empty,
  backHref,
  backLabel,
  options,
  footer,
}: {
  title: string;
  hint: string;
  empty: string;
  backHref: string;
  backLabel: string;
  options: { href: string; label: string }[];
  footer?: React.ReactNode;
}) {
  return (
    <main className="page-shell max-w-3xl">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href={backHref} className="hover:text-td-blue">
          {backLabel}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">新增</span>
      </nav>
      <section className="mb-6">
        <p className="section-title">採購流程</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{hint}</p>
      </section>
      {options.length === 0 ? (
        <div className="card text-sm text-td-muted">{empty}</div>
      ) : (
        <ul className="card divide-y divide-td-border !p-0">
          {options.map((o) => (
            <li key={o.href}>
              <Link href={o.href} className="flex items-center justify-between px-5 py-4 transition hover:bg-td-blue-light/40">
                <span className="mono-case">{o.label}</span>
                <span className="text-sm font-semibold text-td-blue">選擇 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </main>
  );
}
