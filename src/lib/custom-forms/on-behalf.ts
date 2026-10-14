import type { ResolvedStep } from '@/lib/approval/flow/types';

/**
 * 代為申請: the named applicant confirms first (unless they submit this round
 * themselves), and someone besides the applicant and the filer must sign, so
 * nobody can file under another employee's name, or borrow a manager's shorter
 * chain, without that employee agreeing. The flow already signs the filer's
 * own steps (skipFiler). `editorId` is whoever submits this round.
 *
 * Returns null when nobody else would sign (the caller refuses the form).
 */
export function withApplicantConfirmation(
  steps: ResolvedStep[],
  p: { applicantId: string; filerId: string; editorId: string }
): ResolvedStep[] | null {
  if (p.filerId === p.applicantId && p.editorId === p.applicantId) return steps;
  if (!steps.some((s) => s.status === 'pending')) return null;
  if (p.editorId === p.applicantId) return steps;
  const confirm: ResolvedStep = {
    blockId: 'applicant_confirmation',
    label: '申請人確認',
    sourceKind: 'form_party',
    approverEmployeeId: p.applicantId,
    delegatedFromEmployeeId: null,
    status: 'pending',
    systemNote: null,
  };
  return [confirm, ...steps];
}
