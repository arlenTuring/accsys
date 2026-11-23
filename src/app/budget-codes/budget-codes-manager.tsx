'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDialog } from '@/app/components/dialog';
import {
  batchGenerateStandardBudgetCodes,
  deleteBudgetCode,
  dispatchBudgetCompilationNotices,
  setBudgetCodeActive,
  upsertBudgetCode,
} from '@/lib/budget-codes/actions';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  STANDARD_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import {
  MultiSelectFilter,
  type MultiSelectOption,
} from '@/app/assets/multi-select-filter';
import {
  BudgetSheetsBuilder,
  formatBudgetCodeByConfig,
  type CodeFormatConfig,
  type CodeFormatPattern,
  type CodeSeparator,
} from './budget-sheets-builder';
import {
  BudgetAnalysisHub,
  type BudgetFormRecord,
  type PublishedAnalysisRecord,
} from './budget-analysis-hub';
import { BudgetPlanWorkspace } from './budget-plan-workspace';
import { ProjectManager } from './project-manager';

export type BudgetPlatformTab =
  | 'overview'
  | 'define'
  | 'management'
  | 'analysis'
  | 'dispatch'
  | 'projects';

export type DepartmentOption = {
  id: string;
  code: string;
  name: string;
  managerEmployeeId?: string | null;
};

export type EmployeeOption = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  role?: string;
  title?: string | null;
};

export type SupplierMasterItem = {
  id: string;
  name: string;
  shortName?: string | null;
  taxId?: string | null;
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
};

type FormState = {
  code: string;
  departmentCode: string;
  projectCode: string;
  category: string;
  itemCode: string;
  fiscalYear: string;
  annualBudgetAmount: string;
  ownerEmployeeCode: string;
};

const emptyForm: FormState = {
  code: '',
  departmentCode: '',
  projectCode: '',
  category: '',
  itemCode: '',
  fiscalYear: '116',
  annualBudgetAmount: '',
  ownerEmployeeCode: '',
};

function toFormState(item: BudgetCodeListItem): FormState {
  const std = findStandardAccountCategory(item.category);
  return {
    code: item.code,
    departmentCode: item.departmentCode ?? '',
    projectCode: item.projectCode ?? '',
    category: item.category,
    itemCode: std?.itemCode ?? '',
    fiscalYear: item.fiscalYear,
    annualBudgetAmount: item.annualBudgetAmount != null ? String(item.annualBudgetAmount) : '',
    ownerEmployeeCode: item.ownerEmployeeCode ?? '',
  };
}

