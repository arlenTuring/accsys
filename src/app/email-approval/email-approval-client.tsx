'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailApprovalDocumentSummary } from '@/lib/email/submission-detail-html';

type Props = {
  token: string;
  initialIntent: 'approve' | 'return';
  initialReason?: string;
  autoClose?: boolean;
  serverCompletedResult?: {
    decision: 'approve' | 'return';
    message: string;
  } | null;
  approverName: string;
  approverEmail: string;
  approverEmployeeNumber: string;
  summary: EmailApprovalDocumentSummary;
  isStillPendingAtTokenStep: boolean;
  mismatchSessionName: string | null;
};

export function EmailApprovalClient({
  token,
  initialIntent,
  initialReason = '',
  autoClose = false,
  serverCompletedResult = null,
  approverName,
  summary,
  isStillPendingAtTokenStep,
  mismatchSessionName,
}: Props) {
  const [showReturnInput, setShowReturnInput] = useState(
    initialIntent === 'return' && !initialReason.trim() && !serverCompletedResult
  );
  const [returnReason, setReturnReason] = useState(initialReason);
  const [loadingAction, setLoadingAction] = useState<'approve' | 'return' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completedResult, setCompletedResult] = useState<{
    decision: 'approve' | 'return';
    message: string;
  } | null>(serverCompletedResult);

  const autoTriggeredRef = useRef(Boolean(serverCompletedResult));
  const actionAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (serverCompletedResult && autoClose) {
      try {
        window.close();
      } catch {
        // ignore
      }
      const timer = setTimeout(() => {
        try {
          window.close();
        } catch {
          // ignore
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [autoClose, serverCompletedResult]);

  const callApprovalApi = useCallback(
    async (decision: 'approve' | 'return', reason?: string) => {
      if (loadingAction || completedResult) return;
      if (decision === 'return' && !(reason ?? '').trim()) {
        setErrorMsg('請填寫退回原因說明');
        return;
      }
      setErrorMsg(null);
      setLoadingAction(decision);

      try {
        // Ensure spinner animation is visibly perceived while interacting with the API
        const [res] = await Promise.all([
          fetch('/api/email-approval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token,
              decision,
              reason: decision === 'return' ? (reason ?? '').trim() : undefined,
            }),
          }),
          new Promise((resolve) => setTimeout(resolve, 650)),
        ]);

        const data = (await res.json()) as {
          ok: boolean;
          decision?: 'approve' | 'return';
          message?: string;
          error?: string;
          alreadyProcessed?: boolean;
        };

        if (!data.ok) {
          if (data.alreadyProcessed) {
            setCompletedResult({
              decision,
              message: data.error ?? '此單據關卡已完成簽核。',
            });
          } else {
            setErrorMsg(data.error ?? '簽核處理失敗，請稍後再試。');
          }
          setLoadingAction(null);
          return;
        }

        setCompletedResult({
          decision: data.decision ?? decision,
          message:
            data.message ??
            (decision === 'approve' ? '已完成准許簽核此單據' : '已退回此單據'),
        });
        setShowReturnInput(false);

        if (autoClose) {
          setTimeout(() => {
            try {
              window.close();
            } catch {
              // Ignore if browser prevents closing non-script-opened tab
            }
          }, 1100);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : '網路連線異常，請重試。');
      } finally {
        setLoadingAction(null);
      }
    },
    [autoClose, completedResult, loadingAction, token]
  );

  // When the user clicks "准許簽核此單據" or submits the in-email return form from the email,
  // immediately execute the approval/return API without requiring a second click.
  useEffect(() => {
    actionAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (
      isStillPendingAtTokenStep &&
      !mismatchSessionName &&
      !autoTriggeredRef.current
    ) {
      if (initialIntent === 'approve') {
        autoTriggeredRef.current = true;
        void callApprovalApi('approve');
      } else if (initialIntent === 'return' && initialReason.trim()) {
        autoTriggeredRef.current = true;
        void callApprovalApi('return', initialReason.trim());
      }
    }
  }, [
    callApprovalApi,
    initialIntent,
    initialReason,
    isStillPendingAtTokenStep,
    mismatchSessionName,
  ]);

  const isApproveDone = completedResult?.decision === 'approve';
  const isReturnDone = completedResult?.decision === 'return';

  // 當由郵件點擊一鍵簽核／退回且已完成時，僅顯示極簡「郵件簽核完成（免登入系統）」微型提示卡並自動關閉分頁，不展開系統畫面
  if (autoClose && completedResult) {
    return (
      <div className="min-h-screen bg-slate-900/60 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden text-center p-6 space-y-4">
          <div
            className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${
              isApproveDone
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-rose-100 text-rose-700'
            }`}
          >
            {isApproveDone ? '✓' : '↩'}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
              TURING DRIVE · 郵件內直接簽核完成（免登入系統）
            </div>
            <h1 className="text-lg font-bold text-slate-900">
              {isApproveDone ? '已完成單據核准' : '已完成單據退回'}
            </h1>
            <p className="text-xs text-slate-500">
              {summary.formLabel}（{summary.caseNumber}）
            </p>
          </div>
          <div
            className={`rounded-xl border px-4 py-3 text-xs font-semibold leading-relaxed ${
              isApproveDone
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {completedResult.message}
          </div>
          <div className="pt-1">
            <button
              type="button"
              onClick={() => window.close()}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              ✓ 關閉此分頁並返回信箱
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-6 flex justify-center items-start">
      {/* Standalone Email View Card (matches the exact 1080px email template layout, never jumps to ACCSYS main app) */}
      <div className="w-full max-w-[1080px] bg-white border border-slate-200 rounded-[14px] shadow-sm overflow-hidden">
        {/* Email Header */}
        <div className="bg-[#1e40af] px-6 py-4 text-white">
          <div className="text-[11px] font-bold tracking-wider uppercase opacity-90">
            TURING DRIVE · ACCSYS 系統通知
          </div>
          <div className="text-lg font-bold mt-1">
            【{isApproveDone ? '已核准' : isReturnDone ? '已退回' : '待簽核'}】
            {summary.formLabel} {summary.caseNumber}
          </div>
        </div>

        <div className="p-6 text-slate-800 text-sm leading-relaxed space-y-4">
          <p className="m-0">
            <strong>{approverName}</strong> 您好：
          </p>

          {/* 單據摘要區 */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[13px]">
            <div>
              <span className="text-slate-500">單據類型：</span>
              <span className="font-semibold text-slate-900">{summary.formLabel}</span>
            </div>
            <div>
              <span className="text-slate-500">單據案號：</span>
              <span className="font-mono font-bold text-slate-900">{summary.caseNumber}</span>
            </div>
            <div>
              <span className="text-slate-500">申請人員：</span>
              <span className="font-medium text-slate-800">
                {summary.applicantName}（{summary.departmentName}）
              </span>
            </div>
            {summary.totalAmountText && (
              <div>
                <span className="text-slate-500">申請總額：</span>
                <span className="font-mono font-bold text-emerald-700">
                  {summary.totalAmountText}
                </span>
              </div>
            )}
          </div>

          {/* 單據欄位明細 */}
          {summary.fields.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 font-bold text-[13px] text-slate-700">
                📋 單據欄位明細（{summary.formLabel} · {summary.caseNumber}）
              </div>
              <table className="w-full border-collapse text-[13px]">
                <tbody>
                  {summary.fields.map((f, idx) => (
                    <tr key={`${f.label}-${idx}`} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-4 py-2.5 text-slate-500 w-[135px] align-top font-medium">
                        {f.label}
                      </td>
                      <td className="px-4 py-2.5 text-slate-900 break-words whitespace-pre-wrap">
                        {f.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 動態表格／品項明細 */}
          {summary.tables.map((t, tIdx) => (
            <div key={`${t.title}-${tIdx}`} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 font-bold text-[13px] text-slate-700">
                🧾 {t.title}（共 {t.rows.length} 筆）
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="px-2.5 py-2 text-left text-slate-600 border-b border-slate-200 w-9">
                        #
                      </th>
                      {t.headers.map((h, hIdx) => (
                        <th
                          key={`${h.label}-${hIdx}`}
                          className={`px-2.5 py-2 text-slate-600 border-b border-slate-200 ${
                            h.align === 'right' ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2.5 py-2 text-slate-400 font-mono">{rIdx + 1}</td>
                        {row.map((cell, cIdx) => {
                          const align = t.headers[cIdx]?.align ?? 'left';
                          return (
                            <td
                              key={cIdx}
                              className={`px-2.5 py-2 text-slate-800 ${
                                align === 'right' ? 'text-right font-mono' : 'text-left'
                              }`}
                            >
                              {cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  {t.totalValue && (
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td
                          colSpan={t.headers.length}
                          className="px-2.5 py-2.5 text-right font-bold text-slate-600"
                        >
                          {t.totalLabel ?? '合計金額'}
                        </td>
                        <td className="px-2.5 py-2.5 text-right font-mono font-bold text-slate-900 text-[13px]">
                          {t.totalValue}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          ))}

          {/* 簽核流程進度（簽核完成後即時更新狀態徽章） */}
          {summary.steps.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 font-bold text-[13px] text-slate-700">
                🔄 簽核流程進度
              </div>
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {summary.steps.map((st) => {
                    const effectiveStatus = st.isCurrent && completedResult
                      ? completedResult.decision === 'approve'
                        ? 'approved'
                        : 'returned'
                      : st.status;
                    const effectiveIsCurrent = st.isCurrent && !completedResult;

                    return (
                      <tr
                        key={st.stepOrder}
                        className={`border-b border-slate-100 last:border-b-0 ${
                          effectiveIsCurrent ? 'bg-blue-50/70' : ''
                        }`}
                      >
                        <td className="px-3.5 py-2.5 text-slate-500 w-[72px] font-semibold">
                          第 {st.stepOrder} 關
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-900 font-semibold">
                          {st.stepLabel}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-700">{st.approverName}</td>
                        <td className="px-3.5 py-2.5 text-right">
                          {effectiveStatus === 'approved' ? (
                            <span className="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                              ✓ 已核准
                            </span>
                          ) : effectiveStatus === 'returned' ? (
                            <span className="inline-block bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                              ↩ 已退回
                            </span>
                          ) : effectiveIsCurrent ? (
                            <span className="inline-block bg-blue-100 text-blue-800 border border-blue-300 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
                              ● 目前關卡（待簽核）
                            </span>
                          ) : (
                            <span className="inline-block bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full text-[11px] font-semibold">
                              待簽核
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 帳號不一致或錯誤訊息 */}
          {mismatchSessionName && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              目前瀏覽器登入帳號為「{mismatchSessionName}」，與本封信件簽核人「{approverName}」不同。
            </div>
          )}

          {errorMsg && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
              {errorMsg}
            </div>
          )}

          {/* 信件內直接簽核按鈕區（無多餘提示框，點擊或載入時直接在按鈕上轉圈圈呼叫 API） */}
          <div ref={actionAreaRef} className="pt-1 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {/* 准許簽核此單據按鈕（含 API 轉圈圈提示） */}
              <button
                type="button"
                disabled={
                  loadingAction !== null ||
                  completedResult !== null ||
                  Boolean(mismatchSessionName) ||
                  !isStillPendingAtTokenStep
                }
                onClick={() => {
                  setShowReturnInput(false);
                  void callApprovalApi('approve');
                }}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition ${
                  isApproveDone
                    ? 'bg-emerald-700 cursor-default'
                    : isReturnDone || !isStillPendingAtTokenStep
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-[#059669] hover:bg-emerald-700 cursor-pointer'
                }`}
              >
                {loadingAction === 'approve' ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <span>簽核處理中...</span>
                  </>
                ) : isApproveDone ? (
                  <span>已準許簽核</span>
                ) : !isStillPendingAtTokenStep ? (
                  <span>此關卡已簽核完成</span>
                ) : (
                  <span>準許簽核</span>
                )}
              </button>

              {/* 簽核退回按鈕 */}
              <button
                type="button"
                disabled={
                  loadingAction !== null ||
                  completedResult !== null ||
                  Boolean(mismatchSessionName) ||
                  !isStillPendingAtTokenStep
                }
                onClick={() => {
                  setErrorMsg(null);
                  setShowReturnInput((prev) => !prev);
                }}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold border transition ${
                  isReturnDone
                    ? 'bg-rose-700 text-white border-rose-700 cursor-default'
                    : isApproveDone || !isStillPendingAtTokenStep
                      ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                      : 'bg-[#fff1f2] text-[#be123c] border-[#fda4af] hover:bg-rose-100 cursor-pointer'
                }`}
              >
                {loadingAction === 'return' ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#be123c] border-t-transparent" />
                    <span>退回處理中...</span>
                  </>
                ) : isReturnDone ? (
                  <span>已簽核退回</span>
                ) : (
                  <span>簽核退回</span>
                )}
              </button>
            </div>

            {/* 點擊退回時在信件下方直接展開原因輸入框 */}
            {showReturnInput && !completedResult && isStillPendingAtTokenStep && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 space-y-2.5">
                <textarea
                  rows={2}
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="請輸入退回修正原因..."
                  className="w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-rose-500 focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowReturnInput(false)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={loadingAction !== null || !returnReason.trim()}
                    onClick={() => void callApprovalApi('return', returnReason)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    {loadingAction === 'return' && (
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    )}
                    確認送出退回
                  </button>
                </div>
              </div>
            )}

            {/* 簽核完成簡潔狀態列 */}
            {completedResult && (
              <div
                className={`rounded-lg border px-4 py-3 text-xs font-semibold flex items-center justify-between gap-3 ${
                  completedResult.decision === 'approve'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                <span>✓ {completedResult.message}（已完成郵件簽核，無需進入系統）</span>
                <button
                  type="button"
                  onClick={() => window.close()}
                  className="shrink-0 rounded-md border border-current px-2.5 py-1 text-[11px] font-bold hover:opacity-80 cursor-pointer"
                >
                  關閉此視窗返回信箱
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 px-6 py-3 text-slate-500 text-xs border-t border-slate-200">
          此信件由 台灣智慧駕駛股份有限公司 (TURING DRIVE) ACCSYS 系統自動發送，請勿直接回覆。
        </div>
      </div>
    </div>
  );
}
