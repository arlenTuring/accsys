'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getSubmissionPanelAction } from '@/lib/ai-chat/actions';
import { approveCustomFormStep, returnCustomFormStep } from '@/lib/custom-forms/actions';

export type SubmissionActionPhase =
  | 'idle'
  | 'approving'
  | 'returning'
  | 'approved'
  | 'returned';

export type SubmissionActionState = {
  phase: SubmissionActionPhase;
  error: string | null;
};

const IDLE: SubmissionActionState = { phase: 'idle', error: null };

type Ctx = {
  getState: (submissionId: string) => SubmissionActionState;
  approve: (
    submissionId: string,
    version?: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  returnSubmission: (
    submissionId: string,
    reason: string,
    version?: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const SubmissionActionsContext = createContext<Ctx | null>(null);

async function resolveVersion(
  submissionId: string,
  version: number | undefined
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return { ok: true, version };
  }
  const panel = await getSubmissionPanelAction(submissionId);
  if (!panel.ok) return { ok: false, error: panel.error };
  if (!panel.isCurrentApprover) {
    return { ok: false, error: '您目前不是這張單的簽核人。' };
  }
  return { ok: true, version: panel.version };
}

export function SubmissionActionsProvider({ children }: { children: ReactNode }) {
  const [byId, setById] = useState<Record<string, SubmissionActionState>>({});

  const patch = useCallback((submissionId: string, next: SubmissionActionState) => {
    setById((prev) => ({ ...prev, [submissionId]: next }));
  }, []);

  const getState = useCallback(
    (submissionId: string) => byId[submissionId] ?? IDLE,
    [byId]
  );

  const approve = useCallback(
    async (submissionId: string, version?: number) => {
      patch(submissionId, { phase: 'approving', error: null });
      const resolved = await resolveVersion(submissionId, version);
      if (!resolved.ok) {
        patch(submissionId, { phase: 'idle', error: resolved.error });
        return resolved;
      }
      const result = await approveCustomFormStep(submissionId, resolved.version);
      if (!result.ok) {
        patch(submissionId, { phase: 'idle', error: result.error });
        return { ok: false as const, error: result.error };
      }
      patch(submissionId, { phase: 'approved', error: null });
      return { ok: true as const };
    },
    [patch]
  );

  const returnSubmission = useCallback(
    async (submissionId: string, reason: string, version?: number) => {
      // Chat card marks reason as optional; backend still requires a non-empty string.
      const trimmed = reason.trim() || '（未填寫退回原因）';
      patch(submissionId, { phase: 'returning', error: null });
      const resolved = await resolveVersion(submissionId, version);
      if (!resolved.ok) {
        patch(submissionId, { phase: 'idle', error: resolved.error });
        return resolved;
      }
      const result = await returnCustomFormStep(submissionId, trimmed, resolved.version);
      if (!result.ok) {
        patch(submissionId, { phase: 'idle', error: result.error });
        return { ok: false as const, error: result.error };
      }
      patch(submissionId, { phase: 'returned', error: null });
      return { ok: true as const };
    },
    [patch]
  );

  const value = useMemo(
    () => ({ getState, approve, returnSubmission }),
    [getState, approve, returnSubmission]
  );

  return (
    <SubmissionActionsContext.Provider value={value}>{children}</SubmissionActionsContext.Provider>
  );
}

export function useSubmissionAction(submissionId: string): SubmissionActionState & {
  approve: (version?: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  returnSubmission: (
    reason: string,
    version?: number
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  busy: boolean;
} {
  const ctx = useContext(SubmissionActionsContext);
  if (!ctx) {
    throw new Error('useSubmissionAction must be used within SubmissionActionsProvider');
  }
  const state = ctx.getState(submissionId);
  return {
    ...state,
    busy: state.phase === 'approving' || state.phase === 'returning',
    approve: (version?: number) => ctx.approve(submissionId, version),
    returnSubmission: (reason: string, version?: number) =>
      ctx.returnSubmission(submissionId, reason, version),
  };
}

export function ActionSpinner({
  className = 'h-3.5 w-3.5',
  tone = 'onPrimary',
}: {
  className?: string;
  tone?: 'onPrimary' | 'danger' | 'muted';
}) {
  const ring =
    tone === 'danger'
      ? 'border-red-200 border-t-red-700'
      : tone === 'muted'
        ? 'border-td-border border-t-td-blue-dark'
        : 'border-white/40 border-t-white';
  return (
    <span
      className={`inline-block shrink-0 animate-spin rounded-full border-2 ${ring} ${className}`}
      aria-hidden
    />
  );
}
