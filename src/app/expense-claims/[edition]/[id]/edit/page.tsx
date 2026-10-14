import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { EDITIONS, isExpenseEdition } from '@/lib/expense-claims/editions';
import {
  getDepartmentOptions,
  getExpenseBudgetOptions,
  getExpenseClaimDetail,
  getPayeeSupplierOptions,
} from '@/lib/expense-claims/queries';
import { FORM_ROUTE_PREFIX } from '@/lib/procurement/form-registry';
import { taipeiToday } from '@/lib/taipei-date';
import { ExpenseClaimForm } from '../../../expense-claim-form';

/** Decimal strings from the database without trailing zeros ("1490.00" -> "1490"). */
const plain = (v: string) => String(Number(v));

export default async function EditExpenseClaimPage({ params }: { params: Promise<{ edition: string; id: string }> }) {
  const { edition, id } = await params;
  if (!isExpenseEdition(edition)) notFound();
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const detail = await getExpenseClaimDetail(edition, id);
  if (!detail) notFound();
  const formType = EDITIONS[edition].formType;
  const base = `${FORM_ROUTE_PREFIX[formType]}/${id}`;

  const isApplicant = detail.applicantEmployeeId === employee.id;
  const kind =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1
      ? 'update'
      : isApplicant && detail.status === 'returned'
        ? 'resubmit'
        : null;
  if (!kind) redirect(base);

  const [departments, budgetOptions, suppliers, attachments] = await Promise.all([
    getDepartmentOptions(),
    getExpenseBudgetOptions(edition),
    getPayeeSupplierOptions(),
    getAttachments(formType, id),
  ]);
  const options = budgetOptions.some((b) => b.id === detail.budgetCodeId)
    ? budgetOptions
    : [{ id: detail.budgetCodeId, scopeName: '', label: detail.budgetLabel }, ...budgetOptions];

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/expense-claims" className="hover:text-td-blue">
          費用申請
        </Link>
        <span className="mx-2">/</span>
        <Link href={base} className="hover:text-td-blue">
          {detail.caseNumber}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{kind === 'update' ? '編輯' : '修改並重新送出'}</span>
      </nav>
      <ExpenseClaimForm
        edition={edition}
        applicantName={detail.applicantName}
        today={taipeiToday()}
        applicationDate={detail.applicationDate}
        departments={departments}
        budgetOptions={options}
        suppliers={suppliers}
        mode={{ kind, claimId: id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={{
          departmentId: detail.departmentId,
          budgetCodeId: detail.budgetCodeId,
          items: detail.items.map((i) => ({
            category: i.category,
            description: i.description,
            currency: i.currency,
            exchangeRate: plain(i.exchangeRate),
            amount: plain(i.amount),
          })),
          remark: detail.remark ?? '',
          payeeType: detail.payeeType,
          payeeSupplierId: detail.payeeSupplierId ?? '',
          expectedPaymentDate: detail.expectedPaymentDate,
          paymentMethod: detail.paymentMethod,
          remittanceInfo: detail.remittanceInfo,
        }}
      />
    </main>
  );
}
