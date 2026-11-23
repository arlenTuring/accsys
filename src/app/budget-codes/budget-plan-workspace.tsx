'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  STANDARD_ACCOUNT_CATEGORIES,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import {
  dispatchBudgetCompilationNotices,
  saveBudgetSheetRows,
} from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import type { DepartmentOption, EmployeeOption } from './budget-codes-manager';
import {
  formatBudgetCodeByConfig,
  type CodeFormatConfig,
  type CodeFormatPattern,
  type CodeSeparator,
} from './budget-sheets-builder';

export type PlanTargetType = 'all_departments' | 'department' | 'project';

export type PlanItemRow = {
  rowId: string;
  itemCode: string;
  accountNumber: string;
  categoryName: string;
  description: string;
  code: string;
};

export type BudgetPlanRecord = {
  id: string;
  fiscalYear: string;
  targetType: PlanTargetType;
  unitCode: string; // 'ALL_DEPT' or department code (e.g. 'AD') or project code (e.g. '115BD001')
  unitName: string;
  planTitle: string;
  ownerEmployeeCode: string;
  ownerName: string;
  formatConfig: CodeFormatConfig;
  items: PlanItemRow[];
  publishedAt?: string | null;
  publishedInfo?: string | null;
};

function computeUniquePlanItems(
  rawItems: Omit<PlanItemRow, 'code'>[],
  formatConfig: CodeFormatConfig,
  fiscalYear: string,
  sampleUnitCode: string
): PlanItemRow[] {
  return rawItems.map((item, idx) => {
    const code = formatBudgetCodeByConfig({
      format: formatConfig,
      fiscalYear,
      unitCode: sampleUnitCode,
      itemCode: item.itemCode,
      seqIndex: idx,
    });
    return {
      ...item,
      code,
    };
  });
}

