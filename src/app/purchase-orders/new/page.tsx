import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseRequestsForOrder } from '@/lib/purchase-orders/queries';
import { PurchaseOrderForm } from './purchase-order-form';

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const { requestId } = await searchParams;
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const eligible = await getEligiblePurchaseRequestsForOrder();

  if (!requestId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="mb-6 text-2xl font-bold">新增採購單</h1>
        {eligible.length === 0 ? (
          <p className="text-gray-500">目前沒有已核准、尚未建立採購單的請購單。</p>
        ) : (
          <ul className="space-y-2">
            {eligible.map((r) => (
              <li key={r.id}>
                <a href={`/purchase-orders/new?requestId=${r.id}`} className="text-blue-600 underline">
                  {r.caseNumber}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const selected = eligible.find((r) => r.id === requestId);
  if (!selected) redirect('/purchase-orders/new');

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-2xl font-bold">新增採購單</h1>
      <p className="mb-6 font-mono text-gray-600">{selected.caseNumber}</p>
      <PurchaseOrderForm
        purchaseRequestId={selected.id}
        items={selected.items}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
