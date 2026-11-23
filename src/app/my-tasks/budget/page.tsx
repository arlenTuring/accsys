import Link from 'next/link';
import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ensureEmployeeBudgetTasksAndHistory } from '@/lib/budget-codes/seed-budget-demo';
import { BUDGET_REQUEST_KEY } from '@/lib/custom-forms/migrated/budget';
import { getDb } from '@/lib/db';
import {
  departments,
  formDefinitions,
  formDrafts,
  formSubmissions,
  notifications,
  procurementCases,
  projects,
} from '@/lib/db/schema';
import {
  BudgetHistoryListClient,
  type HistoricalBudgetLine,
  type HistoricalBudgetRecord,
} from './budget-history-client';

export const dynamic = 'force-dynamic';

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default async function MyBudgetTasksPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login?returnTo=/my-tasks/budget');

  // 確保當前登入帳號具備財會人員派發之 116 年度待填預算單範例與 115、114 歷年填寫紀錄
  await ensureEmployeeBudgetTasksAndHistory(employee);

  const db = getDb();

  const [
    allNotifications,
    allDrafts,
    deptRows,
    projectRows,
    budgetDefRows,
  ] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientEmployeeId, employee.id),
          eq(notifications.formType, 'budget_dispatch')
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(30),
    db
      .select()
      .from(formDrafts)
      .where(eq(formDrafts.ownerEmployeeId, employee.id))
      .orderBy(desc(formDrafts.updatedAt)),
    db.select().from(departments),
    db.select().from(projects),
    db
      .select({ id: formDefinitions.id })
      .from(formDefinitions)
      .where(eq(formDefinitions.key, BUDGET_REQUEST_KEY))
      .limit(1),
  ]);

  const deptMap = new Map(deptRows.map((d) => [d.id, `${d.code}｜${d.name}`]));
  const projMap = new Map(
    projectRows.map((p) => [p.id, `${p.code}｜${p.name}`])
  );

  const budgetDrafts = allDrafts.filter((d) => d.formKey === BUDGET_REQUEST_KEY);

  // 查詢該員工歷年填報過的預算申請單紀錄
  const budgetDefId = budgetDefRows[0]?.id;
  const rawSubmissions = budgetDefId
    ? await db
        .select({
          id: formSubmissions.id,
          formNumber: formSubmissions.formNumber,
          status: formSubmissions.status,
          data: formSubmissions.data,
          totalAmount: formSubmissions.totalAmount,
          submittedAt: formSubmissions.submittedAt,
          createdAt: formSubmissions.createdAt,
          caseNumber: procurementCases.caseNumber,
        })
        .from(formSubmissions)
        .innerJoin(
          procurementCases,
          eq(procurementCases.id, formSubmissions.procurementCaseId)
        )
        .where(
          and(
            eq(formSubmissions.definitionId, budgetDefId),
            eq(formSubmissions.applicantEmployeeId, employee.id)
          )
        )
        .orderBy(desc(formSubmissions.submittedAt))
    : [];

  const historicalRecords: HistoricalBudgetRecord[] = rawSubmissions
    .map((sub) => {
      const data = (sub.data ?? {}) as Record<string, unknown>;
      const fy = String(data.fiscalYear ?? '115').trim();
      const scope: 'department' | 'project' =
        data.budgetScope === 'project' ? 'project' : 'department';
      const deptId = String(data.targetDepartmentId ?? '');
      const projId = String(data.targetProjectId ?? '');
      const unitLabel =
        scope === 'project'
          ? projMap.get(projId) || '專案年度預算'
          : deptMap.get(deptId) || '部門年度預算';

      const itemsObj = (data.items ?? {}) as { rows?: Record<string, unknown>[] };
      const rawRows = Array.isArray(itemsObj.rows) ? itemsObj.rows : [];

      const lines: HistoricalBudgetLine[] = rawRows.map((r) => {
        const months = [
          toNum(r.m1),
          toNum(r.m2),
          toNum(r.m3),
          toNum(r.m4),
          toNum(r.m5),
          toNum(r.m6),
          toNum(r.m7),
          toNum(r.m8),
          toNum(r.m9),
          toNum(r.m10),
          toNum(r.m11),
          toNum(r.m12),
        ];
        const monthSum = months.reduce((a, b) => a + b, 0);
        const annual = toNum(r.annualBudgetAmount) || monthSum;
        return {
          code: String(r.code ?? ''),
          category: String(r.category ?? ''),
          itemCode: String(r.itemCode ?? ''),
          accountNumber: String(r.accountNumber ?? ''),
          prevApprovedBudget: toNum(r.prevApprovedBudget),
          prevActualAmount: toNum(r.prevActualAmount),
          months,
          annualBudgetAmount: annual,
          description: String(r.description ?? ''),
        };
      });

      const totalPrevApproved = lines.reduce(
        (s, l) => s + l.prevApprovedBudget,
        0
      );
      const totalPrevActual = lines.reduce(
        (s, l) => s + l.prevActualAmount,
        0
      );
      const totalAnnualBudget =
        lines.reduce((s, l) => s + l.annualBudgetAmount, 0) ||
        toNum(sub.totalAmount);

      return {
        id: sub.id,
        formNumber: sub.formNumber,
        caseNumber: sub.caseNumber,
        fiscalYear: fy,
        budgetScope: scope,
        unitLabel,
        reason: String(data.reason ?? ''),
        status: sub.status,
        submittedDateLabel: new Date(
          sub.submittedAt ?? sub.createdAt
        ).toLocaleDateString('zh-TW'),
        totalPrevApproved,
        totalPrevActual,
        totalAnnualBudget,
        lines,
        detailHref: `/f/${BUDGET_REQUEST_KEY}/${sub.id}`,
      };
    })
    .sort((a, b) => Number(b.fiscalYear) - Number(a.fiscalYear));

  // 將財會派發通知與對應的自動儲存草稿進行配對
  const usedDraftIds = new Set<string>();
  const dispatchedTasks = allNotifications.map((n) => {
    const fyMatch = n.caseNumber.match(/BUDGET-(\d+)/);
    const fy = fyMatch ? fyMatch[1]! : '116';
    const isProjectTask =
      n.caseNumber.includes('PROJ') ||
      (n.message.includes('專案預算') && !n.message.includes('部門預算'));
    const targetScope: 'department' | 'project' = isProjectTask
      ? 'project'
      : 'department';

    const matchedDraft = budgetDrafts.find((d) => {
      if (usedDraftIds.has(d.id)) return false;
      const dData = (d.data ?? {}) as Record<string, unknown>;
      const dFy = String(dData.fiscalYear ?? '116');
      const dScope = dData.budgetScope === 'project' ? 'project' : 'department';
      return dFy === fy && dScope === targetScope;
    });

    if (matchedDraft) {
      usedDraftIds.add(matchedDraft.id);
    }

    const draftData = (matchedDraft?.data ?? {}) as Record<string, unknown>;
    const draftItems = (draftData.items ?? {}) as {
      rows?: Record<string, unknown>[];
      total?: number;
    };
    const draftRowsCount = Array.isArray(draftItems.rows)
      ? draftItems.rows.length
      : 0;
    const draftTotalAmount = toNum(draftItems.total);

    return {
      id: n.id,
      caseNumber: n.caseNumber,
      fiscalYear: fy,
      scope: targetScope,
      message: n.message,
      createdAt: n.createdAt,
      isRead: n.isRead,
      matchedDraft,
      draftRowsCount,
      draftTotalAmount,
    };
  });

  return (
    <main className="page-shell space-y-6">
      {/* 頁面頂部說明（無常駐新增按鈕，僅由財會派發觸發） */}
      <section className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
              財會派發任務制 · 歷年預算歸檔
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-td-blue-dark">
            年度預算表填報與歷年紀錄
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            年度預算表由財會部門統一發送填報通知後開放填寫（填寫過程皆會即時自動儲存）；非填報期間或已完成送出後，您可於下方查閱歷年填寫的預算明細與差異分析紀錄。
          </p>
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs">
          <div>
            <span className="text-slate-500">待填報派發單：</span>
            <strong className="font-mono text-sm text-amber-700">
              {dispatchedTasks.length}
            </strong>
            <span className="ml-1 text-slate-500">張</span>
          </div>
          <span className="text-slate-300">|</span>
          <div>
            <span className="text-slate-500">歷年已填寫紀錄：</span>
            <strong className="font-mono text-sm text-td-blue-dark">
              {historicalRecords.length}
            </strong>
            <span className="ml-1 text-slate-500">筆</span>
          </div>
        </div>
      </section>

      {/* 區塊 1：財會人員派發給我的待填預算編列單（含線上即時自動儲存草稿接續） */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-td-blue-dark">
              📨 財會部門派發之待填預算編列單（{dispatchedTasks.length} 張）
            </h2>
            <p className="text-xs text-slate-500">
              僅在財會人員指派年度預算編列任務給您的帳號時顯示；點選即可進入線上表格填寫 1～12 月預算與差異說明，所有輸入皆會即時自動儲存。
            </p>
          </div>
        </div>

        {dispatchedTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-7 text-center text-xs text-slate-500">
            目前財會部門尚未派發新的年度預算填寫單給您的帳號。下方可查閱您歷年填寫過的預算表紀錄。
          </div>
        ) : (
          <div className="grid gap-3.5">
            {dispatchedTasks.map((task) => {
              const westYear =
                Number(task.fiscalYear) < 1911
                  ? Number(task.fiscalYear) + 1911
                  : Number(task.fiscalYear);
              const hasDraft = Boolean(task.matchedDraft);
              const fillHref = task.matchedDraft
                ? `/f/${BUDGET_REQUEST_KEY}/new?draft=${task.matchedDraft.id}&year=${encodeURIComponent(
                    task.fiscalYear
                  )}&scope=${task.scope}`
                : `/f/${BUDGET_REQUEST_KEY}/new?year=${encodeURIComponent(
                    task.fiscalYear
                  )}&scope=${task.scope}`;

              return (
                <div
                  key={task.id}
                  className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 transition ${
                    hasDraft
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-amber-200/80 bg-amber-50/30'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-md bg-td-blue px-2.5 py-0.5 font-mono font-bold text-white">
                        {task.caseNumber}
                      </span>
                      <span className="rounded-md bg-white px-2 py-0.5 font-bold text-td-blue-dark ring-1 ring-slate-200">
                        {task.fiscalYear} 年度（{westYear}）·{' '}
                        {task.scope === 'project'
                          ? '專案年度預算表'
                          : '部門年度預算表'}
                      </span>
                      {hasDraft ? (
                        <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                          💾 填寫中（已即時自動儲存 {task.draftRowsCount} 項科目 · 預估合計 NT${' '}
                          {task.draftTotalAmount.toLocaleString('en-US')}）
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-bold text-white">
                          ⏳ 財會新派發 · 待開始填寫
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        派發時間：
                        {new Date(task.createdAt).toLocaleString('zh-TW')}
                      </span>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-700">
                      {task.message}
                    </p>

                    {task.matchedDraft && (
                      <p className="text-[11px] font-medium text-emerald-800">
                        最後自動儲存時間：
                        {new Date(task.matchedDraft.updatedAt).toLocaleString(
                          'zh-TW'
                        )}{' '}
                        — 點擊右側按鈕可直接接續上次填寫進度。
                      </p>
                    )}
                  </div>

                  <div className="shrink-0">
                    <Link
                      href={fillHref}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-bold text-white shadow-2xs transition ${
                        hasDraft
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-td-blue hover:opacity-90'
                      }`}
                    >
                      填寫預算計劃
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 區塊 2：歷年預算填寫紀錄（115 年度、114 年度等歷史紀錄與明細對照） */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-td-blue-dark">
              📚 歷年預算填寫紀錄（共 {historicalRecords.length} 筆）
            </h2>
            <p className="text-xs text-slate-500">
              檢視您歷年已填報並核定之部門年度預算表、專案年度預算表、跨年度執行差異分析及 1～12 月分月編列明細。
            </p>
          </div>
        </div>

        <BudgetHistoryListClient records={historicalRecords} />
      </section>
    </main>
  );
}
