import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getAcceptanceDetail } from '@/lib/acceptances/queries';
import { AcceptanceForm } from '../../new/acceptance-form';

export default async function EditAcceptancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getAcceptanceDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/acceptances/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/acceptances/${id}`);

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改驗收單</h1>
      <AcceptanceForm
        purchaseOrderId=""
        items={detail.items.map((i) => ({
          id: i.itemId,
          description: i.description,
          quantity: i.quantity,
        }))}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        acceptanceId={id}
        initialValues={{
          contractorSupplierId: detail.contractorSupplierId,
          acceptanceDate: detail.acceptanceDate,
          passFail: Object.fromEntries(detail.items.map((i) => [i.itemId, i.passFail])),
        }}
      />
    </main>
  );
}
