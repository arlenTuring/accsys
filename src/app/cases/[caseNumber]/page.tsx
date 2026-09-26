import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getCaseOverview } from '@/lib/cases/queries';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';

const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
};

export default async function CaseOverviewPage({
  params,
}: {
  params: Promise<{ caseNumber: string }>;
}) {
  const { caseNumber } = await params;
  const overview = await getCaseOverview(caseNumber);
  if (!overview) notFound();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="mb-6 text-2xl font-bold">案件總覽</h1>
      <p className="mb-4 font-mono text-gray-600">{overview.caseNumber}</p>
      <ul className="space-y-2">
        {overview.forms.map((f) => (
          <li
            key={f.formType}
            className="flex items-center justify-between rounded border p-3 text-sm"
          >
            <span>
              {f.itemCode}｜{f.label}
            </span>
            {f.restricted ? (
              <span className="text-gray-400">已建立（無檢視權限）</span>
            ) : f.exists ? (
              <span className="flex items-center gap-2">
                <Link href={`${FORM_ROUTE_PREFIX[f.formType]}/${f.id}`} className="text-blue-600 underline">
                  {STATUS_LABELS[f.status ?? ''] ?? f.status}
                </Link>
                {!f.hasAttachments && (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    憑證待補
                  </span>
                )}
              </span>
            ) : (
              <span className="text-gray-400">尚未建立</span>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
