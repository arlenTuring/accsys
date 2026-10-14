import Link from 'next/link';
import type { ReactNode } from 'react';
import { ROLE_LABELS, STATUS_BADGE, STATUS_LABELS } from '@/app/components/form-labels';
import { PrintButton } from '@/app/components/print-button';
import { WithdrawButton } from '@/app/requests/[id]/withdraw-button';
import type { ActionResult } from '@/lib/workflow/tx';
import type { SealStep } from '@/lib/seal-requests/queries';

// Detail-page pieces shared by the seal requests.

type SealDetailBase = {
  id: string;
  caseNumber: string;
  status: string;
  urgency?: string;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  filerEmployeeId: string;
  steps: SealStep[];
};

export const day = (iso: string) => iso.replaceAll('-', '/');

/** What the viewer may do: applicant and filer own the form; the current approver decides. */
export function sealAccess(detail: SealDetailBase, employeeId: string | undefined) {
  const currentStep =
    detail.status === 'pending_approval' && detail.currentStepOrder !== null
      ? detail.steps.find((s) => s.stepOrder === detail.currentStepOrder)
      : undefined;
  const isOwner = !!employeeId && (employeeId === detail.applicantEmployeeId || employeeId === detail.filerEmployeeId);
  return {
    isCurrentApprover: !!employeeId && currentStep?.approverEmployeeId === employeeId,
    canSelfEdit: isOwner && detail.status === 'pending_approval' && detail.currentStepOrder === 1,
    canResubmit: isOwner && detail.status === 'returned',
    returnedStep: detail.status === 'returned' ? detail.steps.find((s) => s.status === 'returned') : undefined,
  };
}

export function DetailItem({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs font-semibold text-td-muted">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-td-blue-dark">{children}</dd>
    </div>
  );
}

export function SealDetailHeader({
  title,
  detail,
  viewerId,
  basePath,
  onWithdraw,
  uploadFailed,
}: {
  title: string;
  detail: SealDetailBase;
  viewerId: string | undefined;
  basePath: string;
  onWithdraw: (id: string) => Promise<ActionResult>;
  uploadFailed: number | null;
}) {
  const { canSelfEdit, canResubmit, returnedStep } = sealAccess(detail, viewerId);
  return (
    <>
      <nav className="text-sm text-td-muted print:hidden">
        <Link href="/seal-requests" className="hover:text-td-blue">
          用印申請
        </Link>
        <span className="mx-2">/</span>
        <span className="text-td-blue-dark">{detail.caseNumber}</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="mt-1 flex items-center gap-3">
            <span className="mono-case">{detail.caseNumber}</span>
            <span className={STATUS_BADGE[detail.status] ?? 'badge-withdrawn'}>{STATUS_LABELS[detail.status] ?? detail.status}</span>
            {detail.urgency === 'urgent' && <span className="badge-returned">急件</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {detail.status === 'approved' && <PrintButton label="列印用印申請單" />}
          {canSelfEdit && (
            <Link href={`${basePath}/${detail.id}/edit`} className="btn-secondary">
              編輯
            </Link>
          )}
          {canResubmit && (
            <Link href={`${basePath}/${detail.id}/edit`} className="btn-primary">
              修改並重新送出
            </Link>
          )}
          {canSelfEdit && <WithdrawButton requestId={detail.id} onWithdraw={onWithdraw} redirectTo="/seal-requests" />}
        </div>
      </section>

      {uploadFailed && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden">
          表單已送出，但有 {uploadFailed} 個附件上傳失敗，請在下方「附件」區補傳。
        </p>
      )}
      {returnedStep && (
        <p className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {ROLE_LABELS[returnedStep.approverRole] ?? returnedStep.approverRole} {returnedStep.approverName} 退回：
          {returnedStep.comment ?? '—'}
        </p>
      )}
    </>
  );
}

export function SealReminderNote({ text }: { text: string }) {
  return (
    <p className="rounded-card border border-td-border bg-white/80 px-5 py-4 text-sm text-td-blue-dark">
      <span className="font-semibold">提醒：</span>
      {text}
    </p>
  );
}
