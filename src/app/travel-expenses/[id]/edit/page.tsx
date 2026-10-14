import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getTravelBudgetOptions, getTravelExpenseDetail } from '@/lib/travel-expenses/queries';
import { TravelExpenseForm } from '../../travel-expense-form';

/** Decimal strings from the database without trailing zeros ("1490.00" -> "1490"). */
const plain = (v: string) => String(Number(v));

export default async function EditTravelExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const detail = await getTravelExpenseDetail(id);
  if (!detail) notFound();

  const isApplicant = detail.applicantEmployeeId === employee.id;
  const kind =
    isApplicant && detail.status === 'pending_approval' && detail.currentStepOrder === 1
      ? 'update'
      : isApplicant && detail.status === 'returned'
        ? 'resubmit'
        : null;
  if (!kind) redirect(`/travel-expenses/${id}`);

  const [budgetOptions, attachments] = await Promise.all([getTravelBudgetOptions(), getAttachments('travel_expense', id)]);
  const options = budgetOptions.some((b) => b.id === detail.budgetCodeId)
    ? budgetOptions
    : [{ id: detail.budgetCodeId, label: detail.budgetLabel }, ...budgetOptions];

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/travel-expenses" className="hover:text-td-blue">
          出差報支
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/travel-expenses/${id}`} className="hover:text-td-blue">
          {detail.caseNumber}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{kind === 'update' ? '編輯' : '修改並重新送出'}</span>
      </nav>
      <TravelExpenseForm
        applicantName={detail.applicantName}
        departmentName={detail.departmentName}
        formDate={detail.formDate}
        budgetOptions={options}
        mode={{ kind, travelExpenseId: id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={{
          budgetCodeId: detail.budgetCodeId,
          advanceAmount: plain(detail.advanceAmount),
          tripStartDate: detail.tripStartDate,
          tripEndDate: detail.tripEndDate,
          purpose: detail.purpose,
          tripOrderNo: detail.tripOrderNo,
          companions: detail.companions,
          reportItems: detail.reportItems.map(({ tripDate, location, itinerary, timeSlot }) => ({
            tripDate,
            location,
            itinerary,
            timeSlot,
          })),
          costItems: detail.costItems.map((c) => ({
            expenseDate: c.expenseDate,
            category: c.category,
            fromStation: c.fromStation ?? '',
            toStation: c.toStation ?? '',
            mileage: c.mileage ? plain(c.mileage) : '',
            summary: c.summary,
            currency: c.currency,
            amount: plain(c.amount),
            exchangeRate: c.currency === 'TWD' ? '' : plain(c.exchangeRate),
          })),
        }}
      />
    </main>
  );
}
