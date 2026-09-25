import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForAcceptance } from '@/lib/acceptances/queries';
import { AcceptanceForm } from './acceptance-form';

export default async function NewAcceptancePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const eligible = await getEligiblePurchaseOrdersForAcceptance();

  if (!orderId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增驗收單</h1>
        {eligible.length === 0 ? (
          <p className="text-gray-500">目前沒有已核准、尚未建立驗收單的採購單。</p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((o) => (
              <li key={o.id}>
                <a href={`/acceptances/new?orderId=${o.id}`} className="text-blue-600 underline">
                  {o.caseNumber}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((o) => o.id === orderId);
  if (!selected) redirect('/acceptances/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增驗收單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <AcceptanceForm
        purchaseOrderId={selected.id}
        items={selected.items}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
