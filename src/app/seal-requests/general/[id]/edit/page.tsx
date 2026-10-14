import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAttachments } from '@/lib/attachments/queries';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getGeneralSealDetail } from '@/lib/general-seals/queries';
import { getSealPartyOptions, withApplicant } from '@/lib/seal-requests/queries';
import { taipeiToday } from '@/lib/taipei-date';
import { sealAccess } from '../../../seal-detail-parts';
import { GeneralSealForm } from '../../general-seal-form';

export default async function EditGeneralSealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const detail = await getGeneralSealDetail(id);
  if (!detail) notFound();

  const { canSelfEdit, canResubmit } = sealAccess(detail, employee.id);
  const kind = canSelfEdit ? 'update' : canResubmit ? 'resubmit' : null;
  if (!kind) redirect(`/seal-requests/general/${id}`);

  const [parties, attachments] = await Promise.all([getSealPartyOptions(), getAttachments('general_seal_request', id)]);

  return (
    <main className="page-shell">
      <nav className="mb-4 text-sm text-td-muted">
        <Link href="/seal-requests" className="hover:text-td-blue">
          用印申請
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/seal-requests/general/${id}`} className="hover:text-td-blue">
          {detail.caseNumber}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{kind === 'update' ? '編輯' : '修改並重新送出'}</span>
      </nav>
      <GeneralSealForm
        currentEmployee={{ id: employee.id, departmentId: employee.departmentId }}
        parties={withApplicant(parties, detail)}
        applicationDate={detail.applicationDate}
        today={taipeiToday()}
        mode={{ kind, sealRequestId: id, version: detail.version, existingAttachmentCount: attachments.length }}
        initial={{
          applicantEmployeeId: detail.applicantEmployeeId,
          departmentId: detail.departmentId,
          urgency: detail.urgency,
          expectedCompletionDate: detail.expectedCompletionDate,
          remark: detail.remark,
          documentType: detail.documentType,
          documentDescription: detail.documentDescription,
          seals: detail.seals,
          lendSeal: detail.lendSeal ? 'yes' : 'no',
          lendSealNote: detail.lendSealNote,
        }}
      />
    </main>
  );
}
