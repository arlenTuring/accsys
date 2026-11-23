'use client';

import Link from 'next/link';
import { useState } from 'react';

export type HistoricalBudgetLine = {
  code: string;
  category: string;
  itemCode: string;
  accountNumber: string;
  prevApprovedBudget: number;
  prevActualAmount: number;
  months: number[];
  annualBudgetAmount: number;
  description: string;
};

export type HistoricalBudgetRecord = {
  id: string;
  formNumber: string;
  caseNumber: string;
  fiscalYear: string;
  budgetScope: 'department' | 'project';
  unitLabel: string;
  reason: string;
  status: string;
  submittedDateLabel: string;
  totalPrevApproved: number;
  totalPrevActual: number;
  totalAnnualBudget: number;
  lines: HistoricalBudgetLine[];
  detailHref: string;
};

const MONTH_LABELS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
];

function formatMoney(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPct(num: number, den: number): string {
  if (!den || den <= 0) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function BudgetHistoryListClient({
  records,
}: {
  records: HistoricalBudgetRecord[];
}) {
  // 預設展開第一筆（最新年度）讓使用者一進來就能直接看到歷年資料與設計
  const [expandedIds, setExpandedIds] = useState<string[]>(() =>
    records[0] ? [records[0].id] : []
  );
  const [tabByRecordId, setTabByRecordId] = useState<
    Record<string, 'variance' | 'monthly'>
  >({});
  const [filterYear, setFilterYear] = useState<string>('ALL');

  const years = [...new Set(records.map((r) => r.fiscalYear))].sort(
    (a, b) => Number(b) - Number(a)
  );

  const filteredRecords = records.filter(
    (r) => filterYear === 'ALL' || r.fiscalYear === filterYear
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">
        目前尚無歷年已填寫的年度預算表紀錄。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 年度快速篩選列 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-500">篩選年度：</span>
          <button
            type="button"
            onClick={() => setFilterYear('ALL')}
            className={`rounded-lg px-3 py-1 font-semibold transition ${
              filterYear === 'ALL'
                ? 'bg-td-blue text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
            }`}
          >
            全部年度 ({records.length})
          </button>
          {years.map((y) => {
            const west = Number(y) < 1911 ? Number(y) + 1911 : Number(y);
            const cnt = records.filter((r) => r.fiscalYear === y).length;
            return (
              <button
                key={y}
                type="button"
                onClick={() => setFilterYear(y)}
                className={`rounded-lg px-3 py-1 font-semibold transition ${
                  filterYear === y
                    ? 'bg-td-blue text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                }`}
              >
                {y} 年度 / {west} ({cnt})
              </button>
            );
          })}
        </div>
      </div>

      {/* 歷年預算紀錄卡片清單 */}
      <div className="space-y-3.5">
        {filteredRecords.map((rec) => {
          const isExpanded = expandedIds.includes(rec.id);
          const activeTab = tabByRecordId[rec.id] ?? 'variance';
          const westYear =
            Number(rec.fiscalYear) < 1911
              ? Number(rec.fiscalYear) + 1911
              : Number(rec.fiscalYear);
          const prevRocYear = Number(rec.fiscalYear) - 1;
          const diffAmount = rec.totalAnnualBudget - rec.totalPrevApproved;

          return (
            <div
              key={rec.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs transition"
            >
              {/* 卡片摘要標頭 */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50/70 px-5 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-td-blue-dark px-2.5 py-0.5 text-xs font-bold text-white">
                      {rec.fiscalYear} 年度（{westYear}）
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                        rec.budgetScope === 'project'
                          ? 'bg-indigo-100 text-indigo-900'
                          : 'bg-blue-100 text-td-blue-dark'
                      }`}
                    >
                      {rec.budgetScope === 'project'
                        ? '專案年度預算表'
                        : '部門年度預算表'}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-500">
                      單號：{rec.formNumber}
                    </span>
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                      {rec.status === 'approved' ? '✅ 已核准結案' : '⏳ 簽核中'}
                    </span>
                    <span className="text-xs text-slate-400">
                      填報日期：{rec.submittedDateLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-2 pt-0.5">
                    <h3 className="text-sm font-bold text-slate-900">
                      {rec.unitLabel}
                    </h3>
                    {rec.reason && (
                      <span className="text-xs text-slate-600">
                        — {rec.reason}
                      </span>
                    )}
                  </div>
                </div>

                {/* 右側金額摘要與操作按鈕 */}
                <div className="flex flex-wrap items-center gap-4">
                  <div className="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-right text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {prevRocYear} 核定預算(A)
                      </div>
                      <div className="font-mono font-semibold text-slate-700">
                        NT$ {formatMoney(rec.totalPrevApproved)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">
                        {prevRocYear} 實際執行(B)
                      </div>
                      <div className="font-mono font-semibold text-slate-700">
                        NT$ {formatMoney(rec.totalPrevActual)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold text-td-blue">
                        {rec.fiscalYear} 核定總額(C)
                      </div>
                      <div className="font-mono text-sm font-bold text-td-blue-dark">
                        NT$ {formatMoney(rec.totalAnnualBudget)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleExpand(rec.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      {isExpanded ? '收合明細 ▲' : '檢視明細表 ▼'}
                    </button>
                    <Link
                      href={rec.detailHref}
                      className="rounded-lg border border-td-blue/30 bg-blue-50/60 px-3 py-1.5 font-semibold text-td-blue hover:bg-td-blue hover:text-white"
                    >
                      開啟單據 →
                    </Link>
                  </div>
                </div>
              </div>

              {/* 展開之歷年預算明細表（支援切換「差異分析與科目總覽」與「1~12 月分月預算明細」） */}
              {isExpanded && (
                <div className="border-t border-slate-200 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setTabByRecordId((prev) => ({
                            ...prev,
                            [rec.id]: 'variance',
                          }))
                        }
                        className={`rounded-md px-3 py-1 font-semibold transition ${
                          activeTab === 'variance'
                            ? 'bg-white text-td-blue-dark shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        📊 跨年度預算差異分析表（共 {rec.lines.length} 項科目）
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setTabByRecordId((prev) => ({
                            ...prev,
                            [rec.id]: 'monthly',
                          }))
                        }
                        className={`rounded-md px-3 py-1 font-semibold transition ${
                          activeTab === 'monthly'
                            ? 'bg-white text-td-blue-dark shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        📅 1～12 月分月編列明細表
                      </button>
                    </div>

                    <span className="text-xs text-slate-500">
                      年度總增減差異（C - A）：
                      <strong
                        className={
                          diffAmount > 0
                            ? 'text-amber-700'
                            : diffAmount < 0
                              ? 'text-emerald-700'
                              : 'text-slate-700'
                        }
                      >
                        {diffAmount > 0 ? '+' : ''}
                        NT$ {formatMoney(diffAmount)}
                      </strong>
                    </span>
                  </div>

                  {activeTab === 'variance' ? (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[820px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                            <th className="px-3 py-2 font-semibold">預算編號</th>
                            <th className="px-3 py-2 font-semibold">
                              會計科目／預算類別
                            </th>
                            <th className="px-3 py-2 text-right font-semibold">
                              {prevRocYear} 核定預算(A)
                            </th>
                            <th className="px-3 py-2 text-right font-semibold">
                              {prevRocYear} 實際執行(B)
                            </th>
                            <th className="px-3 py-2 text-right font-semibold">
                              達成率(B/A)
                            </th>
                            <th className="bg-blue-50/60 px-3 py-2 text-right font-bold text-td-blue-dark">
                              {rec.fiscalYear} 年度預算(C)
                            </th>
                            <th className="px-3 py-2 text-right font-semibold">
                              增減差異(C-A)
                            </th>
                            <th className="px-3 py-2 text-right font-semibold">
                              成長率(C-B)/B
                            </th>
                            <th className="px-3 py-2 font-semibold">
                              編列說明與差異原因分析
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rec.lines.map((line, idx) => {
                            const lineDiff =
                              line.annualBudgetAmount - line.prevApprovedBudget;
                            const growthRate =
                              line.prevActualAmount > 0
                                ? `${(
                                    ((line.annualBudgetAmount -
                                      line.prevActualAmount) /
                                      line.prevActualAmount) *
                                    100
                                  ).toFixed(1)}%`
                                : '—';
                            return (
                              <tr key={`${line.code}-${idx}`} className="hover:bg-slate-50/70">
                                <td className="px-3 py-2.5 font-mono font-bold text-td-blue-dark whitespace-nowrap">
                                  {line.code}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <span className="font-semibold text-slate-800">
                                    {line.category}
                                  </span>
                                  {line.accountNumber && (
                                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                      {line.accountNumber}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                                  {formatMoney(line.prevApprovedBudget)}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                                  {formatMoney(line.prevActualAmount)}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                                  {formatPct(
                                    line.prevActualAmount,
                                    line.prevApprovedBudget
                                  )}
                                </td>
                                <td className="bg-blue-50/30 px-3 py-2.5 text-right font-mono font-bold text-td-blue-dark tabular-nums">
                                  {formatMoney(line.annualBudgetAmount)}
                                </td>
                                <td
                                  className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${
                                    lineDiff > 0
                                      ? 'text-amber-700'
                                      : lineDiff < 0
                                        ? 'text-emerald-700'
                                        : 'text-slate-500'
                                  }`}
                                >
                                  {lineDiff > 0 ? '+' : ''}
                                  {formatMoney(lineDiff)}
                                </td>
                                <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                                  {growthRate}
                                </td>
                                <td className="max-w-xs px-3 py-2.5 text-slate-600">
                                  {line.description || '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[980px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
                            <th className="px-2.5 py-2 font-semibold">預算編號</th>
                            <th className="px-2.5 py-2 font-semibold">會計科目</th>
                            {MONTH_LABELS.map((m) => (
                              <th
                                key={m}
                                className="px-2 py-2 text-right font-semibold"
                              >
                                {m}
                              </th>
                            ))}
                            <th className="bg-blue-50/60 px-3 py-2 text-right font-bold text-td-blue-dark">
                              年度合計
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rec.lines.map((line, idx) => (
                            <tr
                              key={`m-${line.code}-${idx}`}
                              className="hover:bg-slate-50/70"
                            >
                              <td className="px-2.5 py-2 font-mono font-bold text-td-blue-dark whitespace-nowrap">
                                {line.code}
                              </td>
                              <td className="px-2.5 py-2 font-semibold text-slate-800 whitespace-nowrap">
                                {line.category}
                              </td>
                              {line.months.map((mv, mIdx) => (
                                <td
                                  key={mIdx}
                                  className="px-2 py-2 text-right font-mono text-slate-600 tabular-nums"
                                >
                                  {formatMoney(mv)}
                                </td>
                              ))}
                              <td className="bg-blue-50/30 px-3 py-2 text-right font-mono font-bold text-td-blue-dark tabular-nums">
                                {formatMoney(line.annualBudgetAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
