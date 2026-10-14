import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getInvoiceSealDetail } from '@/lib/invoice-seals/queries';
import { centsToNumber, toCents } from '@/lib/money';
import { getSealPartyOptions, withApplicant } from '@/lib/seal-requests/queries';
import { sealAccess } from '../../../seal-detail-parts';
import { InvoiceSealForm } from '../../invoice-seal-form';

/** "45000.00" → "45000", "19.90" → "19.9". */
const plain = (decimal: string) => String(centsToNumber(toCents(decimal)));

export default async function EditInvoiceSealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const detail = await getInvoiceSealDetail(id);
  if (!detail) notFound();

  const { canSelfEdit, canResubmit } = sealAccess(detail, employee.id);
  const kind = canSelfEdit ? 'update' : canResubmit ? 'resubmit' : null;
  if (!kind) redirect(`/seal-requests/invoices/${id}`);

  const [parties, attachments] = await Promise.all([getSealPartyOptions(), getAttachments('invoice_seal_request', id)]);

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/seal-requests" className="hover:text-td-blue">
          用印申請
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/seal-requests/invoices/${id}`} className="hover:text-td-blue">
          {detail.caseNumber}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{kind === 'update' ? '編輯' : '修改並重新送出'}</span>
      </nav>
      <InvoiceSealForm
        currentEmployee={{ id: employee.id, departmentId: employee.departmentId }}
        parties={withApplicant(parties, detail)}
        applicationDate={detail.applicationDate}
        mode={{ kind, sealRequestId: id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={{
          applicantEmployeeId: detail.applicantEmployeeId,
          departmentId: detail.departmentId,
          invoiceType: detail.invoiceType,
          seal: detail.seal,
          customerName: detail.customerName,
          customerTaxId: detail.customerTaxId,
          customerAddress: detail.customerAddress,
          customerPhone: detail.customerPhone,
          items: detail.items.map((it) => ({
            itemName: it.itemName,
            quantity: String(it.quantity),
            currency: it.currency,
            unitPrice: plain(it.unitPrice),
          })),
          totalAmount: plain(detail.totalAmount),
        }}
      />
    </main>
  );
}
