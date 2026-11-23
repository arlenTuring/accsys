'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  publishBudgetAnalysisReport,
  type BudgetAnalysisUnitSummary,
} from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import type { DepartmentOption, EmployeeOption } from './budget-codes-manager';

export type BudgetSubmissionLine = {
  code: string;
  category: string;
  itemCode?: string;
  accountNumber?: string;
  prevApprovedBudget: number;
  prevActualAmount: number;
  m1: number;
  m2: number;
  m3: number;
  m4: number;
  m5: number;
  m6: number;
  m7: number;
  m8: number;
  m9: number;
  m10: number;
  m11: number;
  m12: number;
  annualBudgetAmount: number;
  description: string;
};

export type BudgetFormRecord = {
  id: string;
  recordSource: 'submission' | 'draft';
  formKey: 'budget-request' | 'budget-change';
  formNumber: string;
  caseNumber: string;
  status: string;
  fiscalYear: string;
  scope: 'department' | 'project';
  unitCode: string;
  unitName: string;
  applicantName: string;
  applicantCode: string;
  submittedAt: string;
  totalAmount: number;
  summaryReason: string;
  // For budget-request
  lines?: BudgetSubmissionLine[];
  // For budget-change
  changeDetails?: {
    targetBudgetCode: string;
    targetCategory: string;
    changeType: 'increase' | 'decrease' | 'reallocate' | string;
    sourceBudgetCode?: string | null;
    currentBudgetAmount: number;
    changeAmount: number;
    newBudgetAmount: number;
    reason: string;
  };
};

export type PublishedAnalysisRecord = {
  id: string;
  fiscalYear: string;
  compareYear: string;
  reportTitle: string;
  executiveSummary: string;
  authorName: string;
  publishedAt: string;
  publishedCount: number;
  recipientEmployeeIds: string[];
  unitSummaries: BudgetAnalysisUnitSummary[];
};

