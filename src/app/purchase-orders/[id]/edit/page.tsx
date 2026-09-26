import { redirect, notFound } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getPurchaseOrderDetail } from '@/lib/purchase-orders/queries';
import { PurchaseOrderForm } from '../../new/purchase-order-form';

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');

  const detail = await getPurchaseOrderDetail(id);
  if (!detail) notFound();
  if (detail.applicantEmployeeId !== employee.id) redirect(`/purchase-orders/${id}`);
  if (detail.status !== 'pending_approval' || detail.currentStepOrder !== 1) redirect(`/purchase-orders/${id}`);

  const { data: suppliers } = await supabase.from('suppliers').select('id, name').order('name');

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">修改採購單</h1>
      <PurchaseOrderForm
        purchaseRequestId=""
        items={detail.items.map((i) => ({
          id: i.itemId,
          description: i.description,
          quantity: i.quantity,
          budgetCode: i.budgetCode,
        }))}
        suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
        mode="edit"
        orderId={id}
        expectedVersion={detail.version}
        initialValues={{
          prices: Object.fromEntries(detail.items.map((i) => [i.itemId, String(i.unitPrice)])),
          supplierId: detail.supplierId,
          paymentMethod: detail.paymentMethod,
          paymentTerms: detail.paymentTerms,
          expectedDeliveryDays: detail.expectedDeliveryDays != null ? String(detail.expectedDeliveryDays) : '',
          quoteCount: String(detail.quoteCount),
          quoteCountReason: detail.quoteCountReason ?? '',
        }}
      />
    </main>
  );
}