export function BudgetPlanWorkspace({
  budgetCodes,
  departments,
  projects,
  employees,
  employeesByDepartment,
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
}) {
  const router = useRouter();

  const formatProjectOptionLabel = (p: ProjectListItem) => {
    const cleanName = p.name.startsWith(p.code)
      ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
      : p.name;
    return cleanName ? `${p.code}｜${cleanName}` : p.code;
  };

  // 建立初始「財會人員已製作好的預算規劃清單」
  const initialPlans = useMemo<BudgetPlanRecord[]>(() => {
    const defaultFy = '116';
    const defaultFormat: CodeFormatConfig = {
      pattern: 'YEAR_UNIT_ITEM',
      separator: '',
      prefix: '',
    };

    const result: BudgetPlanRecord[] = [];

    // 1. 全公司統一的部門預算規劃表
    const sampleDeptCode = departments[0]?.code ?? 'AD';
    const allDeptItems = computeUniquePlanItems(
      DEPARTMENT_ACCOUNT_CATEGORIES.map((c, idx) => ({
        rowId: `all-dept-${c.itemCode}-${idx}`,
        itemCode: c.itemCode,
        accountNumber: c.accountNumber,
        categoryName: c.categoryName,
        description: c.description,
      })),
      defaultFormat,
      defaultFy,
      sampleDeptCode
    );
    result.push({
      id: `plan-${defaultFy}-ALL_DEPT`,
      fiscalYear: defaultFy,
      targetType: 'all_departments',
      unitCode: 'ALL_DEPT',
      unitName: `全公司統一的部門（適用全部 ${departments.length} 個部門）`,
      planTitle: `${defaultFy} 年度全公司部門統一預算規劃表`,
      ownerEmployeeCode: '',
      ownerName: '各部門主管',
      formatConfig: defaultFormat,
      items: allDeptItems,
      publishedAt: null,
      publishedInfo: null,
    });

    // 2. 各指定部門預算規劃表
    for (const d of departments) {
      const deptCodesInDb = budgetCodes.filter(
        (b) => b.fiscalYear === defaultFy && b.departmentCode === d.code
      );
      const mgr = employees.find((e) => e.id === d.managerEmployeeId);
      const rawItems = DEPARTMENT_ACCOUNT_CATEGORIES.map((c, idx) => ({
        rowId: `dept-${d.code}-${c.itemCode}-${idx}`,
        itemCode: c.itemCode,
        accountNumber: c.accountNumber,
        categoryName: c.categoryName,
        description: c.description,
      }));
      // 若資料庫中有該部門額外自訂的科目，一併納入
      for (const dbItem of deptCodesInDb) {
        const std = findStandardAccountCategory(dbItem.category);
        if (!std && !rawItems.some((r) => r.categoryName === dbItem.category)) {
          rawItems.push({
            rowId: `dept-custom-${dbItem.id}`,
            itemCode: `SE${String(rawItems.length + 1).padStart(2, '0')}`,
            accountNumber: '6288',
            categoryName: dbItem.category,
            description: '部門自訂預算科目',
          });
        }
      }

      result.push({
        id: `plan-${defaultFy}-DEPT-${d.code}`,
        fiscalYear: defaultFy,
        targetType: 'department',
        unitCode: d.code,
        unitName: `${d.code}｜${d.name}`,
        planTitle: `${defaultFy} 年度「${d.code}｜${d.name}」部門預算規劃表`,
        ownerEmployeeCode: mgr?.employeeCode ?? '',
        ownerName: mgr ? `${mgr.name}（部門主管）` : '部門主管',
        formatConfig: defaultFormat,
        items: computeUniquePlanItems(rawItems, defaultFormat, defaultFy, d.code),
        publishedAt: null,
        publishedInfo: null,
      });
    }

    // 3. 各指定專案預算規劃表
    for (const p of projects) {
      const cleanName = p.name.startsWith(p.code)
        ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
        : p.name;
      const projCodesInDb = budgetCodes.filter((b) => b.projectCode === p.code);
      const firstWithOwner = projCodesInDb.find((b) => b.ownerEmployeeCode);
      const ownerEmp = employees.find(
        (e) => e.employeeCode === firstWithOwner?.ownerEmployeeCode
      );

      const rawItems = PROJECT_ACCOUNT_CATEGORIES.map((c, idx) => ({
        rowId: `proj-${p.code}-${c.itemCode}-${idx}`,
        itemCode: c.itemCode,
        accountNumber: c.accountNumber,
        categoryName: c.categoryName,
        description: c.description,
      }));

      result.push({
        id: `plan-${defaultFy}-PROJ-${p.code}`,
        fiscalYear: defaultFy,
        targetType: 'project',
        unitCode: p.code,
        unitName: cleanName ? `${p.code}｜${cleanName}` : p.code,
        planTitle: `${defaultFy} 年度「${p.code}${cleanName ? `｜${cleanName}` : ''}」專案預算規劃表`,
        ownerEmployeeCode: ownerEmp?.employeeCode ?? firstWithOwner?.ownerEmployeeCode ?? '',
        ownerName:
          ownerEmp?.name ??
          firstWithOwner?.ownerName ??
          '（發布時可挑選負責人）',
        formatConfig: defaultFormat,
        items: computeUniquePlanItems(rawItems, defaultFormat, defaultFy, p.code),
        publishedAt: null,
        publishedInfo: null,
      });
    }

    return result;
  }, [budgetCodes, departments, projects, employees]);

  const [customPlans, setCustomPlans] = useState<BudgetPlanRecord[]>([]);
  const [publishedMap, setPublishedMap] = useState<
    Record<string, { publishedAt: string; publishedInfo: string; ownerEmployeeCode?: string; ownerName?: string }>
  >({});

  // 合併初始規劃清單與使用者新增／修改的規劃表（最新建立或最新年度排在最前面）
  const allPlans = useMemo(() => {
    const map = new Map<string, BudgetPlanRecord>();
    for (const p of customPlans) {
      map.set(p.id, p);
    }
    for (const p of initialPlans) {
      if (!map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    return Array.from(map.values()).map((p) => {
      const pub = publishedMap[p.id];
      if (!pub) return p;
      return {
        ...p,
        publishedAt: pub.publishedAt,
        publishedInfo: pub.publishedInfo,
        ownerEmployeeCode: pub.ownerEmployeeCode ?? p.ownerEmployeeCode,
        ownerName: pub.ownerName ?? p.ownerName,
      };
    });
  }, [initialPlans, customPlans, publishedMap]);

  // 清單篩選與展開狀態
  const [filterTargetType, setFilterTargetType] = useState<'ALL' | PlanTargetType>('ALL');
  const [searchKw, setSearchKw] = useState('');
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const filteredPlans = useMemo(() => {
    const kw = searchKw.trim().toLowerCase();
    return allPlans.filter((p) => {
      if (filterTargetType !== 'ALL' && p.targetType !== filterTargetType) {
        return false;
      }
      if (!kw) return true;
      return `${p.fiscalYear} ${p.unitCode} ${p.unitName} ${p.planTitle} ${p.ownerName}`
        .toLowerCase()
        .includes(kw);
    });
  }, [allPlans, filterTargetType, searchKw]);

  // ==================== 對話框 1：「新增／編輯預算規劃」兩步驟順序性精靈對話框 ====================
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  // 系統自動檢查預算年度：不能是去年或過去的年度，今年度與之後的未來年度都可以
  const currentWestYear = new Date().getFullYear();
  const currentRocYearNum = currentWestYear - 1911; // 今年度（如 115）
  const currentRocYear = String(currentRocYearNum);
  const nextRocYear = String(currentRocYearNum + 1); // 明年度（如 116）

  // Step 1 state: 格式定義與適用範圍
  const [wizFiscalYear, setWizFiscalYear] = useState(nextRocYear);
  const [wizTargetType, setWizTargetType] = useState<PlanTargetType>('department');
  const [wizDeptCode, setWizDeptCode] = useState<string>(() => departments[0]?.code ?? 'AD');
  const [wizDeptOwnerCode, setWizDeptOwnerCode] = useState<string>('');
  const [wizProjCode, setWizProjCode] = useState<string>(() => projects[0]?.code ?? '');
  const [wizProjOwnerCode, setWizProjOwnerCode] = useState<string>('');
  const [wizPlanTitle, setWizPlanTitle] = useState<string>('');
  const [wizFormat, setWizFormat] = useState<CodeFormatConfig>({
    pattern: 'YEAR_UNIT_ITEM',
    separator: '',
    prefix: '',
  });

  // Step 2 state: 預算代碼的組合編列（支援滑鼠拖拉順序＋動態新增科目）
  const [wizRows, setWizRows] = useState<PlanItemRow[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [wizSaving, setWizSaving] = useState(false);
  const [wizError, setWizError] = useState<string | null>(null);

  const wizSampleUnitCode =
    wizTargetType === 'all_departments'
      ? departments[0]?.code ?? 'AD'
      : wizTargetType === 'department'
        ? wizDeptCode
        : wizProjCode || 'PROJ01';

  // 系統自動檢查 1：預算年度是否為今年或未來年度（拒絕去年及過去年度）
  const wizFiscalYearCheck = useMemo(() => {
    const trimmed = wizFiscalYear.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      return {
        valid: false,
        isCurrentYear: false,
        message: `請輸入有效的民國年度數字（今年為 ${currentRocYear} 年度）`,
      };
    }
    const num = Number(trimmed);
    if (num < currentRocYearNum) {
      return {
        valid: false,
        isCurrentYear: false,
        message: `🚫 系統檢查拒絕：不可設定去年或過去的年度（${num} 年度已過）！今年為 ${currentRocYear} 年度，僅可使用今年度（${currentRocYear}）或之後的未來年度（${currentRocYearNum + 1}、${currentRocYearNum + 2}…）。`,
      };
    }
    if (num === currentRocYearNum) {
      return {
        valid: true,
        isCurrentYear: true,
        message: `✓ 系統自動檢查：此為「今年度」（民國 ${num} 年度・西元 ${num + 1911} 年），允許使用`,
      };
    }
    return {
      valid: true,
      isCurrentYear: false,
      message: `✓ 系統自動檢查：此為「未來年度」（民國 ${num} 年度・西元 ${num + 1911} 年），允許使用`,
    };
  }, [wizFiscalYear, currentRocYear, currentRocYearNum]);

  // 系統自動檢查 2（第一步）：檢查是否與既有預算規劃表「重複定義」（相同年度＋相同部門／專案／全公司統一，或相同規劃表名稱）
  const step1DuplicateCheck = useMemo(() => {
    const fy = wizFiscalYear.trim();
    const targetUnitCode =
      wizTargetType === 'all_departments'
        ? 'ALL_DEPT'
        : wizTargetType === 'department'
          ? wizDeptCode
          : wizProjCode;
    const otherPlans = allPlans.filter((p) => p.id !== editingPlanId);

    const sameScopePlan = otherPlans.find(
      (p) =>
        p.fiscalYear === fy &&
        p.targetType === wizTargetType &&
        p.unitCode.toUpperCase() === targetUnitCode.toUpperCase()
    );
    if (sameScopePlan) {
      return {
        hasDuplicate: true,
        message: `🚫 重複定義拒絕使用：系統檢查發現清單中已存在「${sameScopePlan.planTitle}」（${sameScopePlan.fiscalYear} 年度・${sameScopePlan.unitName}），不可重複定義相同年度與相同單位的預算規劃！請改設定其他年度（如 ${Number(fy) >= currentRocYearNum ? Number(fy) + 1 : nextRocYear} 年度）、切換其他單位，或直接編輯既有規劃表。`,
      };
    }

    const trimmedTitle = wizPlanTitle.trim();
    if (trimmedTitle) {
      const sameTitlePlan = otherPlans.find(
        (p) => p.planTitle.trim().toLowerCase() === trimmedTitle.toLowerCase()
      );
      if (sameTitlePlan) {
        return {
          hasDuplicate: true,
          message: `🚫 重複定義拒絕使用：預算規劃表名稱「${trimmedTitle}」與既有規劃表重複，系統拒絕使用相同名稱！`,
        };
      }
    }

    return { hasDuplicate: false, message: null };
  }, [
    allPlans,
    editingPlanId,
    wizFiscalYear,
    wizTargetType,
    wizDeptCode,
    wizProjCode,
    wizPlanTitle,
    currentRocYearNum,
    nextRocYear,
  ]);

  // 系統自動檢查 3（第二步）：檢查預算代碼組合編列是否有重複定義（重複科目代碼、重複科目名稱、或重複預算代碼）
  const step2DuplicateCheck = useMemo(() => {
    const rowErrors: Record<string, string[]> = {};
    const firstSeenCode = new Map<string, number>();
    const firstSeenItemCode = new Map<string, number>();
    const firstSeenCategory = new Map<string, number>();

    wizRows.forEach((row, idx) => {
      const errs: string[] = [];
      const rowNum = idx + 1;

      const normCode = row.code.trim().toUpperCase();
      if (normCode) {
        const prevIdx = firstSeenCode.get(normCode);
        if (prevIdx !== undefined) {
          errs.push(`展開後預算代碼「${row.code}」與第 #${prevIdx} 項次重複定義`);
        } else {
          firstSeenCode.set(normCode, rowNum);
        }
      }

      const normItem = row.itemCode.trim().toUpperCase();
      if (normItem) {
        const prevIdx = firstSeenItemCode.get(normItem);
        if (prevIdx !== undefined) {
          errs.push(`標準科目代碼「${row.itemCode}」與第 #${prevIdx} 項次重複定義`);
        } else {
          firstSeenItemCode.set(normItem, rowNum);
        }
      }

      const normCat = row.categoryName.trim().toLowerCase();
      if (!normCat) {
        errs.push('預算項次名目（科目名稱）不可空白');
      } else {
        const prevIdx = firstSeenCategory.get(normCat);
        if (prevIdx !== undefined) {
          errs.push(`科目名稱「${row.categoryName.trim()}」與第 #${prevIdx} 項次重複定義`);
        } else {
          firstSeenCategory.set(normCat, rowNum);
        }
      }

      if (errs.length > 0) {
        rowErrors[row.rowId] = errs;
      }
    });

    const duplicateRowCount = Object.keys(rowErrors).length;
    const summaryMessages = Object.entries(rowErrors).flatMap(([, msgs]) => msgs);
    return {
      hasDuplicate: duplicateRowCount > 0,
      duplicateRowCount,
      rowErrors,
      summaryMessage:
        duplicateRowCount > 0
          ? `🚫 系統檢查拒絕使用（共 ${duplicateRowCount} 個項次重複定義）：${summaryMessages[0]}。請修正或移除標紅色的重複項次後再儲存！`
          : null,
    };
  }, [wizRows]);

  const wizExampleCode = useMemo(() => {
    return (
      formatBudgetCodeByConfig({
        format: wizFormat,
        fiscalYear: wizFiscalYear || '116',
        unitCode: wizSampleUnitCode,
        itemCode: 'SE01',
        seqIndex: 0,
      }) || '116ADSE01'
    );
  }, [wizFormat, wizFiscalYear, wizSampleUnitCode]);

  const openNewPlanWizard = () => {
    const defaultDept = departments[0];
    const defaultDeptMgr = defaultDept?.managerEmployeeId
      ? employees.find((e) => e.id === defaultDept.managerEmployeeId)
      : undefined;
    setEditingPlanId(null);
    setWizardStep(1);
    setWizFiscalYear('116');
    setWizTargetType('department');
    setWizDeptCode(defaultDept?.code ?? 'AD');
    setWizDeptOwnerCode(defaultDeptMgr?.employeeCode ?? '');
    setWizProjCode(projects[0]?.code ?? '');
    setWizProjOwnerCode('');
    setWizPlanTitle(
      `116 年度「${defaultDept ? `${defaultDept.code}｜${defaultDept.name}` : 'AD｜管理部'}」部門預算規劃表`
    );
    const fmt: CodeFormatConfig = {
      pattern: 'YEAR_UNIT_ITEM',
      separator: '',
      prefix: '',
    };
    setWizFormat(fmt);
    setWizRows(
      computeUniquePlanItems(
        DEPARTMENT_ACCOUNT_CATEGORIES.map((c, idx) => ({
          rowId: `new-${c.itemCode}-${idx}`,
          itemCode: c.itemCode,
          accountNumber: c.accountNumber,
          categoryName: c.categoryName,
          description: c.description,
        })),
        fmt,
        '116',
        defaultDept?.code ?? 'AD'
      )
    );
    setWizError(null);
    setWizardOpen(true);
  };

  const openEditPlanWizard = (plan: BudgetPlanRecord) => {
    setEditingPlanId(plan.id);
    setWizardStep(1);
    const numFy = Number(plan.fiscalYear);
    const validFy =
      !Number.isNaN(numFy) && numFy >= currentRocYearNum
        ? plan.fiscalYear
        : nextRocYear;
    setWizFiscalYear(validFy);
    setWizTargetType(plan.targetType);
    if (plan.targetType === 'department') {
      setWizDeptCode(plan.unitCode);
      setWizDeptOwnerCode(plan.ownerEmployeeCode);
    } else if (plan.targetType === 'project') {
      setWizProjCode(plan.unitCode);
      setWizProjOwnerCode(plan.ownerEmployeeCode);
    }
    setWizPlanTitle(plan.planTitle);
    setWizFormat(plan.formatConfig);
    setWizRows(plan.items);
    setWizError(null);
    setWizardOpen(true);
  };

  const goToWizardStep2 = () => {
    setWizError(null);
    if (!wizFiscalYearCheck.valid) {
      setWizError(wizFiscalYearCheck.message);
      return;
    }
    if (wizTargetType === 'department' && !wizDeptCode) {
      setWizError('請選擇目標部門');
      return;
    }
    if (wizTargetType === 'project' && !wizProjCode) {
      setWizError('請選擇目標專案');
      return;
    }
    if (step1DuplicateCheck.hasDuplicate && step1DuplicateCheck.message) {
      setWizError(step1DuplicateCheck.message);
      return;
    }

    // 依第一步選擇的對象與格式，重新確保第二步每一列預算代碼唯一且符合最新格式
    const basePool =
      wizRows.length > 0
        ? wizRows
        : (wizTargetType === 'project'
            ? PROJECT_ACCOUNT_CATEGORIES
            : DEPARTMENT_ACCOUNT_CATEGORIES
          ).map((c, idx) => ({
            rowId: `step2-${c.itemCode}-${idx}`,
            itemCode: c.itemCode,
            accountNumber: c.accountNumber,
            categoryName: c.categoryName,
            description: c.description,
            code: '',
          }));

    // 若切換為專案且原本沒有 PR01，自動補入專案專用科目
    const hasPr01 = basePool.some((r) => r.itemCode === 'PR01');
    const adjustedPool =
      wizTargetType === 'project' && !hasPr01
        ? [
            ...basePool,
            {
              rowId: `step2-PR01-${basePool.length}`,
              itemCode: 'PR01',
              accountNumber: '5110',
              categoryName: '專案直接成本／委外開發費',
              description: '專案專屬軟硬體採購、委外研發與驗收直接成本',
              code: '',
            },
          ]
        : wizTargetType !== 'project'
          ? basePool.filter((r) => r.itemCode !== 'PR01')
          : basePool;

    setWizRows(
      computeUniquePlanItems(
        adjustedPool,
        wizFormat,
        wizFiscalYear.trim(),
        wizSampleUnitCode
      )
    );
    setWizardStep(2);
  };

  // 第二步：滑鼠拖拉排序與新增／刪除科目
  const handleRowDrop = (targetIdx: number) => {
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }
    setWizRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedIdx, 1);
      if (!moved) return prev;
      next.splice(targetIdx, 0, moved);
      return computeUniquePlanItems(
        next,
        wizFormat,
        wizFiscalYear.trim() || '116',
        wizSampleUnitCode
      );
    });
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const moveWizRow = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= wizRows.length) return;
    setWizRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      if (!moved) return prev;
      next.splice(targetIdx, 0, moved);
      return computeUniquePlanItems(
        next,
        wizFormat,
        wizFiscalYear.trim() || '116',
        wizSampleUnitCode
      );
    });
  };

  const addWizRow = () => {
    setWizRows((prev) => {
      const usedItemCodes = new Set(prev.map((r) => r.itemCode.toUpperCase()));
      const unusedStd = STANDARD_ACCOUNT_CATEGORIES.find(
        (c) => !usedItemCodes.has(c.itemCode.toUpperCase())
      );
      let newItemCode = unusedStd?.itemCode ?? '';
      if (!newItemCode) {
        let n = prev.length + 1;
        while (usedItemCodes.has(`SE${String(n).padStart(2, '0')}`)) {
          n += 1;
        }
        newItemCode = `SE${String(n).padStart(2, '0')}`;
      }
      const next = [
        ...prev,
        {
          rowId: `custom-${Date.now()}-${prev.length}`,
          itemCode: newItemCode,
          accountNumber: unusedStd?.accountNumber ?? '6288',
          categoryName:
            unusedStd?.categoryName ?? `自訂預算科目(${prev.length + 1})`,
          description: unusedStd?.description ?? '新增之預算規劃科目項次',
          code: '',
        },
      ];
      return computeUniquePlanItems(
        next,
        wizFormat,
        wizFiscalYear.trim() || '116',
        wizSampleUnitCode
      );
    });
  };

  const removeWizRow = (rowId: string) => {
    if (wizRows.length <= 1) return;
    setWizRows((prev) =>
      computeUniquePlanItems(
        prev.filter((r) => r.rowId !== rowId),
        wizFormat,
        wizFiscalYear.trim() || '116',
        wizSampleUnitCode
      )
    );
  };

  const handleSaveWizardPlan = async () => {
    setWizError(null);
    if (!wizFiscalYearCheck.valid) {
      setWizError(wizFiscalYearCheck.message);
      return;
    }
    if (step1DuplicateCheck.hasDuplicate && step1DuplicateCheck.message) {
      setWizError(step1DuplicateCheck.message);
      return;
    }
    if (wizRows.length === 0) {
      setWizError('請至少保留一個預算科目項次');
      return;
    }
    if (step2DuplicateCheck.hasDuplicate && step2DuplicateCheck.summaryMessage) {
      setWizError(step2DuplicateCheck.summaryMessage);
      return;
    }

    const fy = wizFiscalYear.trim() || '116';
    let unitCode = 'ALL_DEPT';
    let unitName = `全公司統一的部門（適用全部 ${departments.length} 個部門）`;
    let ownerName = '各部門主管';
    let ownerCode = '';

    if (wizTargetType === 'department') {
      const dept = departments.find((d) => d.code === wizDeptCode);
      unitCode = wizDeptCode;
      unitName = dept ? `${dept.code}｜${dept.name}` : wizDeptCode;
      const mgr = employees.find((e) => e.id === dept?.managerEmployeeId);
      const chosenDeptMember = wizDeptOwnerCode
        ? employees.find((e) => e.employeeCode === wizDeptOwnerCode)
        : mgr;
      ownerCode = chosenDeptMember?.employeeCode ?? mgr?.employeeCode ?? '';
      ownerName = chosenDeptMember
        ? chosenDeptMember.id === mgr?.id
          ? `${chosenDeptMember.name}（部門主管）`
          : `${chosenDeptMember.name}（${chosenDeptMember.employeeCode}）`
        : mgr
          ? `${mgr.name}（部門主管）`
          : '部門主管';
    } else if (wizTargetType === 'project') {
      const proj = projects.find((p) => p.code === wizProjCode);
      unitCode = wizProjCode;
      unitName = proj ? formatProjectOptionLabel(proj) : wizProjCode;
      const ownerEmp = employees.find((e) => e.employeeCode === wizProjOwnerCode);
      ownerCode = wizProjOwnerCode;
      ownerName = ownerEmp ? ownerEmp.name : '（發布時可挑選負責人）';
    }

    const planId =
      editingPlanId ??
      `plan-${fy}-${wizTargetType === 'all_departments' ? 'ALL_DEPT' : `${wizTargetType === 'department' ? 'DEPT' : 'PROJ'}-${unitCode}`}`;

    const defaultTitle =
      wizTargetType === 'all_departments'
        ? `${fy} 年度全公司部門統一預算規劃表`
        : wizTargetType === 'department'
          ? `${fy} 年度「${unitName}」部門預算規劃表`
          : `${fy} 年度「${unitName}」專案預算規劃表`;

    const newPlan: BudgetPlanRecord = {
      id: planId,
      fiscalYear: fy,
      targetType: wizTargetType,
      unitCode,
      unitName,
      planTitle: wizPlanTitle.trim() || defaultTitle,
      ownerEmployeeCode: ownerCode,
      ownerName,
      formatConfig: wizFormat,
      items: wizRows,
      publishedAt: null,
      publishedInfo: null,
    };

    setWizSaving(true);
    // 同步儲存至後端預算編號表（若是單一部門或單一專案）
    if (wizTargetType === 'department' || wizTargetType === 'project') {
      await saveBudgetSheetRows({
        sheetType: wizTargetType === 'department' ? 'department' : 'project',
        fiscalYear: fy,
        departmentCode: wizTargetType === 'department' ? unitCode : null,
        projectCode: wizTargetType === 'project' ? unitCode : null,
        ownerEmployeeCode: wizTargetType === 'project' ? ownerCode || null : null,
        rows: wizRows.map((r) => ({
          code: r.code,
          category: r.categoryName,
          annualBudgetAmount: 100000,
        })),
      });
    }
    setWizSaving(false);

    setCustomPlans((prev) => {
      const filtered = prev.filter((p) => p.id !== newPlan.id);
      return [newPlan, ...filtered];
    });
    setExpandedPlanId(newPlan.id);
    setWizardOpen(false);
    setBannerSuccess(
      `已成功建立並儲存「${newPlan.planTitle}」（共 ${newPlan.items.length} 個預算科目項次）！您現在可以在清單中按下「寄送」派發給對應單位。`
    );
    router.refresh();
  };

  // ==================== 對話框 2：按下清單項次上的「🚀 發布」跳出發布對話框 ====================
  const [publishPlan, setPublishPlan] = useState<BudgetPlanRecord | null>(null);
  const [pubDeadline, setPubDeadline] = useState('2026-12-15');
  const [pubTemplates, setPubTemplates] = useState<
    ('department' | 'project' | 'variance')[]
  >(['department', 'variance']);
  const [pubDeptRecipientIds, setPubDeptRecipientIds] = useState<string[]>([]);
  const [pubProjectOwnerId, setPubProjectOwnerId] = useState<string>('');
  const [pubAllDeptRecipientIds, setPubAllDeptRecipientIds] = useState<string[]>([]);
  const [pubNote, setPubNote] = useState('');
  const [pubSubmitting, setPubSubmitting] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);

  const openPublishModal = (plan: BudgetPlanRecord) => {
    setPublishPlan(plan);
    setPubError(null);
    setPubDeadline('2026-12-15');
    setPubNote('');

    if (plan.targetType === 'department') {
      setPubTemplates(['department', 'variance']);
      const dept = departments.find((d) => d.code === plan.unitCode);
      const deptMembers = dept
        ? employees.filter((e) => e.departmentId === dept.id)
        : [];
      const mgr = dept?.managerEmployeeId
        ? employees.find((e) => e.id === dept.managerEmployeeId)
        : undefined;
      const savedOwner = plan.ownerEmployeeCode
        ? deptMembers.find((e) => e.employeeCode === plan.ownerEmployeeCode)
        : undefined;
      // 預設為該部門主管（若曾調整為同部門其他人則帶入該人，否則預設該部門主管）
      const defaultDeptRecipientId =
        savedOwner?.id ?? mgr?.id ?? deptMembers[0]?.id ?? '';
      setPubDeptRecipientIds(
        defaultDeptRecipientId ? [defaultDeptRecipientId] : []
      );
    } else if (plan.targetType === 'project') {
      setPubTemplates(['project', 'variance']);
      // 預設帶入原專案負責人（若無則預設第一位員工，讓財會可重新挑選）
      const matchedEmp = employees.find(
        (e) =>
          e.employeeCode === plan.ownerEmployeeCode || e.name === plan.ownerName
      );
      setPubProjectOwnerId(matchedEmp?.id ?? employees[0]?.id ?? '');
    } else {
      // 全公司統一的部門：預設勾選所有部門主管
      setPubTemplates(['department', 'variance']);
      const mgrIds = departments
        .map((d) => d.managerEmployeeId)
        .filter((id): id is string => Boolean(id));
      setPubAllDeptRecipientIds(
        mgrIds.length > 0 ? mgrIds : employees.map((e) => e.id)
      );
    }
  };

  // 計算當初製作若為「指定部門」，鎖定該部門之可選人員（主管置頂 + 該部門其他成員）
  const lockedDepartmentInfo = useMemo(() => {
    if (!publishPlan || publishPlan.targetType !== 'department') {
      return { dept: null, manager: null, members: [] as EmployeeOption[] };
    }
    const dept = departments.find((d) => d.code === publishPlan.unitCode) ?? null;
    if (!dept) {
      return { dept: null, manager: null, members: [] as EmployeeOption[] };
    }
    const manager = dept.managerEmployeeId
      ? employees.find((e) => e.id === dept.managerEmployeeId) ?? null
      : null;
    const deptMembers = employees.filter((e) => e.departmentId === dept.id);
    const orderedMembers = manager
      ? [manager, ...deptMembers.filter((m) => m.id !== manager.id)]
      : deptMembers;
    return {
      dept,
      manager,
      members: orderedMembers,
    };
  }, [publishPlan, departments, employees]);

  const togglePubTemplate = (t: 'department' | 'project' | 'variance') => {
    setPubTemplates((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleConfirmPublish = async () => {
    if (!publishPlan) return;
    setPubError(null);

    if (pubTemplates.length === 0) {
      setPubError('請至少勾選一種要求填報之表單類型');
      return;
    }

    let recipientIds: string[] = [];
    let targetSummaryText = '';
    let updatedOwnerCode: string | undefined;
    let updatedOwnerName: string | undefined;

    if (publishPlan.targetType === 'department') {
      // 指定部門：自然只能發給該部門內的人員（預設該部門主管，最多可調整為該部門其他人）
      if (pubDeptRecipientIds.length === 0) {
        setPubError(`請至少選擇一位「${publishPlan.unitName}」部門內的收件人`);
        return;
      }
      recipientIds = pubDeptRecipientIds;
      const chosenMembers = lockedDepartmentInfo.members.filter((m) =>
        pubDeptRecipientIds.includes(m.id)
      );
      const chosenLabels = chosenMembers.map((m) =>
        m.id === lockedDepartmentInfo.manager?.id
          ? `${m.name}（部門主管）`
          : `${m.name}（${m.employeeCode}）`
      );
      if (chosenMembers[0]) {
        updatedOwnerCode = chosenMembers[0].employeeCode;
        updatedOwnerName = chosenLabels.join('、');
      }
      targetSummaryText = `指定部門「${publishPlan.unitName}」收件人：${chosenLabels.join('、')}`;
    } else if (publishPlan.targetType === 'project') {
      // 指定專案：可重新挑選負責人！
      if (!pubProjectOwnerId) {
        setPubError('請挑選此專案預算規劃要發布給哪一位專案負責人');
        return;
      }
      const chosenEmp = employees.find((e) => e.id === pubProjectOwnerId);
      recipientIds = [pubProjectOwnerId];
      updatedOwnerCode = chosenEmp?.employeeCode;
      updatedOwnerName = chosenEmp?.name;
      targetSummaryText = `專案「${publishPlan.unitName}」負責人：${chosenEmp?.name ?? ''}`;
    } else {
      // 全公司統一的部門
      if (pubAllDeptRecipientIds.length === 0) {
        setPubError('請至少勾選一位部門收件人');
        return;
      }
      recipientIds = pubAllDeptRecipientIds;
      targetSummaryText = `全公司各部門（共 ${recipientIds.length} 人）`;
    }

    setPubSubmitting(true);
    const res = await dispatchBudgetCompilationNotices({
      fiscalYear: publishPlan.fiscalYear,
      deadlineDate: pubDeadline,
      recipientEmployeeIds: recipientIds,
      templateTypes: pubTemplates,
      customNote:
        pubNote.trim() ||
        `請依據「${publishPlan.planTitle}」編列之 ${publishPlan.items.length} 個預算科目項次進行填報。`,
    });
    setPubSubmitting(false);

    if (!res.ok) {
      setPubError(res.error);
      return;
    }

    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    setPublishedMap((prev) => ({
      ...prev,
      [publishPlan.id]: {
        publishedAt: nowStr,
        publishedInfo: `已發布予 ${targetSummaryText}`,
        ownerEmployeeCode: updatedOwnerCode,
        ownerName: updatedOwnerName,
      },
    }));
    setBannerSuccess(
      `已成功寄送「${publishPlan.planTitle}」予 ${targetSummaryText}（共寄出 ${res.sentCount} 則預算填報任務通知）！`
    );
    setPublishPlan(null);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* 成功通知橫幅 */}
      {bannerSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 shadow-2xs">
          <span>{bannerSuccess}</span>
          <button
            type="button"
            onClick={() => setBannerSuccess(null)}
            className="ml-4 text-xs font-semibold text-emerald-700 underline"
          >
            關閉
          </button>
        </div>
      )}

      {/* ==================== 主畫面：財會人員已製作好的「預算規劃清單」 ==================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-td-blue">
                預算規劃與寄送工作台
              </span>
              <span className="text-xs text-slate-400">
                共 {allPlans.length} 份已製作之預算規劃表
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-td-blue-dark">
              📋 預算規劃清單（已製作完成之部門／專案／全公司統一預算規劃表）
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              清單顯示財會人員已製作好的預算規劃表及其適用對象（全公司統一的部門、指定部門、指定專案）。可直接於清單項次按下「寄送」派發予對應單位，或點擊右上角「＋ 新增預算規劃」依序完成（1）定義預算代碼格式 ➔（2）預算代碼組合編列。
            </p>
          </div>

          <button
            type="button"
            onClick={openNewPlanWizard}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            <span>＋ 新增預算規劃</span>
          </button>
        </div>

        {/* 篩選列：全公司統一的部門／指定部門／指定專案 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-semibold text-slate-700">
              篩選製作對象範圍：
            </span>
            <button
              type="button"
              onClick={() => setFilterTargetType('ALL')}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                filterTargetType === 'ALL'
                  ? 'bg-td-blue text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              全部預算規劃（{allPlans.length}）
            </button>
            <button
              type="button"
              onClick={() => setFilterTargetType('all_departments')}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                filterTargetType === 'all_departments'
                  ? 'bg-td-blue text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              🌐 全公司統一的部門（
              {allPlans.filter((p) => p.targetType === 'all_departments').length}）
            </button>
            <button
              type="button"
              onClick={() => setFilterTargetType('department')}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                filterTargetType === 'department'
                  ? 'bg-td-blue text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              🏢 指定部門（
              {allPlans.filter((p) => p.targetType === 'department').length}）
            </button>
            <button
              type="button"
              onClick={() => setFilterTargetType('project')}
              className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                filterTargetType === 'project'
                  ? 'bg-td-blue text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              🚀 指定專案（
              {allPlans.filter((p) => p.targetType === 'project').length}）
            </button>
          </div>

          <input
            value={searchKw}
            onChange={(e) => setSearchKw(e.target.value)}
            placeholder="搜尋部門、專案名稱或規劃表標題…"
            className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5"
          />
        </div>

        {/* 預算規劃清單表格 */}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[820px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-left font-semibold text-slate-700">
                <th className="w-24 border-r border-slate-200 px-3 py-3 text-center">
                  規劃年度
                </th>
                <th className="w-64 border-r border-slate-200 px-3.5 py-3">
                  針對製作之部門／專案範圍
                </th>
                <th className="min-w-[240px] border-r border-slate-200 px-3.5 py-3">
                  預算規劃表名稱 ＆ 編號格式
                </th>
                <th className="w-44 border-r border-slate-200 px-3 py-3">
                  包含科目項次
                </th>
                <th className="w-44 border-r border-slate-200 px-3 py-3">
                  對象主管／專案負責人
                </th>
                <th className="w-44 px-3.5 py-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredPlans.map((plan) => {
                const isExpanded = expandedPlanId === plan.id;
                const sampleCode = plan.items[0]?.code ?? `${plan.fiscalYear}ADSE01`;
                return (
                  <FragmentRow
                    key={plan.id}
                    plan={plan}
                    sampleCode={sampleCode}
                    isExpanded={isExpanded}
                    onToggleExpand={() =>
                      setExpandedPlanId((prev) =>
                        prev === plan.id ? null : plan.id
                      )
                    }
                    onEditPlan={() => openEditPlanWizard(plan)}
                    onPublishPlan={() => openPublishModal(plan)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ==================== 對話框 A：按下「＋ 新增預算規劃」或「✏️ 編輯規劃」跳出兩步驟順序性對話框 ==================== */}
      {wizardOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="新增與編輯預算規劃對話框"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* 對話框頂部標題與兩步驟順序指示器 */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-td-blue-dark">
                  {editingPlanId ? '✏️ 編輯預算規劃表' : '✨ 新增預算規劃表（兩步驟順序製作）'}
                </h3>
                <p className="text-xs text-slate-500">
                  第一步先定義預算代碼格式與適用範圍，第二步進行預算代碼的組合編列與順序調整。
                </p>
              </div>

              {/* 步驟指示器 */}
              <div className="flex items-center gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 transition ${
                    wizardStep === 1
                      ? 'bg-td-blue text-white shadow-xs'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
                    1
                  </span>
                  <span>第一步：定義預算代碼格式</span>
                </button>
                <span className="text-slate-400">➔</span>
                <button
                  type="button"
                  onClick={goToWizardStep2}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-2 transition ${
                    wizardStep === 2
                      ? 'bg-td-blue text-white shadow-xs'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
                    2
                  </span>
                  <span>第二步：預算代碼的組合編列</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWizardOpen(false)}
                  className="ml-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 對話框內容區 */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {wizError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700">
                  {wizError}
                </div>
              )}

              {wizardStep === 1 ? (
                /* ==================== 第一步：定義預算代碼格式與適用範圍 ==================== */
                <div className="space-y-6">
                  {/* 1. 選擇製作對象範圍 */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5 space-y-4">
                    <h4 className="text-sm font-bold text-slate-900">
                      1. 選擇此份預算規劃針對什麼單位製作
                    </h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => {
                          setWizTargetType('all_departments');
                          setWizPlanTitle(`${wizFiscalYear} 年度全公司部門統一預算規劃表`);
                        }}
                        className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
                          wizTargetType === 'all_departments'
                            ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-sm font-bold text-slate-900">
                          🌐 全公司統一的部門
                        </span>
                        <span className="mt-1 text-xs text-slate-600">
                          製作全公司各部門統一適用的標準預算規劃表，發布時可一次派發給全公司各部門。
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setWizTargetType('department');
                          const d = departments.find((x) => x.code === wizDeptCode) ?? departments[0];
                          if (d) {
                            setWizPlanTitle(
                              `${wizFiscalYear} 年度「${d.code}｜${d.name}」部門預算規劃表`
                            );
                          }
                        }}
                        className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
                          wizTargetType === 'department'
                            ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-sm font-bold text-slate-900">
                          🏢 指定單一部門
                        </span>
                        <span className="mt-1 text-xs text-slate-600">
                          針對特定部門（如 AD 管理部、RD01 研發部）製作，後續按下發布時將自動鎖定只發給該部門。
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setWizTargetType('project');
                          const p = projects.find((x) => x.code === wizProjCode) ?? projects[0];
                          if (p) {
                            setWizPlanTitle(
                              `${wizFiscalYear} 年度「${formatProjectOptionLabel(p)}」專案預算規劃表`
                            );
                          }
                        }}
                        className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
                          wizTargetType === 'project'
                            ? 'border-blue-600 bg-blue-50/70 ring-2 ring-blue-500/20'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-sm font-bold text-slate-900">
                          🚀 指定專案
                        </span>
                        <span className="mt-1 text-xs text-slate-600">
                          針對特定研發或營收專案製作，後續按下發布時還可以在對話框重新挑選專案負責人。
                        </span>
                      </button>
                    </div>

                    {/* 年度、指定部門／專案下拉與規劃名稱 */}
                    <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3 text-xs">
                      <div className="block">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-slate-700">
                            預算年度（今年或之後年度皆可，禁止過去年度）
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={wizFiscalYear}
                            onChange={(e) => {
                              const newFy = e.target.value.replace(/[^\d]/g, '');
                              setWizFiscalYear(newFy);
                              if (newFy) {
                                setWizPlanTitle((prev) =>
                                  prev.replace(/^\d+\s*年度/, `${newFy} 年度`)
                                );
                              }
                            }}
                            placeholder={`例如 ${currentRocYear}、${nextRocYear}、${currentRocYearNum + 2}`}
                            className={`w-full rounded-lg border px-3 py-2 text-sm font-bold ${
                              wizFiscalYearCheck.valid
                                ? 'border-slate-300 bg-white text-slate-900'
                                : 'border-red-500 bg-red-50 text-red-900 ring-2 ring-red-200'
                            }`}
                          />
                          {[
                            { yr: currentRocYear, tag: '今年' },
                            { yr: nextRocYear, tag: '明年' },
                            { yr: String(currentRocYearNum + 2), tag: '後年' },
                          ].map((q) => (
                            <button
                              key={q.yr}
                              type="button"
                              onClick={() => {
                                setWizFiscalYear(q.yr);
                                setWizPlanTitle((prev) =>
                                  prev.replace(/^\d+\s*年度/, `${q.yr} 年度`)
                                );
                              }}
                              className={`shrink-0 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition ${
                                wizFiscalYear.trim() === q.yr
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              {q.yr}（{q.tag}）
                            </button>
                          ))}
                        </div>
                        <p
                          className={`mt-1.5 text-[11px] font-semibold ${
                            wizFiscalYearCheck.valid ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {wizFiscalYearCheck.message}
                        </p>
                      </div>

                      {wizTargetType === 'department' && (
                        <>
                          <label className="block">
                            <span className="font-semibold text-slate-700">
                              選擇指定部門
                            </span>
                            <select
                              value={wizDeptCode}
                              onChange={(e) => {
                                const code = e.target.value;
                                setWizDeptCode(code);
                                const d = departments.find((x) => x.code === code);
                                if (d) {
                                  setWizPlanTitle(
                                    `${wizFiscalYear} 年度「${d.code}｜${d.name}」部門預算規劃表`
                                  );
                                  const mgr = d.managerEmployeeId
                                    ? employees.find((emp) => emp.id === d.managerEmployeeId)
                                    : undefined;
                                  setWizDeptOwnerCode(mgr?.employeeCode ?? '');
                                }
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                            >
                              {departments.map((d) => (
                                <option key={d.id} value={d.code}>
                                  {d.code}｜{d.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="font-semibold text-slate-700">
                              指定發給該部門的誰（預設部門主管，限本部門成員）
                            </span>
                            <select
                              value={wizDeptOwnerCode}
                              onChange={(e) => setWizDeptOwnerCode(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                            >
                              {(() => {
                                const d = departments.find((x) => x.code === wizDeptCode);
                                const mgr = d?.managerEmployeeId
                                  ? employees.find((emp) => emp.id === d.managerEmployeeId)
                                  : undefined;
                                const members = d
                                  ? employees.filter((emp) => emp.departmentId === d.id)
                                  : [];
                                const ordered = mgr
                                  ? [mgr, ...members.filter((m) => m.id !== mgr.id)]
                                  : members;
                                return ordered.map((emp) => {
                                  const isMgr = emp.id === mgr?.id;
                                  return (
                                    <option key={emp.id} value={emp.employeeCode}>
                                      {isMgr
                                        ? `★ ${emp.name}（${emp.employeeCode}）— 部門主管【預設】`
                                        : `${emp.name}（${emp.employeeCode}）— 部門成員`}
                                    </option>
                                  );
                                });
                              })()}
                            </select>
                          </label>
                        </>
                      )}

                      {wizTargetType === 'project' && (
                        <>
                          <label className="block">
                            <span className="font-semibold text-slate-700">
                              選擇指定專案
                            </span>
                            <select
                              value={wizProjCode}
                              onChange={(e) => {
                                const code = e.target.value;
                                setWizProjCode(code);
                                const p = projects.find((x) => x.code === code);
                                if (p) {
                                  setWizPlanTitle(
                                    `${wizFiscalYear} 年度「${formatProjectOptionLabel(p)}」專案預算規劃表`
                                  );
                                }
                              }}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
                            >
                              {projects.map((p) => (
                                <option key={p.id} value={p.code}>
                                  {formatProjectOptionLabel(p)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="font-semibold text-slate-700">
                              預設專案負責人（發布時仍可重新挑選）
                            </span>
                            <select
                              value={wizProjOwnerCode}
                              onChange={(e) => setWizProjOwnerCode(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                            >
                              <option value="">（發布時再挑選負責人）</option>
                              {employeesByDepartment.map((g) => (
                                <optgroup key={g.deptId} label={g.deptLabel}>
                                  {g.members.map((emp) => (
                                    <option key={emp.id} value={emp.employeeCode}>
                                      {emp.name}（{emp.employeeCode}）
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </label>
                        </>
                      )}

                      <label className="block sm:col-span-3">
                        <span className="font-semibold text-slate-700">
                          預算規劃表名稱
                        </span>
                        <input
                          value={wizPlanTitle}
                          onChange={(e) => setWizPlanTitle(e.target.value)}
                          placeholder="例如：116 年度管理部預算規劃表"
                          className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-medium ${
                            step1DuplicateCheck.hasDuplicate
                              ? 'border-red-400 ring-1 ring-red-200'
                              : 'border-slate-300'
                          }`}
                        />
                      </label>

                      {/* 系統自動檢查：年度合法性與財會資料重複定義提示區 */}
                      <div className="sm:col-span-3">
                        {!wizFiscalYearCheck.valid ? (
                          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
                            {wizFiscalYearCheck.message}
                          </div>
                        ) : step1DuplicateCheck.hasDuplicate ? (
                          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
                            {step1DuplicateCheck.message}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs font-semibold text-emerald-800">
                            ✓ 系統自動檢查通過：{wizFiscalYear.trim()} 年度（
                            {wizFiscalYearCheck.isCurrentYear ? '今年度' : '未來年度'}
                            ）符合規範，且此部門／專案尚未重複定義預算規劃表，允許使用。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 2. 定義預算代碼組成格式 */}
                  <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-slate-900">
                        2. 定義預算代碼組成格式（唯一值自動產生規則）
                      </h4>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-600">即時生成範例：</span>
                        <span className="rounded-md border border-blue-300 bg-white px-3 py-1 font-mono text-sm font-bold text-td-blue-dark">
                          {wizExampleCode}
                        </span>
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          ✓ 保證唯一值不重複
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
                      <label className="block">
                        <span className="font-semibold text-slate-700">
                          代碼組成結構
                        </span>
                        <select
                          value={wizFormat.pattern}
                          onChange={(e) =>
                            setWizFormat((prev) => ({
                              ...prev,
                              pattern: e.target.value as CodeFormatPattern,
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800"
                        >
                          <option value="YEAR_UNIT_ITEM">
                            年度 + 單位代碼 + 會計科目代碼（如 116ADSE01）
                          </option>
                          <option value="YEAR_UNIT_ITEM_SEQ">
                            年度 + 單位代碼 + 會計科目代碼 + 項次序號（如 116ADSE0101）
                          </option>
                          <option value="YEAR_UNIT_SEQ">
                            年度 + 單位代碼 + 項次序號（如 116AD01）
                          </option>
                          <option value="UNIT_YEAR_ITEM">
                            單位代碼 + 年度 + 會計科目代碼（如 AD116SE01）
                          </option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="font-semibold text-slate-700">
                          區段分隔符號
                        </span>
                        <select
                          value={wizFormat.separator}
                          onChange={(e) =>
                            setWizFormat((prev) => ({
                              ...prev,
                              separator: e.target.value as CodeSeparator,
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800"
                        >
                          <option value="">無分隔符（如 116ADSE01）</option>
                          <option value="-">連字號 -（如 116-AD-SE01）</option>
                          <option value="_">底線 _（如 116_AD_SE01）</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className="font-semibold text-slate-700">
                          自訂代碼前綴（選填）
                        </span>
                        <input
                          value={wizFormat.prefix}
                          onChange={(e) =>
                            setWizFormat((prev) => ({
                              ...prev,
                              prefix: e.target.value.replace(/\s+/g, ''),
                            }))
                          }
                          placeholder="留空或輸入如 BG"
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                /* ==================== 第二步：做預算代碼的組合編列（拖拉項次順序＋新增／刪除科目） ==================== */
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 text-xs">
                    <div>
                      <span className="font-bold text-td-blue-dark">
                        💡 預算代碼的組合編列：
                      </span>
                      <span className="ml-1 text-slate-700">
                        您可用滑鼠按住左側「<strong className="font-mono">⠿</strong>
                        」上下拖拉調整預算項次順序，或在最下方點擊「＋ 新增科目項次」。系統會自動檢查是否有重複定義之科目或預算代碼。
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={addWizRow}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700"
                    >
                      ＋ 新增科目項次
                    </button>
                  </div>

                  {/* 第二步系統重複定義檢查橫幅 */}
                  {step2DuplicateCheck.hasDuplicate ? (
                    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-xs font-semibold text-red-800">
                      {step2DuplicateCheck.summaryMessage}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs font-semibold text-emerald-800">
                      ✓ 系統自動檢查通過：目前共 {wizRows.length} 個科目項次，所有預算代碼與科目定義皆唯一且無重複定義。
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[780px] border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100 text-left font-semibold text-slate-700">
                          <th className="w-20 border-r border-slate-200 px-2.5 py-2.5 text-center">
                            拖拉／序號
                          </th>
                          <th className="w-44 border-r border-slate-200 bg-blue-50/60 px-3 py-2.5 text-td-blue-dark">
                            展開後唯一預算代碼
                          </th>
                          <th className="w-48 border-r border-slate-200 px-3 py-2.5">
                            標準科目快選／代碼
                          </th>
                          <th className="w-52 border-r border-slate-200 px-3 py-2.5">
                            預算項次名目（科目名稱）
                          </th>
                          <th className="min-w-[200px] border-r border-slate-200 px-3 py-2.5">
                            科目定義說明
                          </th>
                          <th className="w-16 px-2.5 py-2.5 text-center">刪除</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {wizRows.map((row, idx) => {
                          const isDragged = draggedIdx === idx;
                          const isDragOver =
                            dragOverIdx === idx && draggedIdx !== idx;
                          const rowDupErrors =
                            step2DuplicateCheck.rowErrors[row.rowId] ?? [];
                          const hasRowDup = rowDupErrors.length > 0;
                          return (
                            <tr
                              key={row.rowId}
                              draggable
                              onDragStart={() => setDraggedIdx(idx)}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (dragOverIdx !== idx) setDragOverIdx(idx);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                handleRowDrop(idx);
                              }}
                              onDragEnd={() => {
                                setDraggedIdx(null);
                                setDragOverIdx(null);
                              }}
                              className={`transition ${
                                hasRowDup
                                  ? 'bg-red-50/80 hover:bg-red-50'
                                  : isDragged
                                    ? 'opacity-40 bg-blue-50'
                                    : isDragOver
                                      ? 'border-t-2 border-t-blue-600 bg-blue-50/40'
                                      : 'hover:bg-slate-50/80'
                              }`}
                            >
                              <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-500">
                                <div className="flex items-center justify-center gap-1">
                                  <span
                                    className="cursor-grab select-none text-sm text-slate-400 hover:text-td-blue active:cursor-grabbing"
                                    title="按住滑鼠上下拖拉調整順序"
                                  >
                                    ⠿
                                  </span>
                                  <span className="font-bold text-slate-700">
                                    #{idx + 1}
                                  </span>
                                  <div className="ml-0.5 flex flex-col">
                                    <button
                                      type="button"
                                      onClick={() => moveWizRow(idx, -1)}
                                      disabled={idx === 0}
                                      className="leading-none text-[9px] text-slate-400 hover:text-blue-600 disabled:opacity-20"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moveWizRow(idx, 1)}
                                      disabled={idx === wizRows.length - 1}
                                      className="leading-none text-[9px] text-slate-400 hover:text-blue-600 disabled:opacity-20"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                </div>
                              </td>

                              <td
                                className={`border-r border-slate-200 px-3 py-2 font-mono font-bold ${
                                  hasRowDup
                                    ? 'bg-red-100/70 text-red-700'
                                    : 'bg-blue-50/20 text-td-blue-dark'
                                }`}
                              >
                                <div>{row.code}</div>
                                {hasRowDup && (
                                  <div className="mt-1 font-sans text-[11px] font-semibold text-red-600">
                                    🚫 {rowDupErrors.join('；')}
                                  </div>
                                )}
                              </td>

                              <td className="border-r border-slate-200 px-2.5 py-2">
                                <select
                                  value={row.itemCode}
                                  onChange={(e) => {
                                    const newCode = e.target.value;
                                    const std = STANDARD_ACCOUNT_CATEGORIES.find(
                                      (c) => c.itemCode === newCode
                                    );
                                    setWizRows((prev) =>
                                      computeUniquePlanItems(
                                        prev.map((r, i) =>
                                          i === idx
                                            ? {
                                                ...r,
                                                itemCode: newCode,
                                                accountNumber:
                                                  std?.accountNumber ?? r.accountNumber,
                                                categoryName:
                                                  std?.categoryName ?? r.categoryName,
                                                description:
                                                  std?.description ?? r.description,
                                              }
                                            : r
                                        ),
                                        wizFormat,
                                        wizFiscalYear.trim() || '116',
                                        wizSampleUnitCode
                                      )
                                    );
                                  }}
                                  className={`w-full rounded border bg-white px-2 py-1 font-mono text-xs ${
                                    hasRowDup
                                      ? 'border-red-400 text-red-700'
                                      : 'border-slate-300 text-blue-700'
                                  }`}
                                >
                                  {STANDARD_ACCOUNT_CATEGORIES.map((c) => (
                                    <option key={c.itemCode} value={c.itemCode}>
                                      {c.itemCode}｜{c.accountNumber} {c.categoryName}
                                    </option>
                                  ))}
                                </select>
                              </td>

                              <td className="border-r border-slate-200 px-2.5 py-2">
                                <input
                                  value={row.categoryName}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setWizRows((prev) =>
                                      prev.map((r, i) =>
                                        i === idx ? { ...r, categoryName: val } : r
                                      )
                                    );
                                  }}
                                  className={`w-full rounded border bg-white px-2.5 py-1 font-semibold ${
                                    hasRowDup
                                      ? 'border-red-400 text-red-900'
                                      : 'border-slate-300 text-slate-900'
                                  }`}
                                />
                              </td>

                              <td className="border-r border-slate-200 px-2.5 py-2">
                                <input
                                  value={row.description}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setWizRows((prev) =>
                                      prev.map((r, i) =>
                                        i === idx ? { ...r, description: val } : r
                                      )
                                    );
                                  }}
                                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-600"
                                />
                              </td>

                              <td className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeWizRow(row.rowId)}
                                  disabled={wizRows.length <= 1}
                                  className="rounded px-2 py-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* 表格最底下新增科目按鈕 */}
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-4 py-3">
                    <span className="text-xs text-slate-600">
                      目前共編列 <strong>{wizRows.length}</strong> 個預算科目項次
                    </span>
                    <button
                      type="button"
                      onClick={addWizRow}
                      className="rounded-lg border border-blue-500 bg-white px-3.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-600 hover:text-white"
                    >
                      ➕ 在底下新增一個科目項次
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 對話框底部按鈕列 */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                取消關閉
              </button>

              <div className="flex items-center gap-3">
                {wizardStep === 2 && (
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    ← 上一步：修改預算代碼格式
                  </button>
                )}

                {wizardStep === 1 ? (
                  <button
                    type="button"
                    onClick={goToWizardStep2}
                    disabled={!wizFiscalYearCheck.valid || step1DuplicateCheck.hasDuplicate}
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {!wizFiscalYearCheck.valid
                      ? '🚫 年度不符規範（拒絕使用）'
                      : step1DuplicateCheck.hasDuplicate
                        ? '🚫 發現重複定義（拒絕使用）'
                        : '下一步：進行預算代碼組合編列 →'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveWizardPlan}
                    disabled={wizSaving || step2DuplicateCheck.hasDuplicate}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {wizSaving
                      ? '儲存規劃表中…'
                      : step2DuplicateCheck.hasDuplicate
                        ? '🚫 存在重複定義項次（拒絕使用）'
                        : `✓ 完成並儲存預算規劃表（共 ${wizRows.length} 項次）`}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 對話框 B：按下清單項次上的「寄送」跳出寄送對話框 ==================== */}
      {publishPlan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="寄送預算規劃對話框"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
              <div>
                <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-td-blue">
                  寄送預算規劃表
                </span>
                <h3 className="mt-1 text-base font-bold text-slate-900">
                  寄送「{publishPlan.planTitle}」
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPublishPlan(null)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs">
              {pubError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 font-semibold text-red-700">
                  {pubError}
                </div>
              )}

              {/* 規劃表資訊摘要 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">
                    規劃年度：<strong>{publishPlan.fiscalYear} 年度</strong>
                  </span>
                  <span className="font-semibold text-slate-700">
                    包含預算科目：<strong>{publishPlan.items.length} 個項次</strong>
                  </span>
                </div>
                <div className="text-slate-600">
                  編號範圍範例：
                  <code className="ml-1 rounded bg-white px-2 py-0.5 font-mono font-bold text-td-blue">
                    {publishPlan.items[0]?.code}
                  </code>{' '}
                  ～{' '}
                  <code className="rounded bg-white px-2 py-0.5 font-mono font-bold text-td-blue">
                    {publishPlan.items[publishPlan.items.length - 1]?.code}
                  </code>
                </div>
              </div>

              {/* 依製作對象類型決定發布對象（指定部門鎖定該部門並預設部門主管、可調整該部門其他人；專案可重新挑選負責人；全公司統一可勾選各部門） */}
              {publishPlan.targetType === 'department' && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-td-blue-dark">
                      🏢 發布目標部門：{publishPlan.unitName}（已鎖定指定部門）
                    </span>
                    <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      🔒 僅限發給本部門人員
                    </span>
                  </div>

                  <p className="text-slate-700">
                    此份預算規劃當初是針對「
                    <strong className="text-slate-900">{publishPlan.unitName}</strong>
                    」所製作，預設發送給<strong>該部門主管</strong>
                    {lockedDepartmentInfo.manager
                      ? `（${lockedDepartmentInfo.manager.name}｜${lockedDepartmentInfo.manager.employeeCode}）`
                      : ''}
                    ，您最多僅能調整或加選<strong>該部門內的其他同仁</strong>：
                  </p>

                  {/* 1. 單選快速切換下拉（預設為該部門主管，可切換為該部門其他成員） */}
                  <label className="block">
                    <span className="font-semibold text-slate-800">
                      指定發送給該部門的誰（預設為部門主管，可調整為同部門其他人）：
                    </span>
                    <select
                      value={pubDeptRecipientIds[0] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val) {
                          setPubDeptRecipientIds([val]);
                        }
                      }}
                      className="mt-1.5 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      {lockedDepartmentInfo.members.map((emp) => {
                        const isMgr = emp.id === lockedDepartmentInfo.manager?.id;
                        return (
                          <option key={emp.id} value={emp.id}>
                            {isMgr
                              ? `★ ${emp.name}（${emp.employeeCode}）— ${publishPlan.unitName} 部門主管【預設】`
                              : `${emp.name}（${emp.employeeCode}）— ${publishPlan.unitName} 部門成員`}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  {/* 2. 同部門成員勾選區（若需同時加發給同部門其他窗口） */}
                  {lockedDepartmentInfo.members.length > 1 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-600">
                          或於「{publishPlan.unitName}」部門內勾選多位收件人（已選{' '}
                          {pubDeptRecipientIds.length} 人）：
                        </span>
                        <div className="flex items-center gap-2.5">
                          {lockedDepartmentInfo.manager && (
                            <button
                              type="button"
                              onClick={() =>
                                setPubDeptRecipientIds([
                                  lockedDepartmentInfo.manager!.id,
                                ])
                              }
                              className="font-semibold text-td-blue underline"
                            >
                              重設為僅部門主管（{lockedDepartmentInfo.manager.name}）
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setPubDeptRecipientIds(
                                lockedDepartmentInfo.members.map((m) => m.id)
                              )
                            }
                            className="font-semibold text-slate-600 underline"
                          >
                            全選本部門（{lockedDepartmentInfo.members.length} 人）
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 rounded-lg border border-blue-200 bg-white p-2.5">
                        {lockedDepartmentInfo.members.map((emp) => {
                          const isMgr = emp.id === lockedDepartmentInfo.manager?.id;
                          const checked = pubDeptRecipientIds.includes(emp.id);
                          return (
                            <label
                              key={emp.id}
                              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition ${
                                checked
                                  ? 'border-blue-600 bg-blue-50 font-semibold text-blue-950 shadow-2xs'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setPubDeptRecipientIds((prev) =>
                                    prev.includes(emp.id)
                                      ? prev.filter((id) => id !== emp.id)
                                      : [...prev, emp.id]
                                  )
                                }
                              />
                              <span>
                                {emp.name}（{emp.employeeCode}）
                                {isMgr ? (
                                  <span className="ml-1 rounded bg-blue-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                                    ★ 部門主管 (預設)
                                  </span>
                                ) : (
                                  <span className="ml-1 text-[10px] text-slate-400">
                                    本部門成員
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 目前明確發送對象摘要 */}
                  <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-white/90 px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-600">
                      📨 確認即將發布給「{publishPlan.unitName}」的誰：
                    </span>
                    <span className="font-bold text-td-blue-dark">
                      {lockedDepartmentInfo.members
                        .filter((m) => pubDeptRecipientIds.includes(m.id))
                        .map((m) =>
                          m.id === lockedDepartmentInfo.manager?.id
                            ? `${m.name}（${m.employeeCode}・★部門主管）`
                            : `${m.name}（${m.employeeCode}）`
                        )
                        .join('、') || '（尚未選擇）'}
                    </span>
                  </div>
                </div>
              )}

              {publishPlan.targetType === 'project' && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-indigo-950">
                      🚀 發布目標專案：{publishPlan.unitName}
                    </span>
                    <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      可重新挑選專案負責人
                    </span>
                  </div>
                  <label className="block">
                    <span className="font-semibold text-slate-800">
                      挑選／更換此專案之預算負責人（依部門分類）：
                    </span>
                    <select
                      value={pubProjectOwnerId}
                      onChange={(e) => setPubProjectOwnerId(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
                    >
                      <option value="">（請選擇要發布的專案負責人）</option>
                      {employeesByDepartment.map((g) => (
                        <optgroup key={g.deptId} label={g.deptLabel}>
                          {g.members.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name}（{emp.employeeCode}）
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {publishPlan.targetType === 'all_departments' && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-emerald-950">
                      🌐 發布目標：全公司各部門（已選 {pubAllDeptRecipientIds.length} 人）
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setPubAllDeptRecipientIds(employees.map((e) => e.id))
                        }
                        className="font-semibold text-blue-600 underline"
                      >
                        全選
                      </button>
                      <button
                        type="button"
                        onClick={() => setPubAllDeptRecipientIds([])}
                        className="font-semibold text-slate-500 underline"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
                    {employees.map((emp) => {
                      const dept = departments.find(
                        (d) => d.id === emp.departmentId
                      );
                      const isMgr = departments.some(
                        (d) => d.managerEmployeeId === emp.id
                      );
                      const checked = pubAllDeptRecipientIds.includes(emp.id);
                      return (
                        <label
                          key={emp.id}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 ${
                            checked
                              ? 'border-blue-500 bg-blue-50 text-blue-900 font-semibold'
                              : 'border-slate-200 text-slate-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPubAllDeptRecipientIds((prev) =>
                                prev.includes(emp.id)
                                  ? prev.filter((id) => id !== emp.id)
                                  : [...prev, emp.id]
                              )
                            }
                          />
                          <span>
                            {emp.name}
                            {dept ? `(${dept.code})` : ''}
                            {isMgr ? ' ★主管' : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 填報截止日與要求填報之表單範本 */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="font-semibold text-slate-700">
                    要求填報截止日期
                  </span>
                  <input
                    type="date"
                    value={pubDeadline}
                    onChange={(e) => setPubDeadline(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>

                <div className="block">
                  <span className="block font-semibold text-slate-700">
                    隨附派發之表單類型
                  </span>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {publishPlan.targetType !== 'project' && (
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={pubTemplates.includes('department')}
                          onChange={() => togglePubTemplate('department')}
                        />
                        <span>部門預算表</span>
                      </label>
                    )}
                    {publishPlan.targetType === 'project' && (
                      <label className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={pubTemplates.includes('project')}
                          onChange={() => togglePubTemplate('project')}
                        />
                        <span>專案預算表</span>
                      </label>
                    )}
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={pubTemplates.includes('variance')}
                        onChange={() => togglePubTemplate('variance')}
                      />
                      <span>預算差異分析表</span>
                    </label>
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="font-semibold text-slate-700">
                  發布通知備註說明（選填）
                </span>
                <input
                  value={pubNote}
                  onChange={(e) => setPubNote(e.target.value)}
                  placeholder="例如：請於截止日前依本預算規劃表之科目項次完成年度預算編列填報"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setPublishPlan(null)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmPublish}
                disabled={pubSubmitting}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {pubSubmitting ? '寄送中…' : '確認寄送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  plan,
  sampleCode,
  isExpanded,
  onToggleExpand,
  onEditPlan,
  onPublishPlan,
}: {
  plan: BudgetPlanRecord;
  sampleCode: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEditPlan: () => void;
  onPublishPlan: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/90 transition">
        <td className="border-r border-slate-200 px-3 py-3 text-center font-mono font-bold text-slate-800">
          {plan.fiscalYear} 年度
        </td>
        <td className="border-r border-slate-200 px-3.5 py-3">
          {plan.targetType === 'all_departments' ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200">
              🌐 全公司統一的部門
            </span>
          ) : plan.targetType === 'department' ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 font-semibold text-td-blue-dark ring-1 ring-blue-200">
              🏢 指定部門：{plan.unitName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-900 ring-1 ring-indigo-200">
              🚀 指定專案：{plan.unitName}
            </span>
          )}
        </td>
        <td className="border-r border-slate-200 px-3.5 py-3">
          <div className="font-bold text-slate-900">{plan.planTitle}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            代碼範例：
            <code className="rounded bg-slate-100 px-1.5 py-0.2 font-mono font-semibold text-td-blue">
              {sampleCode}
            </code>
          </div>
        </td>
        <td className="border-r border-slate-200 px-3 py-3">
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1.5 font-semibold text-td-blue hover:underline"
          >
            <span>共 {plan.items.length} 個預算項次</span>
            <span className="text-[10px]">{isExpanded ? '▲ 收合' : '▼ 展開項次'}</span>
          </button>
        </td>
        <td className="border-r border-slate-200 px-3 py-3 text-slate-700">
          {plan.ownerName}
        </td>
        <td className="px-3.5 py-3 text-center whitespace-nowrap">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onPublishPlan}
              className="whitespace-nowrap rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition hover:bg-blue-700"
            >
              寄送
            </button>
            <button
              type="button"
              onClick={onEditPlan}
              className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              編輯
            </button>
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-50/90">
          <td colSpan={6} className="px-6 py-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="font-bold text-slate-900">
                  📐 「{plan.planTitle}」已編列之預算代碼與科目項次明細（共{' '}
                  {plan.items.length} 項）
                </div>
                <button
                  type="button"
                  onClick={onEditPlan}
                  className="text-xs font-semibold text-blue-600 underline"
                >
                  ✏️ 修改格式或拖拉調整項次順序
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100 text-left text-slate-600">
                      <th className="w-16 border-r border-slate-200 px-2.5 py-1.5 text-center">
                        項次
                      </th>
                      <th className="w-44 border-r border-slate-200 px-3 py-1.5">
                        唯一預算代碼
                      </th>
                      <th className="w-36 border-r border-slate-200 px-3 py-1.5">
                        科目代碼／編號
                      </th>
                      <th className="w-52 border-r border-slate-200 px-3 py-1.5">
                        預算項次名目（科目名稱）
                      </th>
                      <th className="px-3 py-1.5">科目說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plan.items.map((it, i) => (
                      <tr key={it.rowId}>
                        <td className="border-r border-slate-200 px-2.5 py-1.5 text-center font-mono font-bold text-slate-500">
                          #{i + 1}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-1.5 font-mono font-bold text-td-blue-dark">
                          {it.code}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-1.5 font-mono text-blue-700">
                          {it.itemCode}｜{it.accountNumber}
                        </td>
                        <td className="border-r border-slate-200 px-3 py-1.5 font-semibold text-slate-900">
                          {it.categoryName}
                        </td>
                        <td className="px-3 py-1.5 text-slate-600">
                          {it.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