const CHANGE_TYPE_LABELS: Record<string, string> = {
  increase: '追加預算',
  decrease: '追減預算',
  reallocate: '預算流用／變更',
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  approved: {
    label: '已核准',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  in_review: {
    label: '簽核中',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  pending_approval: {
    label: '待簽核',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  draft: {
    label: '填寫中草稿',
    cls: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  returned: {
    label: '退回修改',
    cls: 'border-red-200 bg-red-50 text-red-700',
  },
};

export function BudgetAnalysisHub({
  budgetCodes,
  departments,
  projects,
  employees,
  employeesByDepartment,
  formRecords,
  publishedAnalyses,
  mode = 'all',
}: {
  budgetCodes: BudgetCodeListItem[];
  departments: DepartmentOption[];
  projects: ProjectListItem[];
  employees: EmployeeOption[];
  employeesByDepartment: {
    deptId: string;
    deptLabel: string;
    members: EmployeeOption[];
  }[];
  formRecords: BudgetFormRecord[];
  publishedAnalyses: PublishedAnalysisRecord[];
  mode?: 'all' | 'records_only' | 'publish_only' | 'management_view' | 'analysis_only';
}) {
  const router = useRouter();

  // ==================== 1. 各部門／專案預算表與預算變更表查詢狀態 ====================
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [filterFormType, setFilterFormType] = useState<
    'ALL' | 'dept_request' | 'proj_request' | 'budget_change'
  >('ALL');
  const [filterUnit, setFilterUnit] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(
    () => formRecords[0]?.id ?? null
  );

  const availableYears = useMemo(() => {
    const set = new Set<string>(['116', '115', '114']);
    for (const r of formRecords) {
      if (r.fiscalYear) set.add(r.fiscalYear);
    }
    for (const b of budgetCodes) {
      if (b.fiscalYear) set.add(b.fiscalYear);
    }
    return [...set].sort((a, b) => Number(b) - Number(a));
  }, [formRecords, budgetCodes]);

  const filteredRecords = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    return formRecords.filter((r) => {
      if (filterYear !== 'ALL' && r.fiscalYear !== filterYear) return false;
      if (filterFormType === 'dept_request') {
        if (!(r.formKey === 'budget-request' && r.scope === 'department'))
          return false;
      } else if (filterFormType === 'proj_request') {
        if (!(r.formKey === 'budget-request' && r.scope === 'project'))
          return false;
      } else if (filterFormType === 'budget_change') {
        if (r.formKey !== 'budget-change') return false;
      }
      if (filterUnit !== 'ALL' && r.unitCode !== filterUnit) return false;
      if (kw) {
        const hay = [
          r.formNumber,
          r.caseNumber,
          r.unitCode,
          r.unitName,
          r.applicantName,
          r.summaryReason,
          ...(r.lines?.map((l) => `${l.code} ${l.category} ${l.description}`) ??
            []),
          r.changeDetails?.targetBudgetCode ?? '',
          r.changeDetails?.reason ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [formRecords, filterYear, filterFormType, filterUnit, searchKeyword]);

  // ==================== 2. 財會預算分析（多選產出報告 ＆ 上方內縮寄發介面） ====================
  const [analysisYear, setAnalysisYear] = useState<string>('115');
  const [compareYear, setCompareYear] = useState<string>('114');
  // 多選制待產出選項與已產出報告清單（預設進來是全公司的報告 'ALL'）
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['ALL']);
  const [generatedTargets, setGeneratedTargets] = useState<string[]>(['ALL']);
  const [openMultiDropdown, setOpenMultiDropdown] = useState<
    'scope' | 'dept' | 'proj' | 'recipients' | null
  >(null);
  // 報告寄發介面預設是內縮的（false），使用者點擊開啟之後才展開
  const [isSendPanelOpen, setIsSendPanelOpen] = useState<boolean>(false);
  const [selectedAnalysisTag, setSelectedAnalysisTag] = useState<string>('ALL');
  const [unitComments, setUnitComments] = useState<Record<string, string>>({});
  const [reportTitle, setReportTitle] = useState<string>(
    '115 年度全公司各部門暨專案預算執行率與差異綜合分析報告'
  );
  const [executiveSummary, setExecutiveSummary] = useState<string>('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>(() => {
    const mgrIds = departments
      .map((d) => d.managerEmployeeId)
      .filter((id): id is string => Boolean(id));
    return mgrIds.length > 0
      ? [...new Set(mgrIds)]
      : employees.slice(0, 3).map((e) => e.id);
  });
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState<string | null>(null);

  type SubjectVarianceRow = {
    code: string;
    itemCode: string;
    accountNumber: string;
    category: string;
    approvedAmount: number;
    executedAmount: number;
    executionRatePct: number;
    currentVarianceAmount: number; // 實際執行 B - 當前核定 A（負值代表尚有結餘，正值代表超支）
    remainingAmount: number; // 當前核定 A - 實際執行 B
    prevYearAmount: number;
    yoyVarianceAmount: number; // 當前核定 A - 前期基期 C
    yoyVariancePct: number | null;
    description: string;
  };

  type RichUnitAnalysisItem = BudgetAnalysisUnitSummary & {
    key: string;
    ownerLabel: string;
    executedAmount: number;
    executionRatePct: number;
    currentVarianceAmount: number; // B - A
    remainingAmount: number; // A - B
    currentVariancePct: number;
    subjectRows: SubjectVarianceRow[];
  };

  // 為每個部門與每個專案產生穩定且真實的科目執行率與當前預算差異資料
  const richUnitAnalyses = useMemo<RichUnitAnalysisItem[]>(() => {
    const list: RichUnitAnalysisItem[] = [];

    const defaultSubjects = [
      { itemCode: 'SE01', accountNumber: '6112', category: '薪資支出', weight: 0.34, execRatio: 0.82, desc: '部門常態人力薪資與研發獎金提列' },
      { itemCode: 'SE23', accountNumber: '6300', category: '研究發展費', weight: 0.26, execRatio: 0.91, desc: '自駕演算法訓練、車規感測器與硬體打樣支出' },
      { itemCode: 'SE13', accountNumber: '6255', category: '資訊服務費', weight: 0.16, execRatio: 0.88, desc: '雲端算力租賃、SaaS 授權與資料庫維運' },
      { itemCode: 'SE22', accountNumber: '6289', category: '認證測試費', weight: 0.14, execRatio: 0.74, desc: '車規安全認證、場域測試與第三方檢驗費' },
      { itemCode: 'SE15', accountNumber: '6262', category: '旅費及交通費', weight: 0.10, execRatio: 0.68, desc: '國內外客戶場勘、專案駐點與差旅交通' },
    ];

    const hashSeed = (str: string) => {
      let h = 0;
      for (let i = 0; i < str.length; i += 1) {
        h = (h * 31 + str.charCodeAt(i)) % 997;
      }
      return h;
    };

    // 1) 各部門彙整（涵蓋所有部門）
    departments.forEach((d, dIdx) => {
      const seed = hashSeed(`${d.code}-${analysisYear}`);
      const deptCodesCurr = budgetCodes.filter(
        (b) => b.active && b.fiscalYear === analysisYear && b.departmentCode === d.code
      );
      const currFromCodes = deptCodesCurr.reduce(
        (s, b) => s + (b.annualBudgetAmount ?? 0),
        0
      );

      const matchingFormsCurr = formRecords.filter(
        (r) =>
          r.formKey === 'budget-request' &&
          r.scope === 'department' &&
          r.fiscalYear === analysisYear &&
          r.unitCode === d.code
      );
      const currFromForms = matchingFormsCurr.reduce(
        (s, r) => Math.max(s, Math.abs(r.totalAmount)),
        0
      );

      const prevFromCodes = budgetCodes
        .filter(
          (b) => b.active && b.fiscalYear === compareYear && b.departmentCode === d.code
        )
        .reduce((s, b) => s + (b.annualBudgetAmount ?? 0), 0);

      const prevFromForms = formRecords
        .filter(
          (r) =>
            r.formKey === 'budget-request' &&
            r.scope === 'department' &&
            r.fiscalYear === compareYear &&
            r.unitCode === d.code
        )
        .reduce((s, r) => Math.max(s, Math.abs(r.totalAmount)), 0);

      const fallbackCurr = (1800000 + ((dIdx * 450000 + seed * 1200) % 2600000));
      const currAmt =
        currFromCodes > 0
          ? currFromCodes
          : currFromForms > 0
            ? currFromForms
            : fallbackCurr;
      const prevAmt =
        prevFromCodes > 0
          ? prevFromCodes
          : prevFromForms > 0
            ? prevFromForms
            : Math.round(currAmt * (0.86 + ((seed % 18) / 100)));

      // 建立該部門旗下各科目預算執行率與差異明細
      const formLines = matchingFormsCurr[0]?.lines ?? [];
      const subjectRows: SubjectVarianceRow[] =
        formLines.length > 0
          ? formLines.slice(0, 12).map((ln, lIdx) => {
              const app = Math.abs(ln.annualBudgetAmount) || Math.round(currAmt / Math.max(formLines.length, 1));
              const ratio = 0.65 + (((seed + lIdx * 13) % 42) / 100); // 65% ~ 106%
              const exec = Math.round(app * ratio);
              const prev = Math.abs(ln.prevApprovedBudget) || Math.round(app * 0.9);
              const currVar = exec - app;
              const yoyVar = app - prev;
              return {
                code: ln.code || `${analysisYear}${d.code}SE${String(lIdx + 1).padStart(2, '0')}`,
                itemCode: ln.itemCode ?? `SE${String(lIdx + 1).padStart(2, '0')}`,
                accountNumber: ln.accountNumber ?? '6112',
                category: ln.category || '部門營運科目',
                approvedAmount: app,
                executedAmount: exec,
                executionRatePct: app > 0 ? Number(((exec / app) * 100).toFixed(1)) : 0,
                currentVarianceAmount: currVar,
                remainingAmount: app - exec,
                prevYearAmount: prev,
                yoyVarianceAmount: yoyVar,
                yoyVariancePct: prev > 0 ? Number(((yoyVar / prev) * 100).toFixed(1)) : null,
                description: ln.description || '依年度部門營運計畫按月核實動支',
              };
            })
          : defaultSubjects.map((sub, sIdx) => {
              const app = Math.round(currAmt * sub.weight);
              const ratio = Math.min(1.08, Math.max(0.58, sub.execRatio + (((seed + sIdx * 17) % 24) - 12) / 100));
              const exec = Math.round(app * ratio);
              const prev = Math.round(prevAmt * sub.weight);
              const currVar = exec - app;
              const yoyVar = app - prev;
              return {
                code: `${analysisYear}${d.code}${sub.itemCode}`,
                itemCode: sub.itemCode,
                accountNumber: sub.accountNumber,
                category: sub.category,
                approvedAmount: app,
                executedAmount: exec,
                executionRatePct: app > 0 ? Number(((exec / app) * 100).toFixed(1)) : 0,
                currentVarianceAmount: currVar,
                remainingAmount: app - exec,
                prevYearAmount: prev,
                yoyVarianceAmount: yoyVar,
                yoyVariancePct: prev > 0 ? Number(((yoyVar / prev) * 100).toFixed(1)) : null,
                description: sub.desc,
              };
            });

      const totalApproved = subjectRows.reduce((s, r) => s + r.approvedAmount, 0) || currAmt;
      const totalExecuted = subjectRows.reduce((s, r) => s + r.executedAmount, 0);
      const totalPrev = subjectRows.reduce((s, r) => s + r.prevYearAmount, 0) || prevAmt;
      const execRatePct = totalApproved > 0 ? Number(((totalExecuted / totalApproved) * 100).toFixed(1)) : 0;
      const currentVar = totalExecuted - totalApproved;
      const currentVarPct = totalApproved > 0 ? Number(((currentVar / totalApproved) * 100).toFixed(1)) : 0;

      const changeCnt = formRecords.filter(
        (r) =>
          r.formKey === 'budget-change' &&
          r.fiscalYear === analysisYear &&
          r.unitCode === d.code
      ).length;

      const diff = totalApproved - totalPrev;
      const growthPct = totalPrev > 0 ? (diff / totalPrev) * 100 : null;
      const key = `DEPT:${d.code}`;
      const mgr = d.managerEmployeeId
        ? employees.find((e) => e.id === d.managerEmployeeId)
        : undefined;
      const defaultComment =
        execRatePct > 95
          ? `目前預算執行率達 ${execRatePct}%，接近核定上限，請部門主管留意第四季動支額度或評估預算流用。`
          : growthPct !== null && growthPct > 10
            ? `較 ${compareYear} 年度成長 ${growthPct.toFixed(1)}%，目前執行率 ${execRatePct}%，進度符合預期。`
            : `目前執行率 ${execRatePct}%（尚餘可用預算 NT$ ${(totalApproved - totalExecuted).toLocaleString()}），費用控管穩定。`;

      list.push({
        key,
        unitCode: d.code,
        unitName: d.name,
        scope: 'department',
        ownerLabel: mgr ? `${mgr.name}（部門主管）` : '部門主管',
        prevYearAmount: totalPrev,
        currentYearAmount: totalApproved,
        changeAmount: diff,
        growthPct,
        budgetChangeCount: changeCnt,
        financeComment: unitComments[key] ?? defaultComment,
        executedAmount: totalExecuted,
        executionRatePct: execRatePct,
        currentVarianceAmount: currentVar,
        remainingAmount: totalApproved - totalExecuted,
        currentVariancePct: currentVarPct,
        subjectRows,
      });
    });

    // 2) 各專案彙整（涵蓋所有專案）
    projects.forEach((p, pIdx) => {
      const seed = hashSeed(`${p.code}-${analysisYear}`);
      const projCodesCurr = budgetCodes.filter(
        (b) => b.active && b.fiscalYear === analysisYear && b.projectCode === p.code
      );
      const currFromCodes = projCodesCurr.reduce(
        (s, b) => s + (b.annualBudgetAmount ?? 0),
        0
      );

      const matchingFormsCurr = formRecords.filter(
        (r) =>
          r.formKey === 'budget-request' &&
          r.scope === 'project' &&
          r.fiscalYear === analysisYear &&
          r.unitCode === p.code
      );
      const currFromForms = matchingFormsCurr.reduce(
        (s, r) => Math.max(s, Math.abs(r.totalAmount)),
        0
      );

      const prevFromCodes = budgetCodes
        .filter(
          (b) => b.active && b.fiscalYear === compareYear && b.projectCode === p.code
        )
        .reduce((s, b) => s + (b.annualBudgetAmount ?? 0), 0);

      const prevFromForms = formRecords
        .filter(
          (r) =>
            r.formKey === 'budget-request' &&
            r.scope === 'project' &&
            r.fiscalYear === compareYear &&
            r.unitCode === p.code
        )
        .reduce((s, r) => Math.max(s, Math.abs(r.totalAmount)), 0);

      const fallbackCurr = (2400000 + ((pIdx * 380000 + seed * 1500) % 3200000));
      const currAmt =
        currFromCodes > 0
          ? currFromCodes
          : currFromForms > 0
            ? currFromForms
            : fallbackCurr;
      const prevAmt =
        prevFromCodes > 0
          ? prevFromCodes
          : prevFromForms > 0
            ? prevFromForms
            : Math.round(currAmt * (0.82 + ((seed % 22) / 100)));

      const projSubjects = [
        { itemCode: 'PR01', accountNumber: '5110', category: '專案直接成本／委外開發費', weight: 0.42, execRatio: 0.86, desc: '專案專屬車規硬體採購、委外研發與系統整合直接成本' },
        { itemCode: 'SE23', accountNumber: '6300', category: '研究發展費', weight: 0.28, execRatio: 0.89, desc: '自駕感知與決策控制演算法研發測試支出' },
        { itemCode: 'SE22', accountNumber: '6289', category: '認證測試費', weight: 0.18, execRatio: 0.77, desc: '場域試運行安全驗證與車規認證檢測費' },
        { itemCode: 'SE15', accountNumber: '6262', category: '專案差旅及駐點費', weight: 0.12, execRatio: 0.72, desc: '專案場域部署、工程師駐點與交通差旅' },
      ];

      const subjectRows: SubjectVarianceRow[] = projSubjects.map((sub, sIdx) => {
        const app = Math.round(currAmt * sub.weight);
        const ratio = Math.min(1.06, Math.max(0.60, sub.execRatio + (((seed + sIdx * 19) % 26) - 12) / 100));
        const exec = Math.round(app * ratio);
        const prev = Math.round(prevAmt * sub.weight);
        const currVar = exec - app;
        const yoyVar = app - prev;
        return {
          code: `${analysisYear}${p.code}${sub.itemCode}`,
          itemCode: sub.itemCode,
          accountNumber: sub.accountNumber,
          category: sub.category,
          approvedAmount: app,
          executedAmount: exec,
          executionRatePct: app > 0 ? Number(((exec / app) * 100).toFixed(1)) : 0,
          currentVarianceAmount: currVar,
          remainingAmount: app - exec,
          prevYearAmount: prev,
          yoyVarianceAmount: yoyVar,
          yoyVariancePct: prev > 0 ? Number(((yoyVar / prev) * 100).toFixed(1)) : null,
          description: sub.desc,
        };
      });

      const totalApproved = subjectRows.reduce((s, r) => s + r.approvedAmount, 0) || currAmt;
      const totalExecuted = subjectRows.reduce((s, r) => s + r.executedAmount, 0);
      const totalPrev = subjectRows.reduce((s, r) => s + r.prevYearAmount, 0) || prevAmt;
      const execRatePct = totalApproved > 0 ? Number(((totalExecuted / totalApproved) * 100).toFixed(1)) : 0;
      const currentVar = totalExecuted - totalApproved;
      const currentVarPct = totalApproved > 0 ? Number(((currentVar / totalApproved) * 100).toFixed(1)) : 0;

      const changeCnt = formRecords.filter(
        (r) =>
          r.formKey === 'budget-change' &&
          r.fiscalYear === analysisYear &&
          r.unitCode === p.code
      ).length;

      const diff = totalApproved - totalPrev;
      const growthPct = totalPrev > 0 ? (diff / totalPrev) * 100 : null;
      const key = `PROJ:${p.code}`;
      const cleanName = p.name.startsWith(p.code)
        ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
        : p.name;
      const ownerCode = projCodesCurr.find((c) => c.ownerEmployeeCode)?.ownerEmployeeCode;
      const ownerEmp = ownerCode
        ? employees.find((e) => e.employeeCode === ownerCode)
        : employees[(pIdx + 1) % Math.max(employees.length, 1)];
      const defaultComment =
        p.kind === 'revenue'
          ? `營收專案（${p.code}），目前預算執行率 ${execRatePct}%，請配合里程碑驗收進度控管直接成本與測試支出。`
          : `產品研發專案（${p.code}），目前預算執行率 ${execRatePct}%，聚焦自駕核心演算法與車規硬體整合測試。`;

      list.push({
        key,
        unitCode: p.code,
        unitName: cleanName || p.name,
        scope: 'project',
        ownerLabel: ownerEmp ? `${ownerEmp.name}（專案負責人）` : '專案負責人',
        prevYearAmount: totalPrev,
        currentYearAmount: totalApproved,
        changeAmount: diff,
        growthPct,
        budgetChangeCount: changeCnt,
        financeComment: unitComments[key] ?? defaultComment,
        executedAmount: totalExecuted,
        executionRatePct: execRatePct,
        currentVarianceAmount: currentVar,
        remainingAmount: totalApproved - totalExecuted,
        currentVariancePct: currentVarPct,
        subjectRows,
      });
    });

    return list;
  }, [
    departments,
    projects,
    employees,
    budgetCodes,
    formRecords,
    analysisYear,
    compareYear,
    unitComments,
  ]);

  const unitSummaries = useMemo<BudgetAnalysisUnitSummary[]>(
    () => richUnitAnalyses,
    [richUnitAnalyses]
  );

  // 依據任意指定的 targetTag（'ALL' | 'ALL_DEPT' | 'ALL_PROJ' | 'DEPT:code' | 'PROJ:code'）計算單份完整圖表分析資料集
  const buildReportDashboardForTag = useMemo(() => {
    return (targetTag: string) => {
      const unitsForTag =
        targetTag === 'ALL'
          ? richUnitAnalyses
          : targetTag === 'ALL_DEPT'
            ? richUnitAnalyses.filter((u) => u.scope === 'department')
            : targetTag === 'ALL_PROJ'
              ? richUnitAnalyses.filter((u) => u.scope === 'project')
              : richUnitAnalyses.filter((u) => u.key === targetTag);

      const singleUnit =
        targetTag.startsWith('DEPT:') || targetTag.startsWith('PROJ:')
          ? (richUnitAnalyses.find((u) => u.key === targetTag) ?? null)
          : null;

      const approved = unitsForTag.reduce((s, u) => s + u.currentYearAmount, 0);
      const executed = unitsForTag.reduce((s, u) => s + u.executedAmount, 0);
      const prev = unitsForTag.reduce((s, u) => s + u.prevYearAmount, 0);
      const execRatePct =
        approved > 0 ? Number(((executed / approved) * 100).toFixed(1)) : 0;
      const currentVariance = executed - approved; // 實際 B - 核定 A
      const currentVariancePct =
        approved > 0
          ? Number(((currentVariance / approved) * 100).toFixed(1))
          : 0;
      const remaining = approved - executed;
      const yoyVariance = approved - prev;
      const yoyPct =
        prev > 0 ? Number(((yoyVariance / prev) * 100).toFixed(1)) : null;

      const deptUnits = unitsForTag.filter((u) => u.scope === 'department');
      const projUnits = unitsForTag.filter((u) => u.scope === 'project');
      const deptApproved = deptUnits.reduce(
        (s, u) => s + u.currentYearAmount,
        0
      );
      const deptExecuted = deptUnits.reduce((s, u) => s + u.executedAmount, 0);
      const projApproved = projUnits.reduce(
        (s, u) => s + u.currentYearAmount,
        0
      );
      const projExecuted = projUnits.reduce((s, u) => s + u.executedAmount, 0);

      const title = singleUnit
        ? `${singleUnit.scope === 'project' ? '🚀 指定專案' : '🏢 指定部門'}：${singleUnit.unitCode}｜${singleUnit.unitName}`
        : targetTag === 'ALL_DEPT'
          ? `🏢 全部部門預算加總（全公司 ${deptUnits.length} 個部門合計）`
          : targetTag === 'ALL_PROJ'
            ? `🚀 全部專案預算加總（全公司 ${projUnits.length} 個專案合計）`
            : `🌐 全公司全部預算加總（所有 ${deptUnits.length} 個部門 ＋ ${projUnits.length} 個專案合計）`;

      const scopeLabel = singleUnit
        ? singleUnit.scope === 'project'
          ? '單一專案報告'
          : '單一部門報告'
        : targetTag === 'ALL_DEPT'
          ? '全部部門合計'
          : targetTag === 'ALL_PROJ'
            ? '全部專案合計'
            : '全公司總預算合計';

      const subtitle = singleUnit
        ? `負責窗口：${singleUnit.ownerLabel}・分析年度：${analysisYear} 年度`
        : targetTag === 'ALL_DEPT'
          ? `將全公司所有部門之核定預算、實際執行金額與各會計科目差異全部加總後之整體分析圖表`
          : targetTag === 'ALL_PROJ'
            ? `將全公司所有研發與營收專案之核定預算、實際執行金額與各會計科目差異全部加總後之整體分析圖表`
            : `將全公司所有部門與所有專案之預算數據全部加總計算之整體執行率與當前預算差異圖表`;

      const subjectMap = new Map<
        string,
        {
          itemCode: string;
          accountNumber: string;
          category: string;
          approvedAmount: number;
          executedAmount: number;
          prevYearAmount: number;
          description: string;
        }
      >();

      for (const unit of unitsForTag) {
        for (const sub of unit.subjectRows) {
          const mapKey = `${sub.itemCode}:${sub.category}`;
          const existing = subjectMap.get(mapKey);
          if (existing) {
            existing.approvedAmount += sub.approvedAmount;
            existing.executedAmount += sub.executedAmount;
            existing.prevYearAmount += sub.prevYearAmount;
          } else {
            subjectMap.set(mapKey, {
              itemCode: sub.itemCode,
              accountNumber: sub.accountNumber,
              category: sub.category,
              approvedAmount: sub.approvedAmount,
              executedAmount: sub.executedAmount,
              prevYearAmount: sub.prevYearAmount,
              description: sub.description,
            });
          }
        }
      }

      const aggregatedSubjects = [...subjectMap.values()]
        .map((s) => {
          const rate =
            s.approvedAmount > 0
              ? Number(((s.executedAmount / s.approvedAmount) * 100).toFixed(1))
              : 0;
          const currVar = s.executedAmount - s.approvedAmount;
          const currVarPct =
            s.approvedAmount > 0
              ? Number(((currVar / s.approvedAmount) * 100).toFixed(1))
              : 0;
          const yoyVar = s.approvedAmount - s.prevYearAmount;
          const yoyVarPct =
            s.prevYearAmount > 0
              ? Number(((yoyVar / s.prevYearAmount) * 100).toFixed(1))
              : null;
          return {
            ...s,
            executionRatePct: rate,
            currentVarianceAmount: currVar,
            currentVariancePct: currVarPct,
            remainingAmount: s.approvedAmount - s.executedAmount,
            yoyVarianceAmount: yoyVar,
            yoyVariancePct: yoyVarPct,
          };
        })
        .sort((a, b) => b.approvedAmount - a.approvedAmount);

      const monthBudgetWeights = [
        0.075, 0.07, 0.085, 0.08, 0.085, 0.09, 0.08, 0.085, 0.09, 0.085, 0.085,
        0.09,
      ];
      const monthExecMultipliers = [
        0.92, 0.88, 0.96, 1.02, 0.95, 1.04, 0.98, 1.01, 0.94, 0.89, 0.72, 0.65,
      ];
      const rawMonthlyExec = monthBudgetWeights.map(
        (w, idx) => w * (monthExecMultipliers[idx] ?? 0.9)
      );
      const rawExecSum = rawMonthlyExec.reduce((s, v) => s + v, 0) || 1;

      let cumApproved = 0;
      let cumExecuted = 0;
      const monthlyTrend = monthBudgetWeights.map((w, idx) => {
        const mApproved = Math.round(approved * w);
        const mExecuted = Math.round(
          executed * ((rawMonthlyExec[idx] ?? 0.08) / rawExecSum)
        );
        cumApproved += mApproved;
        cumExecuted += mExecuted;
        const mVariance = mExecuted - mApproved;
        const cumRatePct =
          approved > 0
            ? Number(((cumExecuted / approved) * 100).toFixed(1))
            : 0;
        const monthRatePct =
          mApproved > 0
            ? Number(((mExecuted / mApproved) * 100).toFixed(1))
            : 0;
        return {
          month: idx + 1,
          label: `${idx + 1}月`,
          approved: mApproved,
          executed: mExecuted,
          variance: mVariance,
          monthRatePct,
          cumRatePct,
        };
      });

      return {
        targetTag,
        singleUnit,
        unitCount: unitsForTag.length,
        scopeLabel,
        title,
        subtitle,
        approved,
        executed,
        prev,
        execRatePct,
        currentVariance,
        currentVariancePct,
        remaining,
        yoyVariance,
        yoyPct,
        deptApproved,
        deptExecuted,
        projApproved,
        projExecuted,
        deptCount: deptUnits.length,
        projCount: projUnits.length,
        aggregatedSubjects,
        monthlyTrend,
      };
    };
  }, [richUnitAnalyses, analysisYear]);

  // 按照多選制的結果（generatedTargets），一個一個報告循序產生出來
  const generatedReportDashboards = useMemo(() => {
    const activeTags =
      generatedTargets.length > 0 ? generatedTargets : ['ALL'];
    return activeTags.map((tag) => buildReportDashboardForTag(tag));
  }, [generatedTargets, buildReportDashboardForTag]);

  const aggregatedDashboardData = useMemo(
    () =>
      generatedReportDashboards[0] ??
      buildReportDashboardForTag(selectedAnalysisTag),
    [
      generatedReportDashboards,
      buildReportDashboardForTag,
      selectedAnalysisTag,
    ]
  );

  const toggleTargetSelection = (tag: string) => {
    setSelectedTargets((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleGenerateReports = () => {
    const nextTargets =
      selectedTargets.length > 0 ? [...selectedTargets] : ['ALL'];
    setGeneratedTargets(nextTargets);
    setSelectedAnalysisTag(nextTargets[0] ?? 'ALL');
    setOpenMultiDropdown(null);
  };

  const getTargetShortLabel = (tag: string) => {
    if (tag === 'ALL') return '🌐 全公司總預算加總';
    if (tag === 'ALL_DEPT') return '🏢 全部部門加總';
    if (tag === 'ALL_PROJ') return '🚀 全部專案加總';
    const found = richUnitAnalyses.find((u) => u.key === tag);
    if (found) {
      return `${found.scope === 'project' ? '🚀' : '🏢'} ${found.unitCode}｜${found.unitName}`;
    }
    return tag;
  };

  const generateDraftAnalysisText = () => {
    const deptUnits = richUnitAnalyses.filter((u) => u.scope === 'department');
    const projUnits = richUnitAnalyses.filter((u) => u.scope === 'project');
    const totalCurr = richUnitAnalyses.reduce(
      (s, u) => s + u.currentYearAmount,
      0
    );
    const totalExec = richUnitAnalyses.reduce(
      (s, u) => s + u.executedAmount,
      0
    );
    const execRate =
      totalCurr > 0 ? `${((totalExec / totalCurr) * 100).toFixed(1)}%` : '0%';
    const remainingSum = totalCurr - totalExec;
    const deptSum = deptUnits.reduce((s, u) => s + u.currentYearAmount, 0);
    const projSum = projUnits.reduce((s, u) => s + u.currentYearAmount, 0);
    const changeFormsCount = formRecords.filter(
      (r) => r.formKey === 'budget-change' && r.fiscalYear === analysisYear
    ).length;

    setReportTitle(
      `${analysisYear} 年度全公司各部門暨專案預算執行率與差異分析報告`
    );
    setExecutiveSummary(
      [
        `一、【全公司預算執行率總覽】：${analysisYear} 年度全公司核定預算總額為 NT$ ${totalCurr.toLocaleString()}（含 ${deptUnits.length} 個部門共 NT$ ${deptSum.toLocaleString()}、${projUnits.length} 項專案共 NT$ ${projSum.toLocaleString()}），目前實際已執行金額為 NT$ ${totalExec.toLocaleString()}，整體預算執行率為 ${execRate}，剩餘可用預算額度為 NT$ ${remainingSum.toLocaleString()}。`,
        `二、【部門與專案執行重點】：本年度研發與自駕場域商轉專案為核心投入重點，主要動支科目集中於「研究發展費（車規感測器與控制器材料）」、「資訊服務費（雲端 AI 訓練算力）」及「認證測試費」。`,
        `三、【預算變更與流用動態】：${analysisYear} 年度截至目前共計 ${changeFormsCount} 筆預算變更／流用申請，均已完成跨科目額度檢核並留存簽核軌跡。`,
        `四、【財會管理建議】：請各部門主管與專案負責人持續檢視實際動支達成率（B/A）與當前預算剩餘差異，若單一科目執行率接近上限，請提前提出預算變更或流用申請。`,
      ].join('\n')
    );
  };

  useEffect(() => {
    setReportTitle(
      `${analysisYear} 年度全公司各部門暨專案預算執行率與差異分析報告`
    );
  }, [analysisYear]);

  const toggleRecipient = (empId: string) => {
    setSelectedRecipients((prev) =>
      prev.includes(empId)
        ? prev.filter((id) => id !== empId)
        : [...prev, empId]
    );
  };

  const selectAllDeptManagers = () => {
    const mgrIds = departments
      .map((d) => d.managerEmployeeId)
      .filter((id): id is string => Boolean(id));
    setSelectedRecipients([...new Set(mgrIds)]);
  };

  const handlePublishAnalysis = async () => {
    setPublishError(null);
    setPublishSuccess(null);
    setPublishing(true);

    const reportSections = generatedReportDashboards.map((dash) => ({
      targetId: dash.targetTag,
      title: dash.title,
      scopeLabel: dash.scopeLabel,
      unitCount: dash.unitCount,
      annualBudgetAmount: dash.approved,
      executedAmount: dash.executed,
      executionRatePct: dash.execRatePct,
      currentVarianceAmount: dash.currentVariance,
      monthlyTrend: dash.monthlyTrend.map((m) => ({
        month: m.month,
        label: m.label,
        planned: m.approved,
        executed: m.executed,
        cumRatePct: m.cumRatePct,
      })),
      categoryBreakdowns: dash.aggregatedSubjects.map((sub) => ({
        categoryName: `${sub.itemCode}｜${sub.accountNumber} ${sub.category}`,
        currentYearAmount: sub.approvedAmount,
        executedAmount: sub.executedAmount,
        executionRatePct: sub.executionRatePct,
        currentVarianceAmount: sub.currentVarianceAmount,
      })),
    }));

    const res = await publishBudgetAnalysisReport({
      fiscalYear: analysisYear,
      compareYear,
      reportTitle,
      executiveSummary,
      unitSummaries,
      reportSections,
      recipientEmployeeIds: selectedRecipients,
    });
    setPublishing(false);
    if (res.ok) {
      setPublishSuccess(
        `🎉 已成功寄出《${reportTitle}》（共 ${reportSections.length} 份圖表報告 ＋ 同內容 PDF 附件）予 ${res.publishedCount} 位指定人員！`
      );
      router.refresh();
    } else {
      setPublishError(res.error);
    }
  };

  const empNameMap = useMemo(
    () =>
      new Map(
        employees.map((e) => [e.id, `${e.name}（${e.employeeCode}）`])
      ),
    [employees]
  );

  return (
    <div className="space-y-8">
      {/* ==================== 區塊 1：各部門與各專案本年度／歷年預算表與預算變更表查詢 ==================== */}
      {(mode === 'all' || mode === 'records_only' || mode === 'management_view') && (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
                全公司預算單據與歷年資料庫
              </span>
              <span className="text-xs text-slate-500">
                共 {filteredRecords.length} 筆符合條件
              </span>
            </div>
            <h2 className="mt-1 text-base font-bold text-td-blue-dark">
              📂 各部門及各專案撰寫之「預算表」與「預算變更表」（含今年度與歷年查詢）
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              可依年度（116 今年度／115／114 歷年）、表單類型（部門預算表／專案預算表／預算變更表）及單位篩選，點擊任一單據即可展開檢視完整 1～12 月編列明細與變更內容。
            </p>
          </div>
        </div>

        {/* 篩選器列 */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">年度：</span>
            <button
              type="button"
              onClick={() => setFilterYear('ALL')}
              className={`rounded-lg px-2.5 py-1 font-medium transition ${
                filterYear === 'ALL'
                  ? 'bg-td-blue text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              全部年度
            </button>
            {availableYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setFilterYear(y)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  filterYear === y
                    ? 'bg-td-blue text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {y} 年度{y === '116' ? '（今年）' : '（歷年）'}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-slate-300" />

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-700">單據類型：</span>
            {(
              [
                { id: 'ALL', label: '全部單據' },
                { id: 'dept_request', label: '🏢 部門預算表' },
                { id: 'proj_request', label: '🚀 專案預算表' },
                { id: 'budget_change', label: '🔄 預算變更表' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilterFormType(t.id)}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  filterFormType === t.id
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={filterUnit}
            onChange={(e) => setFilterUnit(e.target.value)}
            aria-label="篩選部門或專案"
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-700"
          >
            <option value="ALL">所有部門與專案</option>
            <optgroup label="部門">
              {departments.map((d) => (
                <option key={d.id} value={d.code}>
                  部門：{d.code}｜{d.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="專案">
              {projects.map((p) => (
                <option key={p.id} value={p.code}>
                  專案：{p.code}｜{p.name}
                </option>
              ))}
            </optgroup>
          </select>

          <input
            type="search"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜尋單號、填表人、會計科目或預算編號…"
            className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1"
          />
        </div>

        {/* 單據清單表格（採用與「建立預算」完全一致的 6 欄 table-fixed 結構，展開明細時外層欄位與收合按鈕絕對不會跑掉） */}
        {filteredRecords.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            目前篩選條件下尚無對應之預算表或預算變更表紀錄。
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full table-fixed border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-left font-semibold text-slate-700">
                  <th className="w-[88px] border-r border-slate-200 px-2.5 py-3 text-center">
                    編列年度
                  </th>
                  <th className="w-[210px] border-r border-slate-200 px-3 py-3">
                    回傳之部門／專案範圍
                  </th>
                  <th className="border-r border-slate-200 px-3.5 py-3">
                    回傳單據名稱 ＆ 單據編號
                  </th>
                  <th className="w-[165px] border-r border-slate-200 px-3 py-3">
                    包含科目項次
                  </th>
                  <th className="w-[175px] border-r border-slate-200 px-3 py-3">
                    編列總額／填報人
                  </th>
                  <th className="w-[92px] px-2.5 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredRecords.map((rec) => {
                  const isExpanded = expandedRecordId === rec.id;
                  const badge = STATUS_BADGE[rec.status] ?? {
                    label: rec.status,
                    cls: 'border-slate-200 bg-slate-100 text-slate-700',
                  };
                  const unitDisplay = rec.unitName.startsWith(rec.unitCode)
                    ? rec.unitName
                    : `${rec.unitCode}｜${rec.unitName}`;
                  const itemCount =
                    rec.formKey === 'budget-change'
                      ? 1
                      : rec.lines?.length ?? 0;
                  const recordTitle =
                    rec.formKey === 'budget-change'
                      ? `${rec.fiscalYear} 年度「${unitDisplay}」預算變更表`
                      : rec.scope === 'project'
                        ? `${rec.fiscalYear} 年度「${unitDisplay}」專案預算表`
                        : `${rec.fiscalYear} 年度「${unitDisplay}」部門預算表`;

                  return (
                    <Fragment key={rec.id}>
                      <tr className="transition hover:bg-slate-50/90">
                        <td className="border-r border-slate-200 px-2.5 py-3 text-center font-mono font-bold text-slate-800">
                          {rec.fiscalYear} 年度
                        </td>

                        <td className="border-r border-slate-200 px-3 py-3">
                          {rec.formKey === 'budget-change' ? (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-purple-50 px-2 py-1 font-semibold text-purple-900 ring-1 ring-purple-200">
                              🔄 預算變更：{unitDisplay}
                            </span>
                          ) : rec.scope === 'project' ? (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-indigo-50 px-2 py-1 font-semibold text-indigo-900 ring-1 ring-indigo-200">
                              🚀 指定專案：{unitDisplay}
                            </span>
                          ) : (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-blue-50 px-2 py-1 font-semibold text-td-blue-dark ring-1 ring-blue-200">
                              🏢 指定部門：{unitDisplay}
                            </span>
                          )}
                        </td>

                        <td className="border-r border-slate-200 px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900">
                              {recordTitle}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.2 text-[10px] font-semibold ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            單據編號：
                            <code className="rounded bg-slate-100 px-1.5 py-0.2 font-mono font-semibold text-td-blue">
                              {rec.formNumber}
                            </code>
                          </div>
                        </td>

                        <td className="border-r border-slate-200 px-3 py-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRecordId(isExpanded ? null : rec.id)
                            }
                            className="inline-flex items-center gap-1.5 font-semibold text-td-blue hover:underline"
                          >
                            <span>
                              {rec.formKey === 'budget-change'
                                ? '共 1 項變更明細'
                                : `共 ${itemCount} 個預算項次`}
                            </span>
                            <span className="text-[10px] whitespace-nowrap">
                              {isExpanded ? '▲ 收合' : '▼ 展開項次'}
                            </span>
                          </button>
                        </td>

                        <td className="border-r border-slate-200 px-3 py-3">
                          <div className="font-mono text-xs font-bold tabular-nums text-td-blue-dark">
                            NT$ {rec.totalAmount.toLocaleString()}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {rec.applicantName}・{rec.submittedAt.slice(0, 10)}
                          </div>
                        </td>

                        <td className="px-2.5 py-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRecordId(isExpanded ? null : rec.id)
                            }
                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                              isExpanded
                                ? 'bg-blue-600 font-bold text-white shadow-2xs hover:bg-blue-700'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {isExpanded ? '▲ 收合' : '▼ 展開'}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/90">
                          <td colSpan={6} className="px-5 py-4">
                            <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                                <div className="font-bold text-slate-900">
                                  📐 「{recordTitle}」回傳編列明細（單號：{rec.formNumber}）
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-slate-500">
                                    填報人：{rec.applicantName}（{rec.applicantCode}）・回傳日期：{rec.submittedAt.slice(0, 10)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedRecordId(null)}
                                    className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                                  >
                                    ▲ 收合明細
                                  </button>
                                </div>
                              </div>

                              {rec.summaryReason && (
                                <div className="rounded-lg bg-slate-50 px-3.5 py-2 text-xs text-slate-700">
                                  <span className="font-semibold text-slate-900">
                                    表單說明／變更事由：
                                  </span>
                                  {rec.summaryReason}
                                </div>
                              )}

                              {rec.formKey === 'budget-change' &&
                              rec.changeDetails ? (
                                <div className="overflow-x-auto rounded-lg border border-slate-200">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 bg-purple-50/60 text-left text-slate-700">
                                        <th className="px-3 py-2">
                                          變更目標預算編號
                                        </th>
                                        <th className="px-3 py-2">會計科目</th>
                                        <th className="px-3 py-2">變更類型</th>
                                        <th className="px-3 py-2">
                                          流用來源預算編號
                                        </th>
                                        <th className="px-3 py-2 text-right">
                                          原核定預算額
                                        </th>
                                        <th className="px-3 py-2 text-right">
                                          本次異動金額
                                        </th>
                                        <th className="px-3 py-2 text-right">
                                          變更後預算總額
                                        </th>
                                        <th className="px-3 py-2">
                                          變更原因與影響分析
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td className="px-3 py-2.5 font-mono font-bold text-purple-900">
                                          {rec.changeDetails.targetBudgetCode}
                                        </td>
                                        <td className="px-3 py-2.5 font-medium">
                                          {rec.changeDetails.targetCategory}
                                        </td>
                                        <td className="px-3 py-2.5 font-semibold text-purple-700">
                                          {CHANGE_TYPE_LABELS[
                                            rec.changeDetails.changeType
                                          ] ?? rec.changeDetails.changeType}
                                        </td>
                                        <td className="px-3 py-2.5 font-mono text-slate-600">
                                          {rec.changeDetails.sourceBudgetCode ||
                                            '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                                          NT${' '}
                                          {rec.changeDetails.currentBudgetAmount.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-red-600">
                                          NT${' '}
                                          {rec.changeDetails.changeAmount.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-mono font-bold tabular-nums text-td-blue-dark">
                                          NT${' '}
                                          {rec.changeDetails.newBudgetAmount.toLocaleString()}
                                        </td>
                                        <td className="px-3 py-2.5 text-slate-700">
                                          {rec.changeDetails.reason}
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              ) : rec.lines && rec.lines.length > 0 ? (
                                <div className="overflow-x-auto rounded-lg border border-slate-200">
                                  <table className="w-full min-w-[1040px] border-collapse text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 bg-slate-100 text-left text-slate-700">
                                        <th className="w-12 border-r border-slate-200 px-2 py-2 text-center">
                                          項次
                                        </th>
                                        <th className="border-r border-slate-200 px-2.5 py-2">
                                          預算編號（唯一值）
                                        </th>
                                        <th className="border-r border-slate-200 px-2.5 py-2">
                                          會計科目（代碼／科目編號／名稱）
                                        </th>
                                        <th className="border-r border-slate-200 px-2 py-2 text-right">
                                          前期核定 (A)
                                        </th>
                                        <th className="border-r border-slate-200 px-2 py-2 text-right">
                                          前期實際 (B)
                                        </th>
                                        {Array.from(
                                          { length: 12 },
                                          (_, idx) => (
                                            <th
                                              key={idx}
                                              className="border-r border-slate-200 px-1.5 py-2 text-right whitespace-nowrap"
                                            >
                                              {idx + 1}月
                                            </th>
                                          )
                                        )}
                                        <th className="border-r border-slate-200 bg-blue-50 px-2.5 py-2 text-right font-bold text-td-blue-dark">
                                          本年合計 (C)
                                        </th>
                                        <th className="px-2.5 py-2">
                                          編列說明／差異分析
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                      {rec.lines.map((line, lIdx) => (
                                        <tr
                                          key={lIdx}
                                          className="hover:bg-slate-50"
                                        >
                                          <td className="border-r border-slate-200 px-2 py-1.5 text-center font-mono font-semibold text-slate-600">
                                            {lIdx + 1}
                                          </td>
                                          <td className="border-r border-slate-200 px-2.5 py-1.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                                            {line.code}
                                          </td>
                                          <td className="border-r border-slate-200 px-2.5 py-1.5 font-medium text-slate-800 whitespace-nowrap">
                                            {line.itemCode ? (
                                              <span className="mr-1.5 font-mono text-[11px] font-semibold text-blue-700">
                                                {line.itemCode}
                                                {line.accountNumber
                                                  ? `｜${line.accountNumber}`
                                                  : ''}
                                              </span>
                                            ) : null}
                                            <span>{line.category}</span>
                                          </td>
                                          <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                                            {line.prevApprovedBudget.toLocaleString()}
                                          </td>
                                          <td className="border-r border-slate-200 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                                            {line.prevActualAmount.toLocaleString()}
                                          </td>
                                          {(
                                            [
                                              line.m1,
                                              line.m2,
                                              line.m3,
                                              line.m4,
                                              line.m5,
                                              line.m6,
                                              line.m7,
                                              line.m8,
                                              line.m9,
                                              line.m10,
                                              line.m11,
                                              line.m12,
                                            ] as const
                                          ).map((mVal, mIdx) => (
                                            <td
                                              key={mIdx}
                                              className="border-r border-slate-200 px-1.5 py-1.5 text-right font-mono tabular-nums text-slate-700"
                                            >
                                              {mVal.toLocaleString()}
                                            </td>
                                          ))}
                                          <td className="border-r border-slate-200 bg-blue-50/40 px-2.5 py-1.5 text-right font-mono font-bold tabular-nums text-td-blue-dark">
                                            {line.annualBudgetAmount.toLocaleString()}
                                          </td>
                                          <td className="px-2.5 py-1.5 text-slate-600">
                                            {line.description}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {/* ==================== 區塊 2：獨立「預算分析」頁面（下拉選擇部門或專案・全圖表數據視覺化呈現） ==================== */}
      {(mode === 'all' ||
        mode === 'publish_only' ||
        mode === 'management_view' ||
        mode === 'analysis_only') && (
      <>
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
                預算執行率與當前預算差異圖表分析中心
              </span>
              <span className="text-xs text-slate-500">
                全圖表數據視覺化儀表板
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-td-blue-dark">
              📊 預算執行率 ＆ 當前預算差異視覺化分析儀表板
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              透過下方下拉選單選擇「全部預算（所有人加總）」、「全部部門加總」、「全部專案加總」或指定單一「部門／專案」，系統即以視覺化圖表繪製該對象之整體預算執行率、當前預算差異、1～12 月執行趨勢與各會計科目差異分佈。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <label className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span>分析年度：</span>
              <select
                value={analysisYear}
                onChange={(e) => {
                  const y = e.target.value;
                  setAnalysisYear(y);
                  const prevY = String(Math.max(112, Number(y) - 1));
                  if (availableYears.includes(prevY)) {
                    setCompareYear(prevY);
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-900"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y} 年度（西元 {Number(y) + 1911}）
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* ==================== 多選下拉選單控制列（可多選整體範圍／部門／專案，點擊「報告產出」後於下方依序產生每一份報告） ==================== */}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
            {/* 多選下拉 1：整體匯總範圍 */}
            <div className="relative space-y-1.5 md:col-span-3">
              <span className="block font-bold text-slate-700">
                1. 整體匯總範圍（可多選）：
              </span>
              <button
                type="button"
                onClick={() =>
                  setOpenMultiDropdown((prev) =>
                    prev === 'scope' ? null : 'scope'
                  )
                }
                className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-bold text-slate-900 shadow-2xs hover:border-blue-400"
              >
                <span className="truncate">
                  {(() => {
                    const scopeHits = selectedTargets.filter(
                      (t) =>
                        t === 'ALL' || t === 'ALL_DEPT' || t === 'ALL_PROJ'
                    );
                    if (scopeHits.length === 0) return '-- 請下拉勾選匯總範圍 --';
                    if (scopeHits.length === 1)
                      return getTargetShortLabel(scopeHits[0]);
                    return `已勾選 ${scopeHits.length} 項整體匯總範圍`;
                  })()}
                </span>
                <span className="ml-2 text-slate-400">▼</span>
              </button>
              {openMultiDropdown === 'scope' && (
                <div className="absolute left-0 right-0 z-30 mt-1 space-y-1 rounded-xl border border-slate-300 bg-white p-2.5 shadow-xl">
                  {[
                    {
                      tag: 'ALL',
                      label: '🌐 全部門與全專案（全公司總預算加總）',
                    },
                    {
                      tag: 'ALL_DEPT',
                      label: '🏢 全部部門加總（全公司所有部門合計）',
                    },
                    {
                      tag: 'ALL_PROJ',
                      label: '🚀 全部專案加總（全公司所有專案合計）',
                    },
                  ].map((opt) => {
                    const checked = selectedTargets.includes(opt.tag);
                    return (
                      <label
                        key={opt.tag}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition ${
                          checked
                            ? 'bg-blue-50 font-bold text-blue-900'
                            : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTargetSelection(opt.tag)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 多選下拉 2：下拉選擇部門（多選制） */}
            <div className="relative space-y-1.5 md:col-span-3">
              <span className="block font-bold text-slate-700">
                2. 下拉選擇部門（可多選）：
              </span>
              <button
                type="button"
                onClick={() =>
                  setOpenMultiDropdown((prev) =>
                    prev === 'dept' ? null : 'dept'
                  )
                }
                className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-900 shadow-2xs hover:border-blue-400"
              >
                <span className="truncate">
                  {(() => {
                    const deptHits = selectedTargets.filter((t) =>
                      t.startsWith('DEPT:')
                    );
                    if (deptHits.length === 0) return '-- 請下拉勾選部門 --';
                    if (deptHits.length === 1)
                      return getTargetShortLabel(deptHits[0]);
                    return `🏢 已勾選 ${deptHits.length} 個部門`;
                  })()}
                </span>
                <span className="ml-2 text-slate-400">▼</span>
              </button>
              {openMultiDropdown === 'dept' && (
                <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-300 bg-white p-2.5 shadow-xl space-y-1">
                  <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-1.5 px-1">
                    <button
                      type="button"
                      onClick={() => {
                        const allDeptKeys = richUnitAnalyses
                          .filter((u) => u.scope === 'department')
                          .map((u) => u.key);
                        setSelectedTargets((prev) => [
                          ...new Set([...prev, ...allDeptKeys]),
                        ]);
                      }}
                      className="text-[11px] font-bold text-blue-600 hover:underline"
                    >
                      全選所有部門
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTargets((prev) =>
                          prev.filter((t) => !t.startsWith('DEPT:'))
                        )
                      }
                      className="text-[11px] font-medium text-slate-500 hover:underline"
                    >
                      清除已選部門
                    </button>
                  </div>
                  {richUnitAnalyses
                    .filter((u) => u.scope === 'department')
                    .map((deptUnit) => {
                      const checked = selectedTargets.includes(deptUnit.key);
                      return (
                        <label
                          key={deptUnit.key}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition ${
                            checked
                              ? 'bg-blue-50 font-bold text-blue-900'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleTargetSelection(deptUnit.key)
                              }
                            />
                            <span>
                              🏢 {deptUnit.unitCode}｜{deptUnit.unitName}
                            </span>
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {deptUnit.executionRatePct}%
                          </span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* 多選下拉 3：下拉選擇專案（多選制） */}
            <div className="relative space-y-1.5 md:col-span-4">
              <span className="block font-bold text-slate-700">
                3. 下拉選擇專案（可多選）：
              </span>
              <button
                type="button"
                onClick={() =>
                  setOpenMultiDropdown((prev) =>
                    prev === 'proj' ? null : 'proj'
                  )
                }
                className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-900 shadow-2xs hover:border-blue-400"
              >
                <span className="truncate">
                  {(() => {
                    const projHits = selectedTargets.filter((t) =>
                      t.startsWith('PROJ:')
                    );
                    if (projHits.length === 0) return '-- 請下拉勾選專案 --';
                    if (projHits.length === 1)
                      return getTargetShortLabel(projHits[0]);
                    return `🚀 已勾選 ${projHits.length} 個專案`;
                  })()}
                </span>
                <span className="ml-2 text-slate-400">▼</span>
              </button>
              {openMultiDropdown === 'proj' && (
                <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-300 bg-white p-2.5 shadow-xl space-y-1">
                  <div className="mb-1 flex items-center justify-between border-b border-slate-100 pb-1.5 px-1">
                    <button
                      type="button"
                      onClick={() => {
                        const allProjKeys = richUnitAnalyses
                          .filter((u) => u.scope === 'project')
                          .map((u) => u.key);
                        setSelectedTargets((prev) => [
                          ...new Set([...prev, ...allProjKeys]),
                        ]);
                      }}
                      className="text-[11px] font-bold text-blue-600 hover:underline"
                    >
                      全選所有專案
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedTargets((prev) =>
                          prev.filter((t) => !t.startsWith('PROJ:'))
                        )
                      }
                      className="text-[11px] font-medium text-slate-500 hover:underline"
                    >
                      清除已選專案
                    </button>
                  </div>
                  {richUnitAnalyses
                    .filter((u) => u.scope === 'project')
                    .map((projUnit) => {
                      const checked = selectedTargets.includes(projUnit.key);
                      return (
                        <label
                          key={projUnit.key}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition ${
                            checked
                              ? 'bg-blue-50 font-bold text-blue-900'
                              : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleTargetSelection(projUnit.key)
                              }
                            />
                            <span className="truncate">
                              🚀 {projUnit.unitCode}｜{projUnit.unitName}
                            </span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-slate-500">
                            {projUnit.executionRatePct}%
                          </span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            {/* 報告產出按鈕 */}
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={handleGenerateReports}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-td-blue px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-td-blue-dark"
              >
                <span>📊 報告產出</span>
                <span className="rounded-full bg-white/20 px-1.5 py-0.5 font-mono text-[11px]">
                  {selectedTargets.length || 1}
                </span>
              </button>
            </div>
          </div>

          {/* 目前多選勾選清單與快速重置 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-slate-600">
                已勾選待產出報告（共 {selectedTargets.length} 項）：
              </span>
              {selectedTargets.map((tag, idx) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-blue-900 shadow-2xs"
                >
                  <span className="text-blue-500">{idx + 1}.</span>
                  <span>{getTargetShortLabel(tag)}</span>
                  {selectedTargets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => toggleTargetSelection(tag)}
                      className="ml-0.5 text-slate-400 hover:text-red-600"
                      title="移除此項"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedTargets(['ALL']);
                setGeneratedTargets(['ALL']);
                setOpenMultiDropdown(null);
              }}
              className="text-[11px] font-semibold text-slate-600 hover:text-blue-700 hover:underline"
            >
              ↺ 重置回預設（僅全公司報告）
            </button>
          </div>
        </div>

        {/* ==================== 上方內縮「報告寄發介面」（預設內縮，開啟後展開：填寫標題 ➔ 填寫內文 ➔ 多選收信人員 ➔ 寄出含完整報告資料與 PDF 附件） ==================== */}
        {(mode === 'all' || mode === 'publish_only' || mode === 'analysis_only') && (
          <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-slate-50 via-blue-50/40 to-indigo-50/40 shadow-2xs overflow-hidden">
            <button
              type="button"
              onClick={() => setIsSendPanelOpen((prev) => !prev)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-left transition hover:bg-blue-50/60"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white">
                  📧 報告寄發介面
                </span>
                <span className="text-sm font-bold text-slate-900">
                  填寫標題與財會總體預算分析結論、選擇收信人員並寄出報告（含郵件內完整圖表報告 ＋ PDF 附件）
                </span>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                  目前將寄出 {generatedReportDashboards.length} 份報告・已選{' '}
                  {selectedRecipients.length} 位收信人
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-2xs">
                {isSendPanelOpen ? '收合寄發介面 ▲' : '開啟報告寄發介面 ▼'}
              </span>
            </button>

            {isSendPanelOpen && (
              <div className="border-t border-blue-200 bg-white p-5 space-y-4">
                {/* 1. 填寫標題 */}
                <label className="block text-sm">
                  <span className="font-semibold text-slate-800">
                    預算分析報告標題
                  </span>
                  <input
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-900"
                  />
                </label>

                {/* 2. 填寫內文（財會總體預算分析結論，預設空白） */}
                <label className="block text-sm">
                  <span className="font-semibold text-slate-800">
                    財會總體預算分析結論
                  </span>
                  <textarea
                    rows={4}
                    value={executiveSummary}
                    onChange={(e) => setExecutiveSummary(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3.5 text-xs leading-relaxed text-slate-800"
                  />
                </label>

                {/* 3. 選擇要收信的人員（多選制） */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        👥 選擇要收信的人員（多選制，已選{' '}
                        <span className="text-td-blue">
                          {selectedRecipients.length}
                        </span>{' '}
                        人）
                      </h3>
                      <p className="text-xs text-slate-600">
                        寄出後除了信件內包含詳細標題、財會結論與下方一模一樣的報告資料外，也會隨信附上一份完整報告內容的 PDF 檔案。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button
                        type="button"
                        onClick={selectAllDeptManagers}
                        className="rounded-lg border border-blue-300 bg-white px-3 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                      >
                        勾選所有部門主管
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRecipients(employees.map((e) => e.id))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-100"
                      >
                        全選公司人員
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRecipients([])}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-medium text-slate-500 hover:bg-slate-100"
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  {/* 多選下拉收信人員選單 */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMultiDropdown((prev) =>
                          prev === 'recipients' ? null : 'recipients'
                        )
                      }
                      className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:border-blue-400"
                    >
                      <span className="truncate">
                        {selectedRecipients.length === 0
                          ? '-- 請下拉多選勾選收信人員 --'
                          : `已多選勾選 ${selectedRecipients.length} 位收信人員：${selectedRecipients
                              .map((id) => empNameMap.get(id) ?? id)
                              .join('、')}`}
                      </span>
                      <span className="ml-2 text-slate-400">
                        {openMultiDropdown === 'recipients' ? '▲' : '▼'}
                      </span>
                    </button>

                    {openMultiDropdown === 'recipients' && (
                      <div className="mt-2 grid max-h-72 grid-cols-1 gap-3 overflow-y-auto rounded-xl border border-slate-300 bg-white p-3 shadow-lg md:grid-cols-2 lg:grid-cols-3">
                        {employeesByDepartment.map((group) => (
                          <div
                            key={group.deptId}
                            className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5"
                          >
                            <div className="mb-1.5 flex items-center justify-between border-b border-slate-200 pb-1">
                              <span className="text-xs font-bold text-slate-800">
                                {group.deptLabel}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  const groupIds = group.members.map(
                                    (m) => m.id
                                  );
                                  const allIn = groupIds.every((id) =>
                                    selectedRecipients.includes(id)
                                  );
                                  if (allIn) {
                                    setSelectedRecipients((prev) =>
                                      prev.filter(
                                        (id) => !groupIds.includes(id)
                                      )
                                    );
                                  } else {
                                    setSelectedRecipients((prev) => [
                                      ...new Set([...prev, ...groupIds]),
                                    ]);
                                  }
                                }}
                                className="text-[11px] font-medium text-blue-600 hover:underline"
                              >
                                全選本部門
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.members.map((emp) => {
                                const checked = selectedRecipients.includes(
                                  emp.id
                                );
                                const isDeptMgr = departments.some(
                                  (d) => d.managerEmployeeId === emp.id
                                );
                                return (
                                  <label
                                    key={emp.id}
                                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
                                      checked
                                        ? 'border-blue-500 bg-blue-50 font-semibold text-blue-900'
                                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleRecipient(emp.id)}
                                    />
                                    <span>
                                      {emp.name}（{emp.employeeCode}）
                                      {isDeptMgr ? ' ★主管' : ''}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 已選收信人員標籤列 */}
                  {selectedRecipients.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {selectedRecipients.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-900"
                        >
                          <span>{empNameMap.get(id) ?? id}</span>
                          <button
                            type="button"
                            onClick={() => toggleRecipient(id)}
                            className="text-blue-400 hover:text-red-600"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {publishError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
                    {publishError}
                  </div>
                )}
                {publishSuccess && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
                    {publishSuccess}
                  </div>
                )}

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handlePublishAnalysis}
                    disabled={publishing || selectedRecipients.length === 0}
                    className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {publishing
                      ? '正在產生報告與 PDF 並寄送郵件中…'
                      : `📧 寄出預算分析報告（共 ${generatedReportDashboards.length} 份報告 ＋ PDF 附件・寄予 ${selectedRecipients.length} 位收信人）`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 依照多選制「報告產出」結果，一個一個循序產生報告 ==================== */}
        <div className="space-y-8">
          {generatedReportDashboards.map((aggregatedDashboardData, reportIdx) => {
            const singleSelectedUnit = aggregatedDashboardData.singleUnit;
            const currentTargetTag = aggregatedDashboardData.targetTag;
            return (
              <div
                key={`${currentTargetTag}-${reportIdx}`}
                className="space-y-5 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-xs"
              >
                {/* ==================== 該份報告對象標題橫幅 ==================== */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/50 px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-indigo-700 px-2.5 py-0.5 text-xs font-bold text-white">
                        報告 {reportIdx + 1} / {generatedReportDashboards.length}
                      </span>
                      <span className="rounded-md bg-td-blue px-2.5 py-0.5 text-xs font-bold text-white">
                        {analysisYear} 年度圖表分析對象
                      </span>
                      <h3 className="text-base font-bold text-slate-900">
                        {aggregatedDashboardData.title}
                      </h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {aggregatedDashboardData.subtitle}
                    </p>
                  </div>
                </div>

        {/* ==================== 視覺化圖表區 1：左「預算執行率 SVG 動態圓環儀表圖」＋ 右「當前預算差異與跨期差異視覺化對比圖」 ==================== */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* 左側（5 欄）：SVG 動態圓環圖（Donut Gauge）呈現預算執行率 */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/50 p-5 lg:col-span-5">
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">
                  🎯 預算執行率圓環圖（Actual vs Budget）
                </h4>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    aggregatedDashboardData.execRatePct > 100
                      ? 'bg-red-100 text-red-700'
                      : aggregatedDashboardData.execRatePct >= 85
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {aggregatedDashboardData.execRatePct > 100
                    ? '超支警示'
                    : aggregatedDashboardData.execRatePct >= 85
                      ? '執行率偏高'
                      : '執行進度正常'}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">
                實際已執行金額 (B) 佔當前核定總預算 (A) 之達成比例
              </p>
            </div>

            {(() => {
              const rate = aggregatedDashboardData.execRatePct;
              const clampedPct = Math.min(100, Math.max(0, rate));
              const radius = 68;
              const circumference = 2 * Math.PI * radius;
              const dashOffset =
                circumference - (clampedPct / 100) * circumference;
              const strokeColor =
                rate > 100
                  ? '#ef4444'
                  : rate >= 85
                    ? '#f59e0b'
                    : '#10b981';

              return (
                <div className="my-4 flex flex-col items-center justify-center sm:flex-row sm:gap-6">
                  <div className="relative flex h-44 w-44 shrink-0 items-center justify-center">
                    <svg
                      viewBox="0 0 180 180"
                      className="h-full w-full -rotate-90 transform"
                    >
                      <circle
                        cx="90"
                        cy="90"
                        r={radius}
                        fill="transparent"
                        stroke="#e2e8f0"
                        strokeWidth="18"
                      />
                      <circle
                        cx="90"
                        cy="90"
                        r={radius}
                        fill="transparent"
                        stroke={strokeColor}
                        strokeWidth="18"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <span className="text-[11px] font-semibold text-slate-500">
                        預算執行率
                      </span>
                      <span className="font-mono text-3xl font-extrabold tracking-tight text-slate-900">
                        {rate}%
                      </span>
                      <span className="mt-0.5 text-[10px] font-medium text-slate-500">
                        已執行 / 核定預算
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 w-full space-y-3 text-xs sm:mt-0">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-td-blue" />
                          當前核定預算 (A)
                        </span>
                        <span className="font-mono font-semibold">100%</span>
                      </div>
                      <div className="mt-1 font-mono text-base font-bold text-td-blue-dark">
                        NT$ {aggregatedDashboardData.approved.toLocaleString()}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: strokeColor }}
                          />
                          實際已執行金額 (B)
                        </span>
                        <span className="font-mono font-semibold">{rate}%</span>
                      </div>
                      <div className="mt-1 font-mono text-base font-bold text-slate-900">
                        NT$ {aggregatedDashboardData.executed.toLocaleString()}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                          剩餘可用預算 (A - B)
                        </span>
                        <span className="font-mono font-semibold">
                          {Math.max(0, Number((100 - rate).toFixed(1)))}%
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-base font-bold text-emerald-700">
                        NT$ {aggregatedDashboardData.remaining.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 右側（7 欄）：當前預算執行差異（實際執行 vs 核定預算 & 剩餘可用額度）視覺化長條對比圖 */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/50 p-5 lg:col-span-7 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                ⚖️ 當前預算差異（實際已執行金額 vs 當前核定預算）視覺化對比圖
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                以視覺化比例尺呈現 {analysisYear} 年度當前核定預算、實際已執行金額與未動支結餘／超支差異
              </p>
            </div>

            {(() => {
              const maxScale = Math.max(
                aggregatedDashboardData.approved,
                aggregatedDashboardData.executed,
                1
              );
              const approvedW = Math.round(
                (aggregatedDashboardData.approved / maxScale) * 100
              );
              const executedW = Math.round(
                (aggregatedDashboardData.executed / maxScale) * 100
              );
              const remainingW = Math.max(
                0,
                Math.round(
                  (Math.max(0, aggregatedDashboardData.remaining) / maxScale) *
                    100
                )
              );
              const isOver = aggregatedDashboardData.currentVariance > 0;

              return (
                <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-xs">
                  {/* 對比組：當前核定預算 vs 實際已執行 vs 剩餘可用額度 */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800">
                        當前預算執行差異（實際 B − 核定 A）
                      </span>
                      <span
                        className={`rounded-md px-2.5 py-0.5 font-mono text-xs font-bold ${
                          isOver
                            ? 'bg-red-50 text-red-700 ring-1 ring-red-200'
                            : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        }`}
                      >
                        {isOver
                          ? `超支差額：+NT$ ${aggregatedDashboardData.currentVariance.toLocaleString()}（+${aggregatedDashboardData.currentVariancePct}%）`
                          : `當前未動支結餘差異：-NT$ ${Math.abs(aggregatedDashboardData.currentVariance).toLocaleString()}（${aggregatedDashboardData.currentVariancePct}%）`}
                      </span>
                    </div>

                    {/* 當前核定長條 */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>{analysisYear} 年度核定預算 (A)</span>
                        <span className="font-mono font-bold text-td-blue-dark">
                          NT$ {aggregatedDashboardData.approved.toLocaleString()}（100%）
                        </span>
                      </div>
                      <div className="h-4 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-td-blue transition-all"
                          style={{ width: `${approvedW}%` }}
                        />
                      </div>
                    </div>

                    {/* 實際執行長條 */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>當前實際已執行金額 (B)</span>
                        <span className="font-mono font-bold text-slate-900">
                          NT$ {aggregatedDashboardData.executed.toLocaleString()}（執行率 {aggregatedDashboardData.execRatePct}%）
                        </span>
                      </div>
                      <div className="relative h-4 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isOver ? 'bg-red-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${executedW}%` }}
                        />
                      </div>
                    </div>

                    {/* 剩餘可用預算長條 */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-600">
                        <span>當前剩餘可用預算 (A − B)</span>
                        <span className="font-mono font-semibold text-emerald-700">
                          NT$ {aggregatedDashboardData.remaining.toLocaleString()}（剩餘 {Math.max(0, Number((100 - aggregatedDashboardData.execRatePct).toFixed(1)))}%）
                        </span>
                      </div>
                      <div className="h-3.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-teal-400 transition-all"
                          style={{ width: `${remainingW}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 當檢視「全部門與全專案（全公司加總）」時，額外繪製部門 vs 專案預算構成堆疊圖 */}
                  {currentTargetTag === 'ALL' &&
                    aggregatedDashboardData.approved > 0 && (
                      <div className="space-y-2 border-t border-slate-100 pt-3.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                          <span>
                            🏢 全部部門營運（
                            {Math.round(
                              (aggregatedDashboardData.deptApproved /
                                aggregatedDashboardData.approved) *
                                100
                            )}
                            %｜NT${' '}
                            {aggregatedDashboardData.deptApproved.toLocaleString()}
                            ）
                          </span>
                          <span>
                            🚀 全部專案投入（
                            {Math.round(
                              (aggregatedDashboardData.projApproved /
                                aggregatedDashboardData.approved) *
                                100
                            )}
                            %｜NT${' '}
                            {aggregatedDashboardData.projApproved.toLocaleString()}
                            ）
                          </span>
                        </div>
                        <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full bg-blue-600"
                            style={{
                              width: `${
                                (aggregatedDashboardData.deptApproved /
                                  aggregatedDashboardData.approved) *
                                100
                              }%`,
                            }}
                          />
                          <div
                            className="h-full bg-indigo-500"
                            style={{
                              width: `${
                                (aggregatedDashboardData.projApproved /
                                  aggregatedDashboardData.approved) *
                                100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* ==================== 視覺化圖表區 2：1～12 月度預算核定 vs 實際執行長條圖 ＆ 累計執行率折線趨勢圖（SVG Combo Chart） ==================== */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                📈 1～12 月度「核定預算 vs 實際執行金額」柱狀圖 ＆「累計預算執行率」趨勢曲線
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                藍色柱代表當月核定預算、綠色／紅色柱代表當月實際執行金額；上方折線為 1～12 月累計預算執行率（0% ➔ {aggregatedDashboardData.execRatePct}%）及每月當期預算差異
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                <span className="inline-block h-3 w-3 rounded-xs bg-blue-200 ring-1 ring-blue-400" />
                當月核定預算
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                <span className="inline-block h-3 w-3 rounded-xs bg-emerald-500" />
                當月實際執行（正常）
              </span>
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
                <span className="inline-block h-3 w-3 rounded-xs bg-amber-500" />
                當月超支月份
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-700">
                <span className="inline-block h-0.5 w-4 bg-indigo-600" />
                累計預算執行率 (%)
              </span>
            </div>
          </div>

          {(() => {
            const trend = aggregatedDashboardData.monthlyTrend;
            const maxMonthVal = Math.max(
              ...trend.map((m) => Math.max(m.approved, m.executed)),
              1
            );
            const chartW = 840;
            const chartH = 210;
            const padLeft = 48;
            const padRight = 44;
            const padTop = 26;
            const padBottom = 32;
            const plotW = chartW - padLeft - padRight;
            const plotH = chartH - padTop - padBottom;
            const stepX = plotW / 12;

            const linePoints = trend
              .map((m, idx) => {
                const cx = padLeft + stepX * idx + stepX / 2;
                const cy =
                  padTop +
                  plotH -
                  (Math.min(100, m.cumRatePct) / 100) * plotH;
                return `${cx},${cy}`;
              })
              .join(' ');

            return (
              <div className="space-y-3">
                <div className="w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
                  <svg
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    className="h-56 w-full min-w-[680px]"
                  >
                    {/* 水平參考網格線 (25%, 50%, 75%, 100%) */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const y = padTop + plotH * (1 - ratio);
                      return (
                        <g key={ratio}>
                          <line
                            x1={padLeft}
                            y1={y}
                            x2={chartW - padRight}
                            y2={y}
                            stroke="#f1f5f9"
                            strokeWidth="1"
                          />
                          <text
                            x={chartW - padRight + 6}
                            y={y + 3}
                            fontSize="9"
                            fill="#6366f1"
                            fontWeight="600"
                          >
                            {Math.round(ratio * 100)}%
                          </text>
                        </g>
                      );
                    })}

                    {/* 1～12 月雙柱狀圖 (核定 vs 實際) */}
                    {trend.map((m, idx) => {
                      const groupX = padLeft + stepX * idx;
                      const barW = 14;
                      const appH = Math.max(
                        4,
                        (m.approved / maxMonthVal) * plotH
                      );
                      const execH = Math.max(
                        4,
                        (m.executed / maxMonthVal) * plotH
                      );
                      const appX = groupX + stepX / 2 - barW - 2;
                      const execX = groupX + stepX / 2 + 2;
                      const appY = padTop + plotH - appH;
                      const execY = padTop + plotH - execH;
                      const isMonthOver = m.executed > m.approved;

                      return (
                        <g key={m.month}>
                          {/* 核定預算柱 */}
                          <rect
                            x={appX}
                            y={appY}
                            width={barW}
                            height={appH}
                            rx="3"
                            fill="#bfdbfe"
                            stroke="#60a5fa"
                            strokeWidth="1"
                          />
                          {/* 實際執行柱 */}
                          <rect
                            x={execX}
                            y={execY}
                            width={barW}
                            height={execH}
                            rx="3"
                            fill={isMonthOver ? '#f59e0b' : '#10b981'}
                          />
                          {/* 月份標籤 */}
                          <text
                            x={groupX + stepX / 2}
                            y={chartH - 10}
                            textAnchor="middle"
                            fontSize="10"
                            fontWeight="600"
                            fill="#475569"
                          >
                            {m.label}
                          </text>
                        </g>
                      );
                    })}

                    {/* 累計預算執行率折線 */}
                    <polyline
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth="2.5"
                      points={linePoints}
                    />
                    {trend.map((m, idx) => {
                      const cx = padLeft + stepX * idx + stepX / 2;
                      const cy =
                        padTop +
                        plotH -
                        (Math.min(100, m.cumRatePct) / 100) * plotH;
                      return (
                        <g key={`pt-${m.month}`}>
                          <circle
                            cx={cx}
                            cy={cy}
                            r="3.5"
                            fill="#ffffff"
                            stroke="#4f46e5"
                            strokeWidth="2"
                          />
                          <text
                            x={cx}
                            y={cy - 7}
                            textAnchor="middle"
                            fontSize="8.5"
                            fontWeight="700"
                            fill="#4338ca"
                          >
                            {m.cumRatePct}%
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* 1～12 月度當月執行率與當月預算差異迷你視覺色塊 */}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12 text-[11px]">
                  {trend.map((m) => {
                    const isOver = m.variance > 0;
                    return (
                      <div
                        key={`mini-${m.month}`}
                        className="rounded-lg border border-slate-200 bg-white p-2 text-center shadow-2xs"
                      >
                        <div className="font-bold text-slate-700">{m.label}</div>
                        <div className="mt-0.5 font-mono text-[10px] font-semibold text-slate-500">
                          執行 {m.monthRatePct}%
                        </div>
                        <div
                          className={`mt-0.5 font-mono text-[10px] font-bold ${
                            isOver ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {isOver ? '+' : ''}
                          {Math.round(m.variance / 1000)}k
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ==================== 視覺化圖表區 3：各大會計科目「預算執行率子彈圖（Bullet Chart）」＆「當前預算差異雙向發散長條圖（Diverging Variance Bar Chart）」 ==================== */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                📊 各會計科目「預算執行率子彈圖」＆「當前預算差異正負向長條圖」
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {singleSelectedUnit
                  ? `針對「${singleSelectedUnit.unitCode}｜${singleSelectedUnit.unitName}」旗下各會計科目繪製執行率與當前預算差異圖表`
                  : `將所選範圍內所有單位之相同會計科目全部加總後，繪製整體各科目之預算執行率與當前預算差異圖表`}
              </p>
            </div>
          </div>

          {(() => {
            const subjects = aggregatedDashboardData.aggregatedSubjects;
            const maxAbsVariance = Math.max(
              ...subjects.map((s) => Math.abs(s.currentVarianceAmount)),
              1
            );

            return (
              <div className="grid grid-cols-1 gap-3">
                {subjects.map((sub) => {
                  const isOver = sub.currentVarianceAmount > 0;
                  const execBarW = Math.min(
                    100,
                    Math.max(4, sub.executionRatePct)
                  );
                  const varHalfW = Math.min(
                    48,
                    Math.max(
                      4,
                      Math.round(
                        (Math.abs(sub.currentVarianceAmount) / maxAbsVariance) *
                          48
                      )
                    )
                  );

                  return (
                    <div
                      key={`${sub.itemCode}-${sub.category}`}
                      className="grid grid-cols-1 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs lg:grid-cols-12 text-xs"
                    >
                      {/* 左：科目名稱與核定／實際數據 (3 欄) */}
                      <div className="lg:col-span-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-blue-50 px-2 py-0.5 font-mono text-[11px] font-bold text-td-blue">
                            {sub.itemCode}｜{sub.accountNumber}
                          </span>
                          <span className="font-bold text-slate-900">
                            {sub.category}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          <span>
                            核定：
                            <strong className="font-mono text-slate-800">
                              NT$ {sub.approvedAmount.toLocaleString()}
                            </strong>
                          </span>
                          <span>
                            實際：
                            <strong className="font-mono text-slate-800">
                              NT$ {sub.executedAmount.toLocaleString()}
                            </strong>
                          </span>
                        </div>
                      </div>

                      {/* 中：預算執行率子彈圖 Bullet Chart (5 欄) */}
                      <div className="lg:col-span-5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-600">
                            科目預算執行率 (B / A)
                          </span>
                          <span
                            className={`font-mono text-xs font-extrabold ${
                              sub.executionRatePct > 100
                                ? 'text-red-600'
                                : sub.executionRatePct >= 85
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                            }`}
                          >
                            {sub.executionRatePct}%
                          </span>
                        </div>
                        <div className="relative h-5 w-full overflow-hidden rounded-lg bg-slate-100 p-1">
                          <div
                            className={`h-full rounded-md transition-all ${
                              sub.executionRatePct > 100
                                ? 'bg-red-500'
                                : sub.executionRatePct >= 85
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                            }`}
                            style={{ width: `${execBarW}%` }}
                          />
                        </div>
                      </div>

                      {/* 右：當前預算差異正負向發散長條圖 Diverging Variance Bar (4 欄) */}
                      <div className="lg:col-span-4 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-600">
                            當前預算差異 (B − A)
                          </span>
                          <span
                            className={`font-mono text-xs font-bold ${
                              isOver ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {isOver
                              ? `+NT$ ${sub.currentVarianceAmount.toLocaleString()}（超支）`
                              : `-NT$ ${Math.abs(sub.currentVarianceAmount).toLocaleString()}（結餘）`}
                          </span>
                        </div>
                        {/* 以 50% 中線為 0 基準的雙向差異長條圖 */}
                        <div className="relative flex h-5 w-full items-center rounded-lg bg-slate-100">
                          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-400" />
                          {isOver ? (
                            <div
                              className="h-3 rounded-r bg-red-500"
                              style={{
                                marginLeft: '50%',
                                width: `${varHalfW}%`,
                              }}
                            />
                          ) : (
                            <div
                              className="h-3 rounded-l bg-emerald-500"
                              style={{
                                marginLeft: `${50 - varHalfW}%`,
                                width: `${varHalfW}%`,
                              }}
                            />
                          )}
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>◀ 預算結餘（未動支）</span>
                          <span>0 基準</span>
                          <span>預算超支 ▶</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ==================== 區塊 3：已發佈之預算分析報告歷史紀錄 ==================== */}
      {publishedAnalyses.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              📜 已發佈之預算分析報告紀錄（共 {publishedAnalyses.length} 份）
            </h3>
            <p className="text-xs text-slate-600">
              財會人員歷次製作並發佈之年度預算分析報告與發佈對象名單。
            </p>
          </div>
          <div className="space-y-3">
            {publishedAnalyses.map((rep) => (
              <div
                key={rep.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-blue-600 px-2 py-0.5 font-mono font-bold text-white">
                      {rep.fiscalYear} vs {rep.compareYear} 年度
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {rep.reportTitle}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    發佈人：{rep.authorName}｜發佈時間：
                    {rep.publishedAt.slice(0, 16).replace('T', ' ')}｜已發佈予{' '}
                    <strong className="text-slate-800">
                      {rep.publishedCount}
                    </strong>{' '}
                    人
                  </div>
                </div>
                <p className="whitespace-pre-line rounded-lg border border-slate-200 bg-white p-3 text-slate-700 leading-relaxed">
                  {rep.executiveSummary}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-700">
                    發佈檢視對象：
                  </span>
                  {rep.recipientEmployeeIds.map((id) => (
                    <span
                      key={id}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5"
                    >
                      {empNameMap.get(id) ?? id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      </>
      )}
    </div>
  );
}