export function BudgetCodesManager({
  budgetCodes,
  projects,
  departments = [],
  employees = [],
  suppliers = [],
  formRecords = [],
  publishedAnalyses = [],
  initialTab = 'overview',
}: {
  budgetCodes: BudgetCodeListItem[];
  projects: ProjectListItem[];
  departments?: DepartmentOption[];
  employees?: EmployeeOption[];
  suppliers?: SupplierMasterItem[];
  formRecords?: BudgetFormRecord[];
  publishedAnalyses?: PublishedAnalysisRecord[];
  initialTab?: BudgetPlatformTab;
}) {
  const router = useRouter();
  const formSectionRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTab] = useState<BudgetPlatformTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [overviewMode, setOverviewMode] = useState<'department_items' | 'flat_list'>(
    'department_items'
  );
  const [overviewUnitFilter, setOverviewUnitFilter] = useState<string>('ALL');

  // 頁籤 1「定義編輯」：建立預算編號組成格式與選擇單位範圍（與頁籤 2「編列設計」共用狀態）
  const [formatConfig, setFormatConfig] = useState<CodeFormatConfig>({
    pattern: 'YEAR_UNIT_ITEM',
    separator: '',
    prefix: '',
  });
  const [formatEditMode, setFormatEditMode] = useState<boolean>(false);
  const [sharedDeptCode, setSharedDeptCode] = useState<string>(
    () => departments[0]?.code ?? 'AD'
  );
  const [sharedProjCode, setSharedProjCode] = useState<string>(
    () => projects[0]?.code ?? ''
  );
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showStandardTable, setShowStandardTable] = useState(false);

  // Batch generator state (第 2 條：批次建立標準會計科目預算代號)
  const [batchYear, setBatchYear] = useState('116');
  const [batchDeptCode, setBatchDeptCode] = useState('');
  const [batchProjCode, setBatchProjCode] = useState('');
  const [batchOwnerCode, setBatchOwnerCode] = useState('');
  const [batchDefaultAmount, setBatchDefaultAmount] = useState('100000');
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchMessage, setBatchMessage] = useState<string | null>(null);

  // Budget Dispatcher state (第 7、8 條：預算表單設計與預算發送人系統)
  const [dispatchYear, setDispatchYear] = useState('116');
  const [dispatchDeadline, setDispatchDeadline] = useState('2026-12-15');
  const [dispatchTemplates, setDispatchTemplates] = useState<('department' | 'project' | 'variance')[]>([
    'department',
    'project',
    'variance',
  ]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>(() => {
    const managerIds = departments
      .map((d) => d.managerEmployeeId)
      .filter((id): id is string => Boolean(id));
    return [...new Set(managerIds)];
  });
  const [dispatchNote, setDispatchNote] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResultMsg, setDispatchResultMsg] = useState<string | null>(null);

  // Filter for existing budget codes table
  const [filterScopes, setFilterScopes] = useState<string[]>([]);
  const [filterScopeKeyword, setFilterScopeKeyword] = useState<string>('');
  const distinctYears = useMemo(
    () =>
      [...new Set(budgetCodes.map((b) => b.fiscalYear))].sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
          return nb - na;
        }
        return b.localeCompare(a, 'zh-TW');
      }),
    [budgetCodes]
  );
  const latestYear = distinctYears[0] ?? '115';
  const [filterYear, setFilterYear] = useState<string>(latestYear);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  const scopeFilterOptions = useMemo<MultiSelectOption[]>(() => {
    const opts: MultiSelectOption[] = [
      { value: 'DEPT', label: '僅部門預算' },
      { value: 'PROJ', label: '僅專案預算' },
    ];
    const seenDeptCodes = new Set<string>();
    for (const d of departments) {
      seenDeptCodes.add(d.code);
      opts.push({
        value: `DEPT:${d.code}`,
        label: `部門：${d.code}｜${d.name}`,
      });
    }
    for (const b of budgetCodes) {
      if (b.departmentCode && !seenDeptCodes.has(b.departmentCode)) {
        seenDeptCodes.add(b.departmentCode);
        opts.push({
          value: `DEPT:${b.departmentCode}`,
          label: `部門：${b.departmentCode}｜${b.departmentName ?? b.departmentCode}`,
        });
      }
    }

    const seenProjCodes = new Set<string>();
    for (const p of projects) {
      seenProjCodes.add(p.code);
      opts.push({
        value: `PROJ:${p.code}`,
        label: `專案：${p.code}｜${p.name}`,
      });
    }
    for (const b of budgetCodes) {
      if (b.projectCode && !seenProjCodes.has(b.projectCode)) {
        seenProjCodes.add(b.projectCode);
        opts.push({
          value: `PROJ:${b.projectCode}`,
          label: `專案：${b.projectCode}｜${b.projectName ?? b.projectCode}`,
        });
      }
    }
    return opts;
  }, [departments, projects, budgetCodes]);

  const filteredCodes = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    const scopeKw = filterScopeKeyword.trim().toLowerCase();
    const hasScopeSelected = filterScopes.length > 0;
    const hasScopeKw = scopeKw.length > 0;

    return budgetCodes.filter((b) => {
      if (filterYear !== 'ALL' && b.fiscalYear !== filterYear) return false;
      if (filterStatus === 'ACTIVE' && b.active === false) return false;
      if (filterStatus === 'INACTIVE' && b.active !== false) return false;

      if (hasScopeSelected || hasScopeKw) {
        const matchesSelected =
          hasScopeSelected &&
          filterScopes.some((sel) => {
            if (sel === 'DEPT') return Boolean(b.departmentName || b.departmentCode);
            if (sel === 'PROJ') return Boolean(b.projectName || b.projectCode);
            if (sel.startsWith('DEPT:')) return b.departmentCode === sel.slice(5);
            if (sel.startsWith('PROJ:')) return b.projectCode === sel.slice(5);
            return b.departmentCode === sel || b.projectCode === sel;
          });

        const scopeText = [
          b.departmentCode,
          b.departmentName,
          b.departmentName || b.departmentCode ? `部門：${b.departmentCode ?? ''}｜${b.departmentName ?? ''} 僅部門預算` : '',
          b.projectCode,
          b.projectName,
          b.projectName || b.projectCode ? `專案：${b.projectCode ?? ''}｜${b.projectName ?? ''} 僅專案預算` : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        const matchesKw = hasScopeKw && scopeText.includes(scopeKw);

        if (hasScopeSelected && !hasScopeKw && !matchesSelected) return false;
        if (!hasScopeSelected && hasScopeKw && !matchesKw) return false;
        if (hasScopeSelected && hasScopeKw && !matchesSelected && !matchesKw) return false;
      }

      if (kw) {
        const hay = [
          b.code,
          b.category,
          b.departmentCode,
          b.departmentName,
          b.projectCode,
          b.projectName,
          b.ownerName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    }).sort((a, b) => {
      const ya = Number(a.fiscalYear);
      const yb = Number(b.fiscalYear);
      if (Number.isFinite(ya) && Number.isFinite(yb) && ya !== yb) {
        return yb - ya;
      }
      const yearCmp = b.fiscalYear.localeCompare(a.fiscalYear, 'zh-TW');
      if (yearCmp !== 0) return yearCmp;
      return a.code.localeCompare(b.code, 'zh-TW');
    });
  }, [budgetCodes, filterScopes, filterScopeKeyword, filterYear, filterStatus, searchKeyword]);

  // 針對「所選年度（若選 ALL 則以最新年度作為指標基準）」計算對財會與管理層有實質決策意義的財務指標
  const stats = useMemo(() => {
    const focusYear = filterYear === 'ALL' ? latestYear : filterYear;
    const prevYearNum = Number(focusYear) - 1;
    const prevYear = Number.isFinite(prevYearNum) ? String(prevYearNum) : '';

    const yearCodes = budgetCodes.filter((b) => b.fiscalYear === focusYear);
    const activeYearCodes = yearCodes.filter((b) => b.active !== false);

    const deptCodes = activeYearCodes.filter((b) => Boolean(b.departmentName || b.departmentCode));
    const projCodes = activeYearCodes.filter((b) => Boolean(b.projectName || b.projectCode));

    const deptBudgetSum = Math.round(
      deptCodes.reduce((sum, b) => sum + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0), 0)
    );
    const projBudgetSum = Math.round(
      projCodes.reduce((sum, b) => sum + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0), 0)
    );
    const totalYearBudget = deptBudgetSum + projBudgetSum;

    // 計算上一年度總預算，提供跨年度 YoY 成長率對照
    const prevActiveCodes = prevYear
      ? budgetCodes.filter((b) => b.fiscalYear === prevYear && b.active !== false)
      : [];
    const prevTotalBudget = Math.round(
      prevActiveCodes.reduce(
        (sum, b) => sum + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0),
        0
      )
    );
    const yoyDiff = prevTotalBudget > 0 ? totalYearBudget - prevTotalBudget : null;
    const yoyPct =
      prevTotalBudget > 0
        ? (((totalYearBudget - prevTotalBudget) / prevTotalBudget) * 100).toFixed(1)
        : null;

    // 部門與專案涵蓋率（該年度已編列預算的部門數 / 全公司活躍部門數）
    const coveredDeptSet = new Set(deptCodes.map((b) => b.departmentCode).filter(Boolean));
    const coveredProjSet = new Set(projCodes.map((b) => b.projectCode).filter(Boolean));

    // 治理與動支檢核指標：0 元待補額度科目、未指派負責人科目、已被單據動支引用科目
    const zeroAmountCount = activeYearCodes.filter(
      (b) => !b.annualBudgetAmount || b.annualBudgetAmount <= 0
    ).length;
    const unassignedOwnerCount = activeYearCodes.filter((b) => !b.ownerEmployeeCode).length;
    const utilizedCodeCount = activeYearCodes.filter((b) => (b.usageCount ?? 0) > 0).length;
    const totalUsageRefs = activeYearCodes.reduce((s, b) => s + (b.usageCount ?? 0), 0);

    const deptRatioPct =
      totalYearBudget > 0 ? Math.round((deptBudgetSum / totalYearBudget) * 100) : 0;
    const projRatioPct = totalYearBudget > 0 ? 100 - deptRatioPct : 0;

    return {
      focusYear,
      prevYear,
      totalYearBudget,
      prevTotalBudget,
      yoyDiff,
      yoyPct,
      deptBudgetSum,
      projBudgetSum,
      deptRatioPct,
      projRatioPct,
      deptCodeCount: deptCodes.length,
      projCodeCount: projCodes.length,
      coveredDeptCount: coveredDeptSet.size,
      totalDeptCount: departments.length,
      coveredProjCount: coveredProjSet.size,
      totalProjCount: projects.length,
      activeYearCount: activeYearCodes.length,
      totalYearCount: yearCodes.length,
      zeroAmountCount,
      unassignedOwnerCount,
      utilizedCodeCount,
      totalUsageRefs,
    };
  }, [budgetCodes, filterYear, latestYear, departments.length, projects.length]);

  const switchTab = (tab: BudgetPlatformTab) => {
    setError(null);
    setSaveSuccessMsg(null);
    setActiveTab(tab);
  };

  const onEdit = (item: BudgetCodeListItem) => {
    setError(null);
    setSaveSuccessMsg(null);
    setForm(toFormState(item));
    setEditingCode(item.code);
    setActiveTab('overview');
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const onCancelEdit = () => {
    setError(null);
    setSaveSuccessMsg(null);
    setForm(emptyForm);
    setEditingCode(null);
  };

  const applyAutoCode = (next: FormState): FormState => {
    if (editingCode) return next;
    const unitCode = next.departmentCode || next.projectCode;
    if (unitCode && next.itemCode && next.fiscalYear) {
      return {
        ...next,
        code: buildStandardBudgetCode({
          fiscalYear: next.fiscalYear,
          unitCode,
          itemCode: next.itemCode,
        }),
      };
    }
    return next;
  };

  // 依部門分組的公司人員清單（供專案預算選擇負責人下拉選單使用）
  const employeesByDepartment = useMemo(() => {
    const groups: { deptId: string; deptLabel: string; members: EmployeeOption[] }[] = [];
    const assignedIds = new Set<string>();
    for (const d of departments) {
      const members = employees.filter((e) => e.departmentId === d.id);
      if (members.length > 0) {
        members.forEach((m) => assignedIds.add(m.id));
        groups.push({
          deptId: d.id,
          deptLabel: `${d.code}｜${d.name}`,
          members,
        });
      }
    }
    const unassigned = employees.filter((e) => !assignedIds.has(e.id));
    if (unassigned.length > 0) {
      groups.push({
        deptId: 'other',
        deptLabel: '其他部門',
        members: unassigned,
      });
    }
    return groups;
  }, [departments, employees]);

  const formatProjectOptionLabel = (p: ProjectListItem) => {
    const cleanName = p.name.startsWith(p.code)
      ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
      : p.name;
    return cleanName ? `${p.code}｜${cleanName}` : p.code;
  };

  // 即時檢查預算編號是否與現有編號衝突（新增模式不可重複、編輯模式改名不可與既有其他編號重複）
  const duplicateCodeItem = useMemo(() => {
    const target = form.code.trim().toUpperCase();
    if (!target) return null;
    return (
      budgetCodes.find(
        (b) =>
          b.code.trim().toUpperCase() === target &&
          (!editingCode || b.code.trim().toUpperCase() !== editingCode.trim().toUpperCase())
      ) ?? null
    );
  }, [budgetCodes, form.code, editingCode]);

  const onSubmit = async () => {
    setError(null);
    setSaveSuccessMsg(null);
    const trimmedCode = form.code.trim();
    if (!trimmedCode) {
      setError('預算編號為必填（且必須為唯一值）');
      return;
    }
    if (duplicateCodeItem) {
      const unitLabel =
        duplicateCodeItem.departmentName || duplicateCodeItem.projectName || '未指定單位';
      setError(
        `預算編號「${trimmedCode}」已存在（${unitLabel}｜${duplicateCodeItem.category}），預算編號必須為唯一值，請勿重複建立！`
      );
      return;
    }
    const trimmedAmount = form.annualBudgetAmount.trim();
    const numericAmount = trimmedAmount === '' ? NaN : Number(trimmedAmount);
    if (Number.isFinite(numericAmount) && numericAmount < 0) {
      setError(
        `預算編號「${trimmedCode || '（未填）'}」的「年度預算金額」不可為負數（目前輸入：${numericAmount.toLocaleString()}），請修改為正數`
      );
      return;
    }
    setSaving(true);
    const savedCode = trimmedCode;
    const wasEditing = Boolean(editingCode);
    const result = await upsertBudgetCode({
      code: trimmedCode,
      departmentCode: form.departmentCode || null,
      projectCode: form.projectCode || null,
      category: form.category,
      fiscalYear: form.fiscalYear,
      annualBudgetAmount: numericAmount,
      ownerEmployeeCode: form.projectCode ? form.ownerEmployeeCode || null : null,
      mode: editingCode ? 'update' : 'create',
      editingCode: editingCode ?? null,
    });
    setSaving(false);
    if (result.ok) {
      setForm(emptyForm);
      setEditingCode(null);
      setSaveSuccessMsg(`已成功${wasEditing ? '更新' : '建立'}預算編號「${savedCode}」！`);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onBatchGenerate = async () => {
    setError(null);
    setBatchMessage(null);
    setBatchGenerating(true);
    const res = await batchGenerateStandardBudgetCodes({
      fiscalYear: batchYear,
      departmentCode: batchDeptCode || null,
      projectCode: batchProjCode || null,
      ownerEmployeeCode: batchProjCode ? batchOwnerCode || null : null,
      defaultAmount: Number(batchDefaultAmount),
    });
    setBatchGenerating(false);
    if (res.ok) {
      const skippedNote =
        res.skippedCount && res.skippedCount > 0
          ? `（另有 ${res.skippedCount} 筆已存在之預算編號自動略過，不重複建立）`
          : '';
      setBatchMessage(
        `已成功為「${batchDeptCode || batchProjCode}」建立 ${res.createdOrUpdatedCount} 筆標準會計科目預算編號${skippedNote}！`
      );
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  const onDispatchNotices = async () => {
    setError(null);
    setDispatchResultMsg(null);
    setDispatching(true);
    const res = await dispatchBudgetCompilationNotices({
      fiscalYear: dispatchYear,
      deadlineDate: dispatchDeadline,
      recipientEmployeeIds: selectedRecipients,
      templateTypes: dispatchTemplates,
      customNote: dispatchNote,
    });
    setDispatching(false);
    if (res.ok) {
      setDispatchResultMsg(
        `已成功發送 ${res.sentCount} 則「${dispatchYear} 年度預算編列通知」予指定部門主管／預算負責人！`
      );
    } else {
      setError(res.error);
    }
  };

  const onDelete = async (item: BudgetCodeListItem) => {
    const unitInfo = item.departmentName
      ? `部門：${item.departmentCode ? `${item.departmentCode}｜` : ''}${item.departmentName}`
      : item.projectName
        ? `專案：${item.projectCode ? `${item.projectCode}｜` : ''}${item.projectName}`
        : '—';
    const amountInfo =
      item.annualBudgetAmount != null ? `NT$ ${item.annualBudgetAmount.toLocaleString()}` : '—';

    const ok = await confirmDialog({
      title: `是否刪除預算編號「${item.code}」？`,
      message: [
        `預算編號：${item.code}`,
        `${unitInfo}`,
        `會計科目：${item.category}（${item.fiscalYear} 年度）`,
        `預算金額：${amountInfo}`,
        `負責人：${item.ownerName ?? '未指定'}`,
        '',
        '刪除後無法復原，確定要永久刪除此筆已停用的預算編號嗎？',
      ].join('\n'),
      confirmLabel: '確認刪除',
      cancelLabel: '取消',
      tone: 'danger',
    });
    if (!ok) return;

    setError(null);
    setDeletingId(item.id);
    const result = await deleteBudgetCode(item.id);
    setDeletingId(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  const onToggleActive = async (item: BudgetCodeListItem) => {
    setError(null);
    setTogglingId(item.id);
    const result = await setBudgetCodeActive(item.id, !item.active);
    setTogglingId(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  const toggleTemplateType = (t: 'department' | 'project' | 'variance') => {
    setDispatchTemplates((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const toggleRecipient = (empId: string) => {
    setSelectedRecipients((prev) =>
      prev.includes(empId) ? prev.filter((id) => id !== empId) : [...prev, empId]
    );
  };

  const navItems: {
    id: BudgetPlatformTab;
    title: string;
    subtitle: string;
    badge?: string | number;
  }[] = [
    {
      id: 'projects',
      title: '主檔管理',
      subtitle: '產品專案與營收專案主檔設定',
      badge: projects.length,
    },
    {
      id: 'overview',
      title: '建立預算',
      subtitle:
        '預算規劃表清單（全公司統一的部門／指定部門／指定專案）・單筆寄送・兩步驟新增預算規劃（1. 定義預算代碼格式 ➔ 2. 預算代碼組合編列）',
      badge: budgetCodes.length,
    },
    {
      id: 'define',
      title: '建立預算',
      subtitle:
        '預算規劃表清單（全公司統一的部門／指定部門／指定專案）・單筆寄送・兩步驟新增預算規劃（1. 定義預算代碼格式 ➔ 2. 預算代碼組合編列）',
    },
    {
      id: 'dispatch',
      title: '建立預算',
      subtitle:
        '預算規劃表清單（全公司統一的部門／指定部門／指定專案）・單筆寄送・兩步驟新增預算規劃（1. 定義預算代碼格式 ➔ 2. 預算代碼組合編列）',
    },
    {
      id: 'management',
      title: '預算管理',
      subtitle: '各部門及各專案撰寫回傳之預算表與預算變更表清單查詢（含今年度與歷年 1～12 月編列明細）',
      badge: formRecords.length,
    },
    {
      id: 'analysis',
      title: '預算分析',
      subtitle:
        '各部門與各專案預算執行率・當前預算差異對照・標籤切換檢視全部門／全專案或指定部門／指定專案差異明細＆派發分析報告',
    },
  ];

  const currentPageMeta =
    navItems.find((item) => item.id === activeTab) ?? navItems[0]!;

  return (
    <div className="space-y-6">
      {/* 獨立頁面頁首（由左側「預算管理平台」子選單進入各獨立頁面） */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
              財會管理 · 預算管理平台
            </span>
            <span className="text-xs text-slate-400">Budget Management Platform</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-td-blue-dark">
            {currentPageMeta.title}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {currentPageMeta.subtitle}
          </p>
        </div>
      </div>

      {/* 全域錯誤或成功提示 */}
      {error && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-4 text-xs font-medium text-red-600 underline"
          >
            關閉
          </button>
        </div>
      )}
      {saveSuccessMsg && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{saveSuccessMsg}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSaveSuccessMsg(null)}
              className="text-xs text-emerald-700 underline"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      {/* ==================== 頁面 1：建立預算（預算規劃清單 + 單筆按下發布跳出對話框 + 新增預算規劃兩步驟順序對話框） ==================== */}
      {(activeTab === 'overview' ||
        activeTab === 'define' ||
        activeTab === 'dispatch') && (
        <BudgetPlanWorkspace
          budgetCodes={budgetCodes}
          departments={departments}
          projects={projects.filter((p) => p.active !== false)}
          employees={employees}
          employeesByDepartment={employeesByDepartment}
        />
      )}

      {(activeTab as string) === 'legacy_overview' && (
        <div className="space-y-6">
          {/* 區塊 A：建立預算編號組成格式與選擇單位範圍（圖 2 功能） */}
          {(() => {
            const activeFy = filterYear === 'ALL' ? latestYear : filterYear;
            const currentUnitCode = overviewUnitFilter.startsWith('PROJ:')
              ? overviewUnitFilter.slice(5)
              : overviewUnitFilter.startsWith('DEPT:')
                ? overviewUnitFilter.slice(5)
                : sharedDeptCode || departments[0]?.code || 'AD';
            const examplePreviewCode =
              formatBudgetCodeByConfig({
                format: formatConfig,
                fiscalYear: activeFy,
                unitCode: currentUnitCode,
                itemCode: 'SE01',
                seqIndex: 0,
              }) || `${activeFy}ADSE01`;

            return (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-td-blue text-xs font-bold text-white">
                      1
                    </span>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        建立預算編號組成格式與選擇單位範圍
                      </h2>
                      <p className="text-xs text-slate-500">
                        設定全公司預算編號唯一值自動產生規則與檢視範圍，下方即顯示目前製作出來的預算項次名目。
                      </p>
                    </div>
                  </div>
                </div>

                {/* 編號組成格式設定區 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1.5 text-xs">
                        <div className="font-semibold text-slate-700">
                          目前預算編號組成格式（唯一值自動產生規則）：
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-800">
                            {formatConfig.prefix ? `${formatConfig.prefix} + ` : ''}
                            {formatConfig.pattern === 'YEAR_UNIT_ITEM' &&
                              `[年度(${activeFy})] ${formatConfig.separator} [單位(${currentUnitCode})] ${formatConfig.separator} [科目代碼(SE01~SE99)]`}
                            {formatConfig.pattern === 'YEAR_UNIT_ITEM_SEQ' &&
                              `[年度(${activeFy})] ${formatConfig.separator} [單位(${currentUnitCode})] ${formatConfig.separator} [科目代碼] ${formatConfig.separator} [項次序號(01~99)]`}
                            {formatConfig.pattern === 'YEAR_UNIT_SEQ' &&
                              `[年度(${activeFy})] ${formatConfig.separator} [單位(${currentUnitCode})] ${formatConfig.separator} [項次序號(01~99)]`}
                            {formatConfig.pattern === 'UNIT_YEAR_ITEM' &&
                              `[單位(${currentUnitCode})] ${formatConfig.separator} [年度(${activeFy})] ${formatConfig.separator} [科目代碼(SE01~SE99)]`}
                          </span>
                          <span className="text-slate-500">➡️ 自動生成範例：</span>
                          <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 font-mono text-sm font-bold text-td-blue-dark">
                            {examplePreviewCode}
                          </span>
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            ✓ 依會計科目自動生成唯一值（不重複）
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setFormatEditMode((v) => !v)}
                        className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                      >
                        {formatEditMode
                          ? '✓ 完成格式設定'
                          : '✏️ 更動編號組成格式／編輯項次'}
                      </button>
                    </div>

                    {formatEditMode && (
                      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3.5 text-xs sm:grid-cols-3">
                        <label className="block">
                          <span className="font-semibold text-slate-700">
                            編號組成結構（更動後下方全表立即更新）
                          </span>
                          <select
                            value={formatConfig.pattern}
                            onChange={(e) =>
                              setFormatConfig((prev) => ({
                                ...prev,
                                pattern: e.target.value as CodeFormatPattern,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800"
                          >
                            <option value="YEAR_UNIT_ITEM">
                              年度 + 部門/專案代碼 + 會計科目代碼（如 116ADSE01）
                            </option>
                            <option value="YEAR_UNIT_ITEM_SEQ">
                              年度 + 部門/專案代碼 + 會計科目代碼 + 項次序號（如 116ADSE0101）
                            </option>
                            <option value="YEAR_UNIT_SEQ">
                              年度 + 部門/專案代碼 + 項次序號（如 116AD01）
                            </option>
                            <option value="UNIT_YEAR_ITEM">
                              部門/專案代碼 + 年度 + 會計科目代碼（如 AD116SE01）
                            </option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="font-semibold text-slate-700">
                            區段分隔符號
                          </span>
                          <select
                            value={formatConfig.separator}
                            onChange={(e) =>
                              setFormatConfig((prev) => ({
                                ...prev,
                                separator: e.target.value as CodeSeparator,
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-800"
                          >
                            <option value="">無分隔符（如 116ADSE01）</option>
                            <option value="-">連字號 -（如 116-AD-SE01）</option>
                            <option value="_">底線 _（如 116_AD_SE01）</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="font-semibold text-slate-700">
                            自訂編號前綴（選填）
                          </span>
                          <input
                            value={formatConfig.prefix}
                            onChange={(e) =>
                              setFormatConfig((prev) => ({
                                ...prev,
                                prefix: e.target.value.replace(/\s+/g, ''),
                              }))
                            }
                            placeholder="留空或輸入如 BG"
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {/* 預算年度與部門／專案單位範圍選擇 */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block text-xs">
                      <span className="font-semibold text-slate-700">
                        預算年度（民國年，如 116）
                      </span>
                      <input
                        value={filterYear === 'ALL' ? latestYear : filterYear}
                        onChange={(e) => setFilterYear(e.target.value || '116')}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold"
                      />
                    </label>

                    <label className="block text-xs">
                      <span className="font-semibold text-slate-700">
                        平行展開單位範圍（部門／專案）
                      </span>
                      <select
                        value={overviewUnitFilter}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOverviewUnitFilter(val);
                          if (val.startsWith('DEPT:')) {
                            setSharedDeptCode(val.slice(5));
                          } else if (val.startsWith('PROJ:')) {
                            setSharedProjCode(val.slice(5));
                          }
                        }}
                        aria-label="部門代碼／部門名稱"
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
                      >
                        <option value="ALL">
                          🏢 全部部門平行展開（共 {departments.length} 個部門橫向展開）
                        </option>
                        <option value="ALL_PROJ">
                          🚀 全部專案平行展開（共 {projects.length} 個專案橫向展開）
                        </option>
                        <optgroup label="單一部門展開">
                          {departments.map((d) => (
                            <option key={d.id} value={`DEPT:${d.code}`}>
                              {d.code}｜{d.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="單一專案展開">
                          {projects.map((p) => (
                            <option key={p.id} value={`PROJ:${p.code}`}>
                              {formatProjectOptionLabel(p)}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </label>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* 若使用者點擊單筆「編輯」，在此處顯示單筆預算編號定義編輯區（不含金額數據） */}
          {editingCode && (
            <section
              ref={formSectionRef}
              className="rounded-xl border border-blue-400 bg-blue-50/50 p-6 shadow-sm space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-td-blue-dark">
                    編輯預算編號定義：{editingCode}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    修改此預算項次之唯一編號或預算項次名目（類別名稱）。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  ✕ 取消編輯
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">年度（民國年，如 116）</span>
                  <input
                    value={form.fiscalYear}
                    onChange={(e) => setForm(applyAutoCode({ ...form, fiscalYear: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-medium text-slate-700">類別（預算項次名目）</span>
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                  />
                </label>
                <label className="block text-sm">
                  <span className="flex items-center justify-between font-medium text-slate-700">
                    <span>預算編號</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">
                      必填・唯一值
                    </span>
                  </span>
                  <input
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono"
                  />
                </label>
              </div>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '儲存中…' : '儲存變更'}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
              </div>
            </section>
          )}

          {/* 區塊 B：定義好的預算項次名目平行展開表（純結構定義與唯一編號平行展開，不顯示金額數據） */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {overviewMode === 'department_items'
                    ? `預算項次名目定義・各單位平行展開對照表（${filterYear === 'ALL' ? latestYear : filterYear} 年度）`
                    : `已建檔預算編號定義清冊（共 ${budgetCodes.length} 筆，目前顯示 ${filteredCodes.length} 筆）`}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {overviewMode === 'department_items'
                    ? '呈現定義好的每一個預算項次名目（科目代碼、會計科目編號、科目名稱）如何依上方編號組成格式在各部門或各專案下平行展開成唯一預算編號。'
                    : '檢視目前已建檔之預算編號、所屬部門／專案與會計科目定義（不顯示金額數據；金額與分析請至「頁籤 4：預算管理」查閱）。'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setOverviewMode('department_items')}
                    className={`rounded-md px-3 py-1.5 transition ${
                      overviewMode === 'department_items'
                        ? 'bg-white text-td-blue shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📐 預算項次名目平行展開表
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverviewMode('flat_list')}
                    className={`rounded-md px-3 py-1.5 transition ${
                      overviewMode === 'flat_list'
                        ? 'bg-white text-td-blue shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    📋 已建檔編號定義清單
                  </button>
                </div>
              </div>
            </div>

          {overviewMode === 'department_items' ? (
            <div className="space-y-4">
              {/* 平行展開範圍快速切換列 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-700 mr-1">平行展開範圍：</span>
                  <button
                    type="button"
                    onClick={() => setOverviewUnitFilter('ALL')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      overviewUnitFilter === 'ALL'
                        ? 'bg-td-blue text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    🏢 全部部門平行展開（{departments.length} 部門）
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverviewUnitFilter('ALL_PROJ')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      overviewUnitFilter === 'ALL_PROJ'
                        ? 'bg-td-blue text-white'
                        : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    🚀 全部專案平行展開（{projects.length} 專案）
                  </button>
                  {departments.map((d) => {
                    const val = `DEPT:${d.code}`;
                    const isSel =
                      overviewUnitFilter === val || overviewUnitFilter === d.code;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setOverviewUnitFilter(val)}
                        className={`rounded-lg px-2.5 py-1 font-medium transition ${
                          isSel
                            ? 'bg-td-blue text-white'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {d.code}｜{d.name}
                      </button>
                    );
                  })}
                </div>

                <input
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  placeholder="篩選科目代碼、科目名稱或預算編號…"
                  className="w-60 rounded-lg border border-slate-300 bg-white px-3 py-1.5"
                />
              </div>

              {/* 平行展開矩陣表格：左側為定義好的預算項次名目，右側橫向平行展開各部門／各專案之唯一預算編號（完全不含金額欄位） */}
              {(() => {
                const targetFy = filterYear === 'ALL' ? latestYear : filterYear;
                const kw = searchKeyword.trim().toLowerCase();

                type UnitSpec = {
                  scope: 'department' | 'project';
                  code: string;
                  name: string;
                };
                const unitsToRender: UnitSpec[] = [];

                if (overviewUnitFilter === 'ALL') {
                  for (const d of departments) {
                    unitsToRender.push({
                      scope: 'department',
                      code: d.code,
                      name: d.name,
                    });
                  }
                } else if (overviewUnitFilter === 'ALL_PROJ') {
                  for (const p of projects) {
                    const cleanName = p.name.startsWith(p.code)
                      ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
                      : p.name;
                    unitsToRender.push({
                      scope: 'project',
                      code: p.code,
                      name: cleanName || p.code,
                    });
                  }
                } else if (overviewUnitFilter.startsWith('PROJ:')) {
                  const pCode = overviewUnitFilter.slice(5);
                  const p = projects.find((x) => x.code === pCode) as
                    | ProjectListItem
                    | undefined;
                  if (p) {
                    const cleanName = p.name.startsWith(p.code)
                      ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
                      : p.name;
                    unitsToRender.push({
                      scope: 'project',
                      code: p.code,
                      name: cleanName || p.code,
                    });
                  }
                } else {
                  const dCode = overviewUnitFilter.startsWith('DEPT:')
                    ? overviewUnitFilter.slice(5)
                    : overviewUnitFilter;
                  const d =
                    departments.find((x) => x.code === dCode) ?? departments[0];
                  if (d) {
                    unitsToRender.push({
                      scope: 'department',
                      code: d.code,
                      name: d.name,
                    });
                  }
                }

                const isProjectScope =
                  overviewUnitFilter === 'ALL_PROJ' ||
                  overviewUnitFilter.startsWith('PROJ:');
                const categoryPool = isProjectScope
                  ? PROJECT_ACCOUNT_CATEGORIES
                  : DEPARTMENT_ACCOUNT_CATEGORIES;

                const filteredPool = categoryPool
                  .map((cat, idx) => {
                    const expandedCodes = unitsToRender.map((u) => {
                      const code = formatBudgetCodeByConfig({
                        format: formatConfig,
                        fiscalYear: targetFy,
                        unitCode: u.code,
                        itemCode: cat.itemCode,
                        seqIndex: idx,
                      });
                      return {
                        unitCode: u.code,
                        unitName: u.name,
                        scope: u.scope,
                        code,
                      };
                    });
                    return {
                      seq: idx + 1,
                      ...cat,
                      expandedCodes,
                    };
                  })
                  .filter((row) => {
                    if (!kw) return true;
                    const codesStr = row.expandedCodes.map((c) => c.code).join(' ');
                    return `${row.itemCode} ${row.accountNumber} ${row.categoryName} ${row.description} ${codesStr}`
                      .toLowerCase()
                      .includes(kw);
                  });

                return (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="rounded-md bg-td-blue px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                          {targetFy} 年度定義
                        </span>
                        <h3 className="text-sm font-bold text-slate-900">
                          預算項次名目平行展開矩陣（共 {filteredPool.length} 個定義項次 ×{' '}
                          {unitsToRender.length} 個{isProjectScope ? '專案' : '部門'}單位平行展開）
                        </h3>
                      </div>
                      <span className="text-xs text-slate-500">
                        依上方設定之編號組成格式自動平行展開各單位唯一預算編號
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-100/80 text-left font-semibold text-slate-700">
                            <th className="w-14 border-r border-slate-200 px-2.5 py-2.5 text-center">
                              項次
                            </th>
                            <th className="w-24 border-r border-slate-200 px-3 py-2.5">
                              科目代碼
                            </th>
                            <th className="w-28 border-r border-slate-200 px-3 py-2.5">
                              會計科目編號
                            </th>
                            <th className="w-44 border-r border-slate-200 px-3 py-2.5">
                              預算項次名目（科目名稱）
                            </th>
                            {unitsToRender.map((u) => (
                              <th
                                key={`${u.scope}:${u.code}`}
                                className="min-w-[145px] border-r border-slate-200 bg-blue-50/60 px-3 py-2.5 font-mono text-td-blue-dark"
                              >
                                <div className="text-[11px] font-bold">
                                  {u.scope === 'project' ? '🚀' : '🏢'} {u.code}
                                </div>
                                <div className="font-sans text-[11px] font-normal text-slate-600">
                                  {u.name}
                                </div>
                              </th>
                            ))}
                            <th className="min-w-[200px] px-3 py-2.5">
                              科目定義說明
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredPool.map((row) => (
                            <tr key={row.itemCode} className="hover:bg-slate-50/80">
                              <td className="border-r border-slate-200 px-2.5 py-2 text-center font-mono font-bold text-slate-600">
                                #{row.seq}
                              </td>
                              <td className="border-r border-slate-200 px-3 py-2 font-mono font-bold text-blue-700">
                                {row.itemCode}
                              </td>
                              <td className="border-r border-slate-200 px-3 py-2 font-mono text-slate-700">
                                {row.accountNumber}
                              </td>
                              <td className="border-r border-slate-200 px-3 py-2 font-semibold text-slate-900">
                                {row.categoryName}
                              </td>
                              {row.expandedCodes.map((ec) => (
                                <td
                                  key={`${ec.scope}:${ec.unitCode}:${row.itemCode}`}
                                  className="border-r border-slate-200 bg-blue-50/20 px-3 py-2 font-mono font-semibold text-td-blue-dark"
                                >
                                  {ec.code}
                                </td>
                              ))}
                              <td className="px-3 py-2 text-slate-600">
                                {row.description}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <>
          {/* 篩選與搜尋工具列 */}
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="font-medium text-slate-600">關鍵字搜尋</span>
              <input
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜尋預算編號、科目、部門、負責人…"
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-600">年度篩選</span>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="ALL">全部年度</option>
                {distinctYears.map((y) => (
                  <option key={y} value={y}>
                    {y} 年度
                  </option>
                ))}
              </select>
            </label>
            <div className="block">
              <span className="font-medium text-slate-600">部門／專案篩選</span>
              <MultiSelectFilter
                options={scopeFilterOptions}
                selected={filterScopes}
                onChange={setFilterScopes}
                keyword={filterScopeKeyword}
                onKeywordChange={setFilterScopeKeyword}
                placeholder="全部單位與專案（可多選或輸入文字）"
                ariaLabel="部門／專案篩選"
                className="!mt-1 !rounded !border-slate-300 !px-2.5 !py-1.5 !text-xs"
                inputClassName="!text-xs"
              />
            </div>
            <label className="block">
              <span className="font-medium text-slate-600">狀態篩選</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
              >
                <option value="ALL">全部狀態</option>
                <option value="ACTIVE">僅啟用中</option>
                <option value="INACTIVE">僅已停用</option>
              </select>
            </label>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr className="border-b text-left">
                  <th className="px-3 py-2.5 font-semibold">編號</th>
                  <th className="px-3 py-2.5 font-semibold">部門名稱</th>
                  <th className="px-3 py-2.5 font-semibold">專案名稱</th>
                  <th className="px-3 py-2.5 font-semibold">類別（會計科目）</th>
                  <th className="px-3 py-2.5 font-semibold">年度</th>
                  <th className="px-3 py-2.5 font-semibold">負責人</th>
                  <th className="px-3 py-2.5 font-semibold">狀態</th>
                  <th className="px-3 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCodes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      查無符合篩選條件的預算編號。
                    </td>
                  </tr>
                ) : (
                  filteredCodes.map((b) => {
                    const std = findStandardAccountCategory(b.category);
                    return (
                      <tr
                        key={b.id}
                        className={`transition hover:bg-slate-50/80 ${
                          !b.active ? 'bg-slate-50/60 text-slate-400' : ''
                        }`}
                      >
                        <td className="px-3 py-2.5 font-mono font-medium text-slate-900">{b.code}</td>
                        <td className="px-3 py-2.5">
                          {b.departmentName ? (
                            <span>
                              {b.departmentCode ? `${b.departmentCode}｜` : ''}
                              {b.departmentName}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {b.projectName ? (
                            <span>
                              {b.projectCode ? `${b.projectCode}｜` : ''}
                              {b.projectName}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {std ? (
                            <span>
                              <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">
                                {std.accountNumber}
                              </span>
                              {b.category}
                            </span>
                          ) : (
                            b.category
                          )}
                        </td>
                        <td className="px-3 py-2.5">{b.fiscalYear}</td>
                        <td className="px-3 py-2.5">
                          {b.ownerName ?? <span className="text-amber-700">⚠️ 缺少負責人</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {b.active ? (
                            <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              啟用中
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                              已停用
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => onEdit(b)}
                            className="mr-2.5 text-xs font-medium text-blue-600 underline hover:text-blue-800"
                          >
                            編輯
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleActive(b)}
                            disabled={togglingId === b.id}
                            className="mr-2.5 text-xs font-medium text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
                          >
                            {b.active !== false ? '停用' : '啟用'}
                          </button>
                          {(b.usageCount ?? 0) > 0 ? (
                            <span
                              className="text-xs text-slate-400"
                              title="此預算代號已被單據引用，僅可停用、不可刪除"
                            >
                              已引用({b.usageCount})·僅可停用
                            </span>
                          ) : b.active === false ? (
                            <button
                              type="button"
                              onClick={() => onDelete(b)}
                              disabled={deletingId === b.id}
                              className="text-xs font-medium text-red-600 underline hover:text-red-800 disabled:opacity-50"
                              title="已停用且尚未被任何單據引用，可刪除此預算代號"
                            >
                              刪除
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </section>
        </div>
      )}

      {/* ==================== 頁面 3：預算管理（各部門及各專案回傳預算表與預算變更表清單） (management) ==================== */}
      {activeTab === 'management' && (
        <BudgetAnalysisHub
          budgetCodes={budgetCodes}
          departments={departments}
          projects={projects}
          employees={employees}
          employeesByDepartment={employeesByDepartment}
          formRecords={formRecords}
          publishedAnalyses={publishedAnalyses}
          mode="records_only"
        />
      )}

      {/* ==================== 頁面 4：預算分析（各部門與專案預算執行率・當前預算差異・標籤切換指定部門或專案差異） (analysis) ==================== */}
      {activeTab === 'analysis' && (
        <BudgetAnalysisHub
          budgetCodes={budgetCodes}
          departments={departments}
          projects={projects}
          employees={employees}
          employeesByDepartment={employeesByDepartment}
          formRecords={formRecords}
          publishedAnalyses={publishedAnalyses}
          mode="analysis_only"
        />
      )}

      {/* ==================== 頁面 1：主檔管理 (projects) ==================== */}
      {activeTab === 'projects' && (
        <ProjectManager
          projects={projects}
          budgetCodes={budgetCodes}
          departments={departments}
          employees={employees}
          suppliers={suppliers}
        />
      )}
    </div>
  );
}
