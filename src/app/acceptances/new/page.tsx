import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getEligiblePurchaseOrdersForAcceptance } from '@/lib/acceptances/queries';
import { SourcePicker } from '@/app/components/source-picker';
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
      <SourcePicker
        title="新增驗收單"
        hint="請選擇要驗收的採購單（需已核准、尚未建立驗收單）。"
        empty="目前沒有已核准、尚未建立驗收單的採購單。"
        backHref="/acceptances"
        backLabel="我的驗收單"
        options={eligible.map((o) => ({ href: `/acceptances/new?orderId=${o.id}`, label: o.caseNumber }))}
      />
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
