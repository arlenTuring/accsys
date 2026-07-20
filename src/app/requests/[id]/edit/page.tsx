import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { PurchaseRequestForm, type BudgetCodeOption } from '../../new/purchase-request-form';

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getPurchaseRequestDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/requests/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/requests/${id}`);

  const { data } = await supabase
    .from('budget_codes')
    .select('id, code, category, departments(name), owner:employees!owner_employee_id(id, name)')
    .order('code');
  const budgetCodes: BudgetCodeOption[] = (data ?? []).map((b) => ({
    id: b.id,
    code: b.code,
    category: b.category,
    departmentName: (b.departments as unknown as { name: string } | null)?.name ?? '',
    ownerId: (b.owner as unknown as { id: string } | null)?.id ?? '',
    ownerName: (b.owner as unknown as { name: string } | null)?.name ?? '（未指定）',
  }));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改請購申請單</h1>
      <PurchaseRequestForm
        budgetCodes={budgetCodes}
        mode="edit"
        requestId={id}
        initialNeededWithinDays={detail.neededWithinDays}
        initialRows={detail.items.map((i) => ({
          budgetCodeId: budgetCodes.find((b) => b.code === i.budgetCode)?.id ?? '',
          itemCategory: i.itemCategory,
          description: i.description,
          quantity: String(i.quantity),
          estimatedAmount: String(i.estimatedAmount),
        }))}
      />
    </main>
  );
}
