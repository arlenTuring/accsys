import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { employees } from '@/lib/db/schema';
import { verifyEmailApprovalToken } from '@/lib/email/approval-token';
import { loadEmailApprovalDocumentSummary } from '@/lib/email/submission-detail-html';
import { getSystemFeatureFlags } from '@/lib/feature-flags/service';
import { submitEmailApprovalDecision } from './actions';
import { EmailApprovalClient } from './email-approval-client';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  token?: string;
  intent?: string;
  reason?: string;
  autoClose?: string;
}>;

export default async function EmailApprovalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, featureFlags] = await Promise.all([
    searchParams,
    getSystemFeatureFlags(),
  ]);

  if (!featureFlags.email_inline_approval) {
    return (
      <div className="min-h-screen bg-slate-900/55 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <div className="bg-slate-900 px-6 py-4 text-white">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              TURING DRIVE · ACCSYS 系統授權守衛
            </div>
            <h1 className="text-lg font-bold mt-0.5 flex items-center gap-2">
              <span className="text-amber-400">🔒</span>
              「郵件內快速簽核」功能目前未開放
            </h1>
          </div>
          <div className="p-6 space-y-4 text-sm text-slate-600">
            <p className="leading-relaxed">
              此功能於目前的系統授權碼或功能開關中為關閉狀態，已攔截直接網址簽核。請登入 ACCSYS 主系統進行簽核。
            </p>
          </div>
        </div>
      </div>
    );
  }
  const rawToken = typeof params.token === 'string' ? params.token : '';
  const initialIntent: 'approve' | 'return' =
    params.intent === 'return' ? 'return' : 'approve';
  const initialReason = typeof params.reason === 'string' ? params.reason.trim() : '';
  const autoClose = params.autoClose === '1' || params.autoClose === 'true';

  const verified = verifyEmailApprovalToken(rawToken);
  if (!verified.ok) {
    return (
      <div className="min-h-screen bg-slate-900/55 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <div className="bg-slate-900 px-6 py-4 text-white">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              TURING DRIVE · ACCSYS 郵件簽核驗證
            </div>
            <h1 className="text-lg font-bold mt-0.5 flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              簽核連結無效或已過期
            </h1>
          </div>
          <div className="p-6 space-y-4 text-sm text-slate-600">
            <p className="leading-relaxed">
              {verified.reason === 'expired'
                ? '此封郵件內的快速簽核憑證已超過有效期限（7 天）。請直接關閉此分頁返回信箱。'
                : '無法驗證此郵件簽核憑證的數位簽章，請直接關閉此分頁返回信箱。'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { payload } = verified;
  const db = getDb();

  const [[approver], summary] = await Promise.all([
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        googleEmail: employees.googleEmail,
        accessEnabled: employees.accessEnabled,
      })
      .from(employees)
      .where(eq(employees.id, payload.approverEmployeeId))
      .limit(1),
    loadEmailApprovalDocumentSummary(payload.formType, payload.formId),
  ]);

  if (!approver || !approver.accessEnabled || !summary) {
    return (
      <div className="min-h-screen bg-slate-900/55 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
          <div className="bg-slate-900 px-6 py-4 text-white">
            <h1 className="text-lg font-bold">找不到單據或簽核人資料</h1>
          </div>
          <div className="p-6 space-y-4 text-sm text-slate-600">
            <p>找不到對應的簽核單據，或簽核人帳號已停用。請直接關閉此分頁返回信箱。</p>
          </div>
        </div>
      </div>
    );
  }

  const isStillPendingAtTokenStep =
    summary.status === 'pending_approval' &&
    summary.currentStepOrder === payload.stepOrder &&
    summary.version === payload.version;

  // 若是從信件點擊「准許簽核」或在信件內填好「退回原因」送出，直接在 Server 端立即完成簽核（免登入系統、免二次點擊）
  let serverCompletedResult: {
    decision: 'approve' | 'return';
    message: string;
  } | null = null;

  if (
    isStillPendingAtTokenStep &&
    (initialIntent === 'approve' || (initialIntent === 'return' && initialReason.length > 0))
  ) {
    const execRes = await submitEmailApprovalDecision({
      token: rawToken,
      decision: initialIntent,
      confirmedDetails: true,
      reason: initialIntent === 'return' ? initialReason : undefined,
    });
    if (execRes.ok) {
      serverCompletedResult = {
        decision: execRes.decision,
        message: execRes.message,
      };
    } else if (execRes.alreadyProcessed) {
      serverCompletedResult = {
        decision: initialIntent,
        message: execRes.error,
      };
    }
  }

  return (
    <EmailApprovalClient
      token={rawToken}
      initialIntent={initialIntent}
      initialReason={initialReason}
      autoClose={autoClose}
      serverCompletedResult={serverCompletedResult}
      approverName={approver.name}
      approverEmail={approver.googleEmail ?? ''}
      approverEmployeeNumber={approver.employeeCode}
      summary={summary}
      isStillPendingAtTokenStep={isStillPendingAtTokenStep}
      mismatchSessionName={null}
    />
  );
}
