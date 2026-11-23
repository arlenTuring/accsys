'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createInventoryHandoverFormsAction } from '@/lib/assets/actions';
import type { HandoverFormSummary } from '@/lib/assets/inventory-form-constants';

type CustodianCandidate = {
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentName: string;
  assetCount: number;
};

type Props = {
  canDispatch: boolean;
  currentEmployeeId: string;
  currentEmployeeName: string;
  custodianCandidates: CustodianCandidate[];
  forms: HandoverFormSummary[];
};

function defaultScheduledTimeString(): string {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function InventoryFormsDispatchClient({
  canDispatch,
  currentEmployeeId,
  currentEmployeeName,
  custodianCandidates,
  forms,
}: Props) {
  const router = useRouter();

  // 發送財產清點單面板收合狀態（若已有清點單預設可收合或展開，提供一鍵收合／展開）
  const [dispatchOpen, setDispatchOpen] = useState<boolean>(true);

  const [selectedCustodians, setSelectedCustodians] = useState<Set<string>>(() => {
    return new Set(custodianCandidates.map((c) => c.employeeId));
  });
  const [scheduledAt, setScheduledAt] = useState<string>(defaultScheduledTimeString);
  const [meetingLocation, setMeetingLocation] = useState<string>('原保管座位／設備現場點交');
  const [instructions, setInstructions] = useState<string>(
    '請於「我的資產管理」檢視此張財產盤點單，並針對名下每項財產點選「確認」或「修改」。'
  );
  const [filterTab, setFilterTab] = useState<'all' | 'open' | 'locked' | 'mine'>('all');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; createdBatchId?: string } | null>(null);

  const toggleCustodian = (id: string) => {
    setSelectedCustodians((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllCustodians = () => {
    setSelectedCustodians(new Set(custodianCandidates.map((c) => c.employeeId)));
  };

  const clearCustodians = () => {
    setSelectedCustodians(new Set());
  };

  const handleDispatch = () => {
    if (selectedCustodians.size === 0) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await createInventoryHandoverFormsAction({
        custodianEmployeeIds: [...selectedCustodians],
        scheduledAt,
        meetingLocation,
        instructions,
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      const summary = res.createdForms
        .map((f) => `${f.custodianName}（單號 ${f.formNumber}，共 ${f.rowCount} 筆財產）`)
        .join('、');
      setFeedback({
        ok: true,
        text: `已成功於指定時間（${scheduledAt.replace('T', ' ')}）派發 ${res.createdForms.length} 張財產清點單給保管人：${summary}`,
        createdBatchId: res.createdForms[0]?.batchId,
      });
      router.refresh();
    });
  };

  const visibleForms = forms.filter((f) => {
    if (filterTab === 'open') return f.status === 'open';
    if (filterTab === 'locked') return f.status === 'locked';
    if (filterTab === 'mine') {
      return f.custodianEmployeeId === currentEmployeeId || f.inspectorEmployeeId === currentEmployeeId;
    }
    return true;
  });

  const openCount = forms.filter((f) => f.status === 'open').length;
  const lockedCount = forms.filter((f) => f.status === 'locked').length;

  return (
    <div className="space-y-5">
      {/* 清點人派發系統表單面板（支援收合／展開） */}
      {canDispatch && (
        <section className="card space-y-4 border-2 border-indigo-200 bg-gradient-to-r from-indigo-50/60 via-white to-sky-50/50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              onClick={() => setDispatchOpen((v) => !v)}
              className="cursor-pointer select-none"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  發送清點通知
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  📨 發送財產清點單給保管人
                </h2>
              </div>
              {dispatchOpen && (
                <p className="mt-1 text-xs text-slate-600">
                  財產清點人（目前身分：<strong>{currentEmployeeName}</strong>）選擇保管人並發送盤點單後，保管人會在「<strong>我的資產管理</strong>」直接收到這張盤點單，並於清單點選「<strong>確認</strong>」或「<strong>修改</strong>」。
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDispatchOpen((v) => !v)}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              {dispatchOpen ? '▲ 收合發送面板' : '▼ 展開發送清點單'}
            </button>
          </div>

          {dispatchOpen && (
            <div className="grid gap-4 md:grid-cols-12">
              {/* Step 1: 選擇財產擁有者 */}
              <div className="md:col-span-6 space-y-2 rounded-xl border border-indigo-100 bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-slate-800">
                    ① 選擇要發送清點單的「保管人」
                  </label>
                  <div className="flex gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={selectAllCustodians}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      全選有財產同仁 ({custodianCandidates.length})
                    </button>
                    <button
                      type="button"
                      onClick={clearCustodians}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
                    >
                      清除
                    </button>
                  </div>
                </div>
                {custodianCandidates.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    目前清冊中尚無在列保管財產可派發清點單。
                  </p>
                ) : (
                  <div className="grid max-h-52 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {custodianCandidates.map((c) => {
                      const checked = selectedCustodians.has(c.employeeId);
                      return (
                        <label
                          key={c.employeeId}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                            checked
                              ? 'border-indigo-500 bg-indigo-50/70 font-semibold text-indigo-950'
                              : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:bg-slate-100/70'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCustodian(c.employeeId)}
                            />
                            <div className="truncate">
                              <div>
                                {c.name}{' '}
                                <span className="font-mono text-[10px] text-slate-500">
                                  ({c.employeeCode})
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500">{c.departmentName}</div>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200">
                            {c.assetCount} 筆
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 2: 設定指定清點時間與點交說明 */}
              <div className="md:col-span-6 space-y-3 rounded-xl border border-indigo-100 bg-white p-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold text-slate-800">
                    ② 指定清點／點交時間 *
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="field mt-1 w-full py-1.5 text-xs"
                    />
                  </label>
                  <label className="text-xs font-bold text-slate-800">
                    ③ 點交地點／方式
                    <input
                      type="text"
                      value={meetingLocation}
                      onChange={(e) => setMeetingLocation(e.target.value)}
                      placeholder="例如：原保管座位現場點交"
                      className="field mt-1 w-full py-1.5 text-xs"
                    />
                  </label>
                </div>
                <label className="block text-xs font-bold text-slate-800">
                  ④ 發送給保管人之清點說明
                  <textarea
                    rows={2}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    className="field mt-1 w-full text-xs"
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-slate-600">
                    已選取 <strong className="text-indigo-700">{selectedCustodians.size}</strong> 位保管人
                  </span>
                  <button
                    type="button"
                    disabled={pending || selectedCustodians.size === 0 || !scheduledAt}
                    onClick={handleDispatch}
                    className="btn-primary bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {pending
                      ? '派發清點單中…'
                      : `📨 發送財產清點單 (${selectedCustodians.size} 張)`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
                feedback.ok
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                  : 'border-rose-300 bg-rose-50 text-rose-800'
              }`}
            >
              <span>{feedback.text}</span>
              {feedback.ok && feedback.createdBatchId && (
                <Link
                  href={`/assets/inventory-forms/${feedback.createdBatchId}`}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  開啟剛發送的清點單檢視點交明細 →
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {/* 清點單列表（左側狀態篩選按鈕、右側匯出盤點用紀錄） */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filterTab === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              全部清點單 ({forms.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('open')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filterTab === 'open'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              ⏳ 點交確認進行中 ({openCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('locked')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filterTab === 'locked'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              ✅ 雙方全數確認已結案 ({lockedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('mine')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filterTab === 'mine'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              👤 與我相關
            </button>
          </div>

          <a
            href="/api/assets/export?scope=company&includeLeft=false"
            className="btn-secondary inline-flex items-center gap-1.5 text-xs"
          >
            📥 匯出盤點用 Excel（含雙階確認紀錄）
          </a>
        </div>

        {visibleForms.length === 0 ? (
          <div className="card py-10 text-center text-sm text-td-muted">
            目前尚無符合條件的財產清點單。您可由上方選擇保管人與指定時間立即發送！
          </div>
        ) : (
          <div className="grid gap-3">
            {visibleForms.map((f) => {
              const isLocked = f.status === 'locked';
              const pct =
                f.totalLines > 0 ? Math.round((f.bothConfirmedLines / f.totalLines) * 100) : 0;
              return (
                <div
                  key={f.id}
                  className={`card flex flex-wrap items-center justify-between gap-4 border transition hover:shadow-md ${
                    isLocked
                      ? 'border-emerald-200 bg-emerald-50/20'
                      : f.allLinesConfirmedByBoth
                        ? 'border-indigo-300 bg-indigo-50/30'
                        : 'border-amber-200 bg-white'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono-case font-bold text-slate-900">{f.formNumber}</span>
                      {isLocked ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                          ✅ 雙方全數確認・已結束結案
                        </span>
                      ) : f.allLinesConfirmedByBoth ? (
                        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800">
                          🎯 雙方每一條皆已確認・可立即結案
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                          ⏳ 點交進行中（尚有 {f.totalLines - f.bothConfirmedLines} 條待雙方確認）
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        指定清點時間：
                        <strong className="text-slate-800">
                          {f.scheduledAt.replace('T', ' ') || '未指定'}
                        </strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
                      <span>
                        🏢 保管部門：<strong>{f.custodianDepartmentName || '—'}</strong>
                      </span>
                      <span>
                        👤 保管人：<strong>{f.custodianName}</strong>
                      </span>
                      <span>
                        🔍 清點人：<strong>{f.inspectorName}</strong>
                      </span>
                      {f.meetingLocation && <span>📍 點交地點：{f.meetingLocation}</span>}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px]">
                      <span className="rounded bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 ring-1 ring-emerald-200">
                        ✍️ 保管人點交確認：{f.custodianConfirmedLines} / {f.totalLines} 條
                      </span>
                      <span className="rounded bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-800 ring-1 ring-indigo-200">
                        🔍 清點人複核確認：{f.inspectorConfirmedLines} / {f.totalLines} 條
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-800">
                        🤝 雙方共同完成：{f.bothConfirmedLines} / {f.totalLines} 條 ({pct}%)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/assets/inventory-forms/${f.id}`}
                      className={`rounded-lg px-4 py-2 text-xs font-bold shadow-sm transition ${
                        isLocked
                          ? 'border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700'
                      }`}
                    >
                      {isLocked ? '📄 檢視已結案清點單' : '✍️ 開啟清點單複核／結案 →'}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
