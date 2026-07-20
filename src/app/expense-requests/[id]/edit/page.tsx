import { redirect, notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getExpenseRequestDetail, getExpenseRequestSourceItems } from '@/lib/expense-requests/queries';
import { ExpenseRequestForm } from '../../new/expense-request-form';

export default async function EditExpenseRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);
  if (!employee) redirect('/login');

  const detail = await getExpenseRequestDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/expense-requests/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/expense-requests/${id}`);

  const [sourceItems, suppliersResult] = await Promise.all([
    getExpenseRequestSourceItems(id),
    supabase.from('suppliers').select('id, name').order('name'),
  ]);
  // detail.items[].sourceItemId is expense_request_items.purchase_order_item_id,
  // which is a different id space from sourceItems[].id (acceptance_item.id)
  // for acceptance-derived expense requests — match on purchaseOrderItemId,
  // not on sourceItems[].id. See the comment on ExpenseRequestSourceItem.
  const includedSourceItemIds = new Set(detail.items.map((i) => i.sourceItemId));

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改費用申請單</h1>
      <ExpenseRequestForm
        purchaseOrderId=""
        sourceItems={sourceItems}
        suppliers={(suppliersResult.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        expenseRequestId={id}
        initialValues={{
          payeeType: detail.payeeType,
          payeeSupplierId: '',
          paymentMethod: detail.paymentMethod,
          bankName: detail.bankName ?? '',
          bankAccount: detail.bankAccount ?? '',
          accountName: detail.accountName ?? '',
          invoiceMonth: detail.invoiceMonth ?? '',
          expectedPaymentDate: detail.expectedPaymentDate ?? '',
          included: Object.fromEntries(
            sourceItems.map((si) => [si.id, includedSourceItemIds.has(si.purchaseOrderItemId)])
          ),
        }}
      />
    </main>
  );
}
