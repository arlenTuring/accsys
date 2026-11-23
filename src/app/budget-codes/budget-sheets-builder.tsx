'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  STANDARD_ACCOUNT_CATEGORIES,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import { saveBudgetSheetRows } from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import type { DepartmentOption, EmployeeOption } from './budget-codes-manager';

export type SheetBuilderTab = 'department' | 'project' | 'variance';
export type BuilderViewMode = 'preview' | 'edit';

/**
 * 預算編號組成格式範本
 * - YEAR_UNIT_ITEM: 年度 + 部門/專案代碼 + 會計科目代碼 (預設標準，如 116ADSE01)
 * - YEAR_UNIT_ITEM_SEQ: 年度 + 部門/專案代碼 + 會計科目代碼 + 項次序號 (如 116ADSE0101)
 * - YEAR_UNIT_SEQ: 年度 + 部門/專案代碼 + 項次序號 (如 116AD01)
 * - UNIT_YEAR_ITEM: 部門/專案代碼 + 年度 + 會計科目代碼 (如 AD116SE01)
 */
export type CodeFormatPattern =
  | 'YEAR_UNIT_ITEM'
  | 'YEAR_UNIT_ITEM_SEQ'
  | 'YEAR_UNIT_SEQ'
  | 'UNIT_YEAR_ITEM';

export type CodeSeparator = '' | '-' | '_';

export type CodeFormatConfig = {
  pattern: CodeFormatPattern;
  separator: CodeSeparator;
  prefix: string;
};

type MonthKey =
  | 'm1'
  | 'm2'
  | 'm3'
  | 'm4'
  | 'm5'
  | 'm6'
  | 'm7'
  | 'm8'
  | 'm9'
  | 'm10'
  | 'm11'
  | 'm12';

const MONTH_KEYS: readonly MonthKey[] = [
  'm1',
  'm2',
  'm3',
  'm4',
  'm5',
  'm6',
  'm7',
  'm8',
  'm9',
  'm10',
  'm11',
  'm12',
];

type SheetRow = {
  rowId: string;
  itemCode: string;
  accountNumber: string;
  category: string;
  code: string;
  prevYearCode: string;
  m1: string;
  m2: string;
  m3: string;
  m4: string;
  m5: string;
  m6: string;
  m7: string;
  m8: string;
  m9: string;
  m10: string;
  m11: string;
  m12: string;
  annualBudgetAmount: string;
  prevApprovedAmount: string;
  prevActualAmount: string;
  note: string;
};

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function splitToMonths(total: number): Record<MonthKey, string> {
  if (!total || total <= 0) {
    return {
      m1: '',
      m2: '',
      m3: '',
      m4: '',
      m5: '',
      m6: '',
      m7: '',
      m8: '',
      m9: '',
      m10: '',
      m11: '',
      m12: '',
    };
  }
  const perMonth = Math.floor(total / 12);
  const rem = Math.round((total - perMonth * 12) * 100) / 100;
  return {
    m1: String(perMonth),
    m2: String(perMonth),
    m3: String(perMonth),
    m4: String(perMonth),
    m5: String(perMonth),
    m6: String(perMonth),
    m7: String(perMonth),
    m8: String(perMonth),
    m9: String(perMonth),
    m10: String(perMonth),
    m11: String(perMonth),
    m12: String(perMonth + rem),
  };
}

/**
 * 依據上方設定的「預算編號組成格式」與「年度、單位代碼、會計科目代碼、項次序號」組合成基礎預算編號
 */
export function formatBudgetCodeByConfig(params: {
  format: CodeFormatConfig;
  fiscalYear: string;
  unitCode: string;
  itemCode: string;
  seqIndex: number; // 0-based
}): string {
  const rawFy = params.fiscalYear.trim() || '116';
  const rocYear =
    rawFy.length === 4 && Number(rawFy) > 1911
      ? String(Number(rawFy) - 1911)
      : rawFy;
  const unit = params.unitCode.trim().toUpperCase();
  const item = (params.itemCode.trim() || 'SE99').toUpperCase();
  const seqStr = String(params.seqIndex + 1).padStart(2, '0');
  if (!unit) return '';

  const sep = params.format.separator;
  const pfx = params.format.prefix.trim().toUpperCase();

  // 若單位代碼本身已經以相同民國年開頭（例如 115BD001 且年度為 115），在無分隔符標準模式下避免重複疊加 115115
  const unitStartsWithSameYear =
    sep === '' &&
    params.format.pattern === 'YEAR_UNIT_ITEM' &&
    unit.startsWith(rocYear) &&
    /^\d{3}[A-Z]/i.test(unit);

  let core = '';
  switch (params.format.pattern) {
    case 'YEAR_UNIT_ITEM':
      core = unitStartsWithSameYear
        ? [unit, item].join(sep)
        : [rocYear, unit, item].filter(Boolean).join(sep);
      break;
    case 'YEAR_UNIT_ITEM_SEQ':
      core = [rocYear, unit, item, seqStr].filter(Boolean).join(sep);
      break;
    case 'YEAR_UNIT_SEQ':
      core = [rocYear, unit, seqStr].filter(Boolean).join(sep);
      break;
    case 'UNIT_YEAR_ITEM':
      core = [unit, rocYear, item].filter(Boolean).join(sep);
      break;
  }

  return pfx ? `${pfx}${sep}${core}` : core;
}

/**
 * 針對整張預算表的所有項次重新計算預算編號，並嚴格確保每一列的編號在「表內」與「跨單位」皆為 100% 唯一值、絕不重複
 */
function recomputeAllRowCodesGuaranteedUnique(
  inputRows: SheetRow[],
  format: CodeFormatConfig,
  fiscalYear: string,
  prevFiscalYear: string,
  unitCode: string,
  otherUnitCodeSet: Set<string>
): SheetRow[] {
  const usedCurrCodes = new Set<string>();
  const usedPrevCodes = new Set<string>();

  return inputRows.map((row, idx) => {
    const baseCurr = formatBudgetCodeByConfig({
      format,
      fiscalYear,
      unitCode,
      itemCode: row.itemCode,
      seqIndex: idx,
    });

    let uniqueCurr = baseCurr;
    if (uniqueCurr) {
      let suffixNum = 2;
      while (
        usedCurrCodes.has(uniqueCurr.toUpperCase()) ||
        otherUnitCodeSet.has(uniqueCurr.toUpperCase())
      ) {
        const sep = format.separator || '-';
        uniqueCurr = `${baseCurr}${sep}${String(suffixNum).padStart(2, '0')}`;
        suffixNum += 1;
      }
      usedCurrCodes.add(uniqueCurr.toUpperCase());
    }

    const basePrev = formatBudgetCodeByConfig({
      format,
      fiscalYear: prevFiscalYear,
      unitCode,
      itemCode: row.itemCode,
      seqIndex: idx,
    });
    let uniquePrev = basePrev;
    if (uniquePrev) {
      let suffixNum = 2;
      while (
        usedPrevCodes.has(uniquePrev.toUpperCase()) ||
        uniquePrev.toUpperCase() === uniqueCurr.toUpperCase()
      ) {
        const sep = format.separator || '-';
        uniquePrev = `${basePrev}${sep}${String(suffixNum).padStart(2, '0')}`;
        suffixNum += 1;
      }
      usedPrevCodes.add(uniquePrev.toUpperCase());
    }

    return {
      ...row,
      code: uniqueCurr,
      prevYearCode: uniquePrev,
    };
  });
}

export function BudgetSheetsBuilder({
  budgetCodes,
  departments,
  projects,
  employeesByDepartment,
  externalFormatConfig,
  externalFiscalYear,
  onExternalFiscalYearChange,
  externalDeptCode,
  onExternalDeptCodeChange,
  externalProjCode,
  onExternalProjCodeChange,
}: {
  budgetCodes: BudgetCodeListItem[];
  departments: DepartmentOption[];
  projects: ProjectListItem[];
  employeesByDepartment: {
    deptId: string;
    deptLabel: string;
    members: EmployeeOption[];
  }[];
  externalFormatConfig?: CodeFormatConfig;
  externalFiscalYear?: string;
  onExternalFiscalYearChange?: (fy: string) => void;
  externalDeptCode?: string;
  onExternalDeptCodeChange?: (code: string) => void;
  externalProjCode?: string;
  onExternalProjCodeChange?: (code: string) => void;
}) {
  const router = useRouter();

  // 預設進來是「預覽模式 (preview)」
  const [viewMode, setViewMode] = useState<BuilderViewMode>('preview');
  const [sheetType, setSheetType] = useState<SheetBuilderTab>('department');
  const [varianceScope, setVarianceScope] = useState<'department' | 'project'>(
    'department'
  );
  const [showStandardTable, setShowStandardTable] = useState(false);

  // 預算編號組成格式與表單設定狀態（與頁籤 1「定義編輯」共用）
  const [internalFormatConfig] = useState<CodeFormatConfig>({
    pattern: 'YEAR_UNIT_ITEM',
    separator: '',
    prefix: '',
  });
  const formatConfig = externalFormatConfig ?? internalFormatConfig;

  const [internalFiscalYear, setInternalFiscalYear] = useState('116');
  const fiscalYear = externalFiscalYear ?? internalFiscalYear;
  const setFiscalYear = (fy: string) => {
    setInternalFiscalYear(fy);
    onExternalFiscalYearChange?.(fy);
  };

  const [internalDeptCode, setInternalDeptCode] = useState<string>(
    () => departments[0]?.code ?? 'AD'
  );
  const selectedDeptCode = externalDeptCode ?? internalDeptCode;
  const setSelectedDeptCode = (code: string) => {
    setInternalDeptCode(code);
    onExternalDeptCodeChange?.(code);
  };

  const [internalProjCode, setInternalProjCode] = useState<string>(
    () => projects[0]?.code ?? ''
  );
  const selectedProjCode = externalProjCode ?? internalProjCode;
  const setSelectedProjCode = (code: string) => {
    setInternalProjCode(code);
    onExternalProjCodeChange?.(code);
  };
  const [ownerEmployeeCode, setOwnerEmployeeCode] = useState<string>('');
  const [batchDefaultAmount, setBatchDefaultAmount] = useState<string>('100000');

  // 步驟 2：預算項次明細與滑鼠拖拉排序狀態
  const [showMonthlyCols, setShowMonthlyCols] = useState<boolean>(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const effectiveScope: 'department' | 'project' =
    sheetType === 'department'
      ? 'department'
      : sheetType === 'project'
        ? 'project'
        : varianceScope;

  const unitCode =
    effectiveScope === 'department' ? selectedDeptCode : selectedProjCode;

  const prevFiscalYear = useMemo(() => {
    const n = Number(fiscalYear.trim());
    return Number.isFinite(n) ? String(n - 1) : '115';
  }, [fiscalYear]);

  const formatProjectOptionLabel = (p: ProjectListItem) => {
    const cleanName = p.name.startsWith(p.code)
      ? p.name.slice(p.code.length).replace(/^[｜|\s-]+/, '').trim()
      : p.name;
    return cleanName ? `${p.code}｜${cleanName}` : p.code;
  };

  // 非本單位同年度已佔用之預算編號集合（用於自動生成編號時避開衝突，保證唯一）
  const otherUnitCodeMap = useMemo(() => {
    const map = new Map<string, BudgetCodeListItem>();
    for (const b of budgetCodes) {
      const isSameUnitAndYear =
        effectiveScope === 'department'
          ? b.departmentCode === unitCode && b.fiscalYear === fiscalYear.trim()
          : b.projectCode === unitCode && b.fiscalYear === fiscalYear.trim();
      if (!isSameUnitAndYear) {
        map.set(b.code.trim().toUpperCase(), b);
      }
    }
    return map;
  }, [budgetCodes, effectiveScope, unitCode, fiscalYear]);

  const otherUnitCodeSet = useMemo(
    () => new Set<string>(otherUnitCodeMap.keys()),
    [otherUnitCodeMap]
  );

  // 當切換專案時，若既有預算編號已有設定該專案的負責人則自動帶入
  useEffect(() => {
    if (effectiveScope !== 'project' || !selectedProjCode) {
      setOwnerEmployeeCode('');
      return;
    }
    const existingWithOwner = budgetCodes.find(
      (b) => b.projectCode === selectedProjCode && b.ownerEmployeeCode
    );
    if (existingWithOwner?.ownerEmployeeCode) {
      setOwnerEmployeeCode(existingWithOwner.ownerEmployeeCode);
    }
  }, [effectiveScope, selectedProjCode, budgetCodes]);

  // 依據目前選擇的「表單類型 + 年度 + 部門/專案 + 編號組成格式」建構標準科目項次，並確保預算編號 100% 唯一不重複
  const buildDefaultRows = () => {
    const fy = fiscalYear.trim() || '116';
    const prevFy = prevFiscalYear;
    const pool =
      effectiveScope === 'department'
        ? DEPARTMENT_ACCOUNT_CATEGORIES
        : PROJECT_ACCOUNT_CATEGORIES;

    const unitCurrCodes = budgetCodes.filter(
      (b) =>
        b.fiscalYear === fy &&
        (effectiveScope === 'department'
          ? b.departmentCode === unitCode
          : b.projectCode === unitCode)
    );
    const unitPrevCodes = budgetCodes.filter(
      (b) =>
        b.fiscalYear === prevFy &&
        (effectiveScope === 'department'
          ? b.departmentCode === unitCode
          : b.projectCode === unitCode)
    );

    const rawRows: SheetRow[] = pool.map((cat, idx) => {
      const expectedCode = formatBudgetCodeByConfig({
        format: formatConfig,
        fiscalYear: fy,
        unitCode,
        itemCode: cat.itemCode,
        seqIndex: idx,
      });
      const expectedPrevCode = formatBudgetCodeByConfig({
        format: formatConfig,
        fiscalYear: prevFy,
        unitCode,
        itemCode: cat.itemCode,
        seqIndex: idx,
      });

      // 只以精確預算編號比對該科目既有金額，絕不拿其他科目的舊編號覆蓋本列編號，徹底杜絕自動生成重複預算編號！
      const matchedCurr =
        unitCurrCodes.find(
          (b) => b.code.trim().toUpperCase() === expectedCode.toUpperCase()
        ) ?? null;
      const matchedPrev =
        unitPrevCodes.find(
          (b) => b.code.trim().toUpperCase() === expectedPrevCode.toUpperCase()
        ) ?? null;

      const currAmt = matchedCurr?.annualBudgetAmount ?? 0;
      const prevAmt = matchedPrev?.annualBudgetAmount ?? 0;
      const months = splitToMonths(currAmt);

      return {
        rowId: `${cat.itemCode}-${idx}`,
        itemCode: cat.itemCode,
        accountNumber: cat.accountNumber,
        category: cat.categoryName,
        code: expectedCode,
        prevYearCode: expectedPrevCode,
        ...months,
        annualBudgetAmount: currAmt > 0 ? String(currAmt) : '',
        prevApprovedAmount: prevAmt > 0 ? String(prevAmt) : '',
        prevActualAmount: prevAmt > 0 ? String(prevAmt) : '',
        note: cat.description,
      };
    });

    const uniqueRows = recomputeAllRowCodesGuaranteedUnique(
      rawRows,
      formatConfig,
      fy,
      prevFy,
      unitCode,
      otherUnitCodeSet
    );
    setRows(uniqueRows);
  };

  useEffect(() => {
    buildDefaultRows();
    setError(null);
    setSuccessMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetType, varianceScope, fiscalYear, selectedDeptCode, selectedProjCode]);

  // 當使用者在編輯模式更動「預算編號組成格式 (formatConfig)」時，立即依新格式重新計算所有項次的唯一預算編號
  useEffect(() => {
    setRows((prev) =>
      recomputeAllRowCodesGuaranteedUnique(
        prev,
        formatConfig,
        fiscalYear.trim() || '116',
        prevFiscalYear,
        unitCode,
        otherUnitCodeSet
      )
    );
  }, [formatConfig, fiscalYear, prevFiscalYear, unitCode, otherUnitCodeSet]);

  const updateRowField = (
    idx: number,
    field: keyof SheetRow,
    rawVal: string
  ) => {
    setRows((prev) => {
      const updated = prev.map((r, i) => {
        if (i !== idx) return r;
        const next: SheetRow = { ...r, [field]: rawVal };

        if (field === 'category') {
          const std = findStandardAccountCategory(rawVal);
          if (std) {
            next.itemCode = std.itemCode;
            next.accountNumber = std.accountNumber;
            next.note = r.note || std.description;
          }
        }

        if ((MONTH_KEYS as readonly string[]).includes(field)) {
          let sum = 0;
          let hasAny = false;
          for (const mk of MONTH_KEYS) {
            const v = next[mk].replace(/,/g, '').trim();
            if (v !== '') {
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0) {
                sum += n;
                hasAny = true;
              }
            }
          }
          next.annualBudgetAmount = hasAny ? String(sum) : '';
        }

        return next;
      });

      // 若變更的是會計科目 (category) 或科目代碼 (itemCode)，自動依格式重新計算全表唯一預算編號
      if (field === 'category' || field === 'itemCode') {
        return recomputeAllRowCodesGuaranteedUnique(
          updated,
          formatConfig,
          fiscalYear.trim() || '116',
          prevFiscalYear,
          unitCode,
          otherUnitCodeSet
        );
      }
      return updated;
    });
  };

  const distributeAnnualToMonths = (idx: number) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const amt = parseAmount(r.annualBudgetAmount);
        if (amt <= 0) return r;
        return {
          ...r,
          ...splitToMonths(amt),
        };
      })
    );
  };

  // 一鍵將預設初始預算額套用至目前表內尚未填寫金額（或全部）的項次
  const applyDefaultAmountToRows = (onlyEmpty: boolean) => {
    const amt = parseAmount(batchDefaultAmount);
    if (amt <= 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (onlyEmpty && parseAmount(r.annualBudgetAmount) > 0) return r;
        return {
          ...r,
          ...splitToMonths(amt),
          annualBudgetAmount: String(amt),
        };
      })
    );
  };

  // 編輯模式底下「新增科目項次」：自動挑選尚未使用的科目或自動產生下一個不重複的科目代碼與預算編號
  const addCustomRow = () => {
    setRows((prev) => {
      const usedItemCodes = new Set(
        prev.map((r) => r.itemCode.trim().toUpperCase())
      );
      const pool =
        effectiveScope === 'department'
          ? DEPARTMENT_ACCOUNT_CATEGORIES
          : PROJECT_ACCOUNT_CATEGORIES;

      const unusedStd = pool.find(
        (c) => !usedItemCodes.has(c.itemCode.toUpperCase())
      );

      let nextItemCode = unusedStd?.itemCode ?? '';
      const nextAccountNo = unusedStd?.accountNumber ?? '69002501';
      const nextCategoryName = unusedStd?.categoryName ?? '自訂預算科目';
      const nextDesc =
        unusedStd?.description ?? '新增自訂會計科目預算項次';

      if (!nextItemCode) {
        // 當標準科目皆已在表內時，自動遞增產生不重複之科目代碼（如 SE24, SE25...）
        let num = 24;
        while (usedItemCodes.has(`SE${String(num).padStart(2, '0')}`)) {
          num += 1;
          if (num === 99) num = 100;
        }
        nextItemCode = `SE${String(num).padStart(2, '0')}`;
      }

      const newRow: SheetRow = {
        rowId: `custom-${Date.now()}-${prev.length + 1}`,
        itemCode: nextItemCode,
        accountNumber: nextAccountNo,
        category: nextCategoryName,
        code: '',
        prevYearCode: '',
        m1: '',
        m2: '',
        m3: '',
        m4: '',
        m5: '',
        m6: '',
        m7: '',
        m8: '',
        m9: '',
        m10: '',
        m11: '',
        m12: '',
        annualBudgetAmount: '',
        prevApprovedAmount: '',
        prevActualAmount: '',
        note: nextDesc,
      };

      return recomputeAllRowCodesGuaranteedUnique(
        [...prev, newRow],
        formatConfig,
        fiscalYear.trim() || '116',
        prevFiscalYear,
        unitCode,
        otherUnitCodeSet
      );
    });
  };

  const removeRow = (idx: number) => {
    setRows((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      return recomputeAllRowCodesGuaranteedUnique(
        filtered,
        formatConfig,
        fiscalYear.trim() || '116',
        prevFiscalYear,
        unitCode,
        otherUnitCodeSet
      );
    });
  };

  // 滑鼠上下拖拉調整項次順序 (HTML5 Drag & Drop)
  const handleDragStart = (idx: number) => {
    if (viewMode !== 'edit') return;
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    if (viewMode !== 'edit') return;
    e.preventDefault();
    if (dragOverIdx !== idx) {
      setDragOverIdx(idx);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    if (viewMode !== 'edit') return;
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedIdx, 1);
      if (!moved) return prev;
      next.splice(targetIdx, 0, moved);
      return recomputeAllRowCodesGuaranteedUnique(
        next,
        formatConfig,
        fiscalYear.trim() || '116',
        prevFiscalYear,
        unitCode,
        otherUnitCodeSet
      );
    });

    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const moveRowByStep = (idx: number, delta: -1 | 1) => {
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      if (!moved) return prev;
      next.splice(targetIdx, 0, moved);
      return recomputeAllRowCodesGuaranteedUnique(
        next,
        formatConfig,
        fiscalYear.trim() || '116',
        prevFiscalYear,
        unitCode,
        otherUnitCodeSet
      );
    });
  };

  const totalAnnualBudget = useMemo(
    () => rows.reduce((sum, r) => sum + parseAmount(r.annualBudgetAmount), 0),
    [rows]
  );

  const totalPrevApproved = useMemo(
    () => rows.reduce((sum, r) => sum + parseAmount(r.prevApprovedAmount), 0),
    [rows]
  );

  const totalPrevActual = useMemo(
    () => rows.reduce((sum, r) => sum + parseAmount(r.prevActualAmount), 0),
    [rows]
  );

  const sheetTitle =
    sheetType === 'department'
      ? '部門預算表'
      : sheetType === 'project'
        ? '專案預算表（營收／產品專案預算表）'
        : '預算差異分析表';

  const examplePreviewCode = useMemo(
    () =>
      formatBudgetCodeByConfig({
        format: formatConfig,
        fiscalYear: fiscalYear.trim() || '116',
        unitCode: unitCode || 'AD',
        itemCode: rows[0]?.itemCode || 'SE01',
        seqIndex: 0,
      }),
    [formatConfig, fiscalYear, unitCode, rows]
  );

  const handleSaveSheet = async () => {
    setError(null);
    setSuccessMsg(null);

    if (!unitCode) {
      setError(
        effectiveScope === 'department'
          ? '請先選擇目標部門'
          : '請先選擇目標專案'
      );
      return;
    }

    // 檢查表內與跨單位預算編號唯一值
    const seenInTable = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const c = r.code.trim().toUpperCase();
      if (!c) {
        if (parseAmount(r.annualBudgetAmount) > 0) {
          setError(`第 ${i + 1} 項次已填寫金額，但「預算編號」為空白`);
          return;
        }
        continue;
      }
      const dupIdx = seenInTable.get(c);
      if (dupIdx !== undefined) {
        setError(
          `第 ${i + 1} 項次預算編號「${r.code.trim()}」與第 ${dupIdx + 1} 項次重複，預算編號必須為唯一值！`
        );
        return;
      }
      seenInTable.set(c, i);

      const conflictOther = otherUnitCodeMap.get(c);
      if (conflictOther && parseAmount(r.annualBudgetAmount) > 0) {
        setError(
          `第 ${i + 1} 項次預算編號「${r.code.trim()}」已被「${conflictOther.departmentName || conflictOther.projectName || '其他單位'}（${conflictOther.fiscalYear} 年度）」使用，預算編號必須為唯一值！`
        );
        return;
      }
    }

    const payloadRows = rows
      .filter(
        (r) =>
          parseAmount(r.annualBudgetAmount) > 0 ||
          (sheetType === 'variance' && parseAmount(r.prevActualAmount) > 0)
      )
      .map((r) => ({
        code: r.code.trim(),
        category: r.category.trim(),
        annualBudgetAmount: parseAmount(r.annualBudgetAmount),
        prevYearCode:
          sheetType === 'variance' ? r.prevYearCode.trim() : undefined,
        prevActualAmount:
          sheetType === 'variance'
            ? parseAmount(r.prevActualAmount)
            : undefined,
      }));

    if (payloadRows.length === 0) {
      setError(
        '請至少在一個預算項次填寫大於 0 的預算金額（或在編輯模式使用「套用預設初始預算額」）後再儲存'
      );
      return;
    }

    setSaving(true);
    const res = await saveBudgetSheetRows({
      sheetType,
      fiscalYear: fiscalYear.trim() || '116',
      departmentCode:
        effectiveScope === 'department' ? selectedDeptCode : null,
      projectCode: effectiveScope === 'project' ? selectedProjCode : null,
      ownerEmployeeCode:
        effectiveScope === 'project' ? ownerEmployeeCode || null : null,
      rows: payloadRows,
    });
    setSaving(false);

    if (res.ok) {
      setSuccessMsg(
        `✅ 已成功儲存《${sheetTitle}》：共儲存 ${res.savedCount} 筆唯一預算編號！`
      );
      setViewMode('preview');
      router.refresh();
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="space-y-4">
      {/* ==================== 「預算編列表與預算分析」子頁籤列（位於最上方，獨立於步驟一之外） ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'department', label: '🏢 部門預算表' },
              { id: 'project', label: '🚀 專案預算表' },
              { id: 'variance', label: '📊 預算差異分析表' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSheetType(tab.id)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                sheetType === tab.id
                  ? 'bg-td-blue text-white shadow-xs'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setShowStandardTable((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            {showStandardTable
              ? '隱藏會計科目對照表'
              : '📖 檢視標準會計科目對照表（25 項）'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* 預覽模式 / 編輯模式 切換器 */}
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={`rounded-md px-3.5 py-1.5 transition ${
                viewMode === 'preview'
                  ? 'bg-white text-td-blue shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👁️ 預覽模式
            </button>
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className={`rounded-md px-3.5 py-1.5 transition ${
                viewMode === 'edit'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✏️ 編輯模式（拖拉項次順序／新增科目）
            </button>
          </div>
        </div>
      </div>

      {showStandardTable && (
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-slate-600">
                <th className="py-1.5 pr-2">科目代碼</th>
                <th className="py-1.5 pr-2">會計科目編號</th>
                <th className="py-1.5 pr-2">會計科目名稱</th>
                <th className="py-1.5 pr-2">適用範圍</th>
                <th className="py-1.5 pr-2">說明</th>
              </tr>
            </thead>
            <tbody>
              {STANDARD_ACCOUNT_CATEGORIES.map((cat) => (
                <tr
                  key={cat.itemCode}
                  className="border-b border-slate-200/70"
                >
                  <td className="py-1.5 pr-2 font-mono font-semibold text-blue-700">
                    {cat.itemCode}
                  </td>
                  <td className="py-1.5 pr-2 font-mono">
                    {cat.accountNumber}
                  </td>
                  <td className="py-1.5 pr-2 font-medium">
                    {cat.categoryName}
                  </td>
                  <td className="py-1.5 pr-2">
                    {cat.applicableTo === 'project'
                      ? '專案專用'
                      : '部門／專案通用'}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-600">
                    {cat.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
      {/* ==================== 標題列與編列設計目標選擇列 ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md px-2.5 py-0.5 text-xs font-semibold ${
                viewMode === 'edit'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-blue-50 text-td-blue'
              }`}
            >
              {viewMode === 'edit' ? '✏️ 目前為編輯模式（可拖拉項次順序／新增科目）' : '👁️ 目前為預覽模式（預設）'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              編號範例：{examplePreviewCode}
            </span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-td-blue-dark">
            編列組合：{sheetTitle}（直接調整項次、滑鼠拖拉順序與新增會計科目）
          </h2>
        </div>
      </div>

      {/* 目標年度與部門／專案快速選擇列 */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs">
          <span className="font-semibold text-slate-700">
            預算年度（民國年，如 116）
          </span>
          <input
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold"
          />
        </label>

        {sheetType === 'variance' && (
          <label className="block text-xs">
            <span className="font-semibold text-slate-700">
              差異分析對象類型
            </span>
            <select
              value={varianceScope}
              onChange={(e) =>
                setVarianceScope(e.target.value as 'department' | 'project')
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              <option value="department">部門預算差異分析</option>
              <option value="project">專案預算差異分析</option>
            </select>
          </label>
        )}

        {effectiveScope === 'department' ? (
          <label className="block text-xs">
            <span className="font-semibold text-slate-700">
              部門代碼／部門名稱
            </span>
            <select
              value={selectedDeptCode}
              onChange={(e) => setSelectedDeptCode(e.target.value)}
              aria-label="部門代碼／部門名稱"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.code}>
                  {d.code}｜{d.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="block text-xs">
              <span className="font-semibold text-slate-700">
                專案代碼／專案名稱
              </span>
              <select
                value={selectedProjCode}
                onChange={(e) => setSelectedProjCode(e.target.value)}
                aria-label="專案代碼／專案名稱"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.code}>
                    {formatProjectOptionLabel(p)}
                  </option>
                ))}
              </select>
            </label>

            {Boolean(selectedProjCode) && (
              <label className="block text-xs">
                <span className="font-semibold text-slate-700">
                  負責人（依部門分類）
                </span>
                <select
                  value={ownerEmployeeCode}
                  onChange={(e) => setOwnerEmployeeCode(e.target.value)}
                  aria-label="專案預算負責人"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="">（請選擇專案負責人）</option>
                  {employeesByDepartment.map((group) => (
                    <optgroup key={group.deptId} label={group.deptLabel}>
                      {group.members.map((emp) => (
                        <option key={emp.id} value={emp.employeeCode}>
                          {emp.name}（{emp.employeeCode}）
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {viewMode === 'edit' && (
          <div className="flex items-end gap-1.5 text-xs">
            <label className="flex-1">
              <span className="font-semibold text-slate-700">
                預設每科目初始預算額
              </span>
              <input
                type="number"
                min={0}
                value={batchDefaultAmount}
                onChange={(e) =>
                  setBatchDefaultAmount(e.target.value.replace(/[-－]/g, ''))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => applyDefaultAmountToRows(true)}
              className="shrink-0 rounded-lg border border-blue-600 bg-white px-2.5 py-2 font-semibold text-blue-700 hover:bg-blue-50"
              title="將預設金額填入目前金額為 0 的科目項次"
            >
              套用至空白項次
            </button>
          </div>
        )}
      </div>

      {/* ==================== 預算項次與順序編列設計表（預覽模式 vs 編輯模式 + 滑鼠拖拉排序 + 底下新增科目） ==================== */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-td-blue text-xs font-bold text-white">
              2
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                步驟二：{sheetTitle}預算項次明細（共 {rows.length} 項次｜年度總計：
                <span className="font-mono text-td-blue">
                  NT$ {totalAnnualBudget.toLocaleString()}
                </span>
                ）
              </h3>
              <p className="text-xs text-slate-500">
                {viewMode === 'edit'
                  ? '💡 編輯模式：可用滑鼠按住左側「⠿」上下拖拉調整項次順序，並可於表格底下新增科目或修改金額。'
                  : '💡 預覽模式：檢視依上方格式自動生成之預算項次與唯一預算編號；如需新增科目或拖拉調整項次順序，請切換至「編輯模式」。'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {sheetType !== 'variance' && (
              <button
                type="button"
                onClick={() => setShowMonthlyCols((v) => !v)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                {showMonthlyCols
                  ? '收合 1～12 月分月欄'
                  : '展開 1～12 月分月欄'}
              </button>
            )}
            {viewMode === 'edit' && (
              <>
                <button
                  type="button"
                  onClick={addCustomRow}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  ＋ 新增科目項次
                </button>
                <button
                  type="button"
                  onClick={buildDefaultRows}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  重置為預設標準項次
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
            {successMsg}
          </div>
        )}

        {/* ==================== 表格本體（支援預覽模式 & 編輯模式滑鼠拖拉排序） ==================== */}
        {sheetType !== 'variance' ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[880px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-left font-semibold text-slate-700">
                  <th className="w-20 border-r border-slate-200 px-2.5 py-2.5 text-center">
                    {viewMode === 'edit' ? '拖拉 / 項次' : '項次'}
                  </th>
                  <th className="w-56 border-r border-slate-200 px-3 py-2.5">
                    會計科目（代碼／名稱）
                  </th>
                  <th className="w-44 border-r border-slate-200 px-3 py-2.5">
                    預算編號（唯一值）
                  </th>
                  {showMonthlyCols &&
                    MONTH_KEYS.map((mk, mIdx) => (
                      <th
                        key={mk}
                        className="w-24 border-r border-slate-200 px-2 py-2.5 text-right whitespace-nowrap"
                      >
                        {mIdx + 1}月
                      </th>
                    ))}
                  <th className="w-44 border-r border-slate-200 bg-blue-50/70 px-3 py-2.5 text-right">
                    {fiscalYear} 年度預算合計
                  </th>
                  <th className="min-w-[200px] px-3 py-2.5">編列說明／備註</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r, idx) => {
                  const codeUpper = r.code.trim().toUpperCase();
                  const dupInTableIdx = codeUpper
                    ? rows.findIndex(
                        (other, oIdx) =>
                          oIdx !== idx &&
                          other.code.trim().toUpperCase() === codeUpper
                      )
                    : -1;
                  const conflictOtherUnit = codeUpper
                    ? otherUnitCodeMap.get(codeUpper)
                    : undefined;
                  const hasCodeConflict =
                    dupInTableIdx !== -1 || Boolean(conflictOtherUnit);
                  const isDragging = draggedIdx === idx;
                  const isDragOver = dragOverIdx === idx && draggedIdx !== idx;

                  return (
                    <tr
                      key={r.rowId}
                      draggable={viewMode === 'edit'}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`transition ${
                        isDragging
                          ? 'bg-blue-50 opacity-60'
                          : isDragOver
                            ? 'border-t-2 border-t-blue-600 bg-blue-50/60'
                            : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* 項次與滑鼠上下拖拉把手 */}
                      <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-600">
                        {viewMode === 'edit' ? (
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="flex cursor-grab items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 hover:bg-blue-100 hover:text-blue-800 active:cursor-grabbing"
                              title="按住滑鼠上下拖拉調整此項次位置"
                            >
                              <span className="text-sm leading-none select-none">
                                ⠿
                              </span>
                              <span>{idx + 1}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              <button
                                type="button"
                                onClick={() => moveRowByStep(idx, -1)}
                                disabled={idx === 0}
                                className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                title="上移一列"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRowByStep(idx, 1)}
                                disabled={idx === rows.length - 1}
                                className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                                title="下移一列"
                              >
                                ▼
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRow(idx)}
                                className="text-red-500 hover:underline"
                                title="刪除此項次"
                              >
                                刪除
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="font-semibold text-slate-700">
                            {idx + 1}
                          </span>
                        )}
                      </td>

                      {/* 會計科目 */}
                      <td className="border-r border-slate-200 px-3 py-2">
                        {viewMode === 'edit' ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={r.itemCode}
                                onChange={(e) =>
                                  updateRowField(
                                    idx,
                                    'itemCode',
                                    e.target.value.toUpperCase()
                                  )
                                }
                                className="w-16 rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-blue-700"
                                title="科目代碼（如 SE01）"
                              />
                              <span className="font-mono text-[11px] text-slate-500">
                                ｜{r.accountNumber || '—'}
                              </span>
                            </div>
                            <select
                              value={r.category}
                              onChange={(e) =>
                                updateRowField(idx, 'category', e.target.value)
                              }
                              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800"
                            >
                              {STANDARD_ACCOUNT_CATEGORIES.map((c) => (
                                <option key={c.itemCode} value={c.categoryName}>
                                  {c.itemCode}｜{c.categoryName}
                                </option>
                              ))}
                              {!STANDARD_ACCOUNT_CATEGORIES.some(
                                (c) => c.categoryName === r.category
                              ) && (
                                <option value={r.category}>
                                  {r.itemCode}｜{r.category}
                                </option>
                              )}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <div className="font-mono text-[11px] font-semibold text-blue-700">
                              {r.itemCode}｜{r.accountNumber || '—'}
                            </div>
                            <div className="mt-0.5 font-semibold text-slate-900">
                              {r.category}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 預算編號（唯一值） */}
                      <td className="border-r border-slate-200 px-3 py-2 align-middle">
                        {viewMode === 'edit' ? (
                          <div>
                            <input
                              value={r.code}
                              onChange={(e) =>
                                updateRowField(idx, 'code', e.target.value)
                              }
                              placeholder="如 116ADSE01"
                              className={`w-full rounded border px-2 py-1 font-mono text-xs font-semibold ${
                                hasCodeConflict
                                  ? 'border-red-500 bg-red-50 text-red-900'
                                  : 'border-slate-300 bg-white text-slate-900'
                              }`}
                            />
                            {dupInTableIdx !== -1 && (
                              <p className="mt-1 text-[11px] font-medium text-red-600">
                                ⚠️ 與第 {dupInTableIdx + 1} 項次重複（須為唯一值）
                              </p>
                            )}
                            {conflictOtherUnit && (
                              <p className="mt-1 text-[11px] font-medium text-red-600">
                                ⚠️ 已被「
                                {conflictOtherUnit.departmentName ||
                                  conflictOtherUnit.projectName}
                                」使用
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="inline-block rounded-md border border-blue-200 bg-blue-50/70 px-2.5 py-1 font-mono text-xs font-bold text-td-blue-dark">
                            {r.code}
                          </span>
                        )}
                      </td>

                      {/* 1~12月分月欄 */}
                      {showMonthlyCols &&
                        MONTH_KEYS.map((mk) => (
                          <td
                            key={mk}
                            className="border-r border-slate-200 px-2 py-1.5 text-right font-mono tabular-nums align-middle"
                          >
                            {viewMode === 'edit' ? (
                              <input
                                type="number"
                                min={0}
                                value={r[mk]}
                                onChange={(e) =>
                                  updateRowField(
                                    idx,
                                    mk,
                                    e.target.value.replace(/[-－]/g, '')
                                  )
                                }
                                placeholder="0"
                                className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-right font-mono tabular-nums"
                              />
                            ) : (
                              <span className="text-slate-700">
                                {parseAmount(r[mk]) > 0
                                  ? parseAmount(r[mk]).toLocaleString()
                                  : '0'}
                              </span>
                            )}
                          </td>
                        ))}

                      {/* 年度預算合計 */}
                      <td className="border-r border-slate-200 bg-blue-50/30 px-3 py-2 text-right align-middle">
                        {viewMode === 'edit' ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              value={r.annualBudgetAmount}
                              onChange={(e) =>
                                updateRowField(
                                  idx,
                                  'annualBudgetAmount',
                                  e.target.value.replace(/[-－]/g, '')
                                )
                              }
                              placeholder="0"
                              className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-right font-mono font-semibold tabular-nums text-td-blue-dark"
                            />
                            {showMonthlyCols && (
                              <button
                                type="button"
                                onClick={() => distributeAnnualToMonths(idx)}
                                className="shrink-0 rounded border border-blue-200 bg-blue-50 px-1.5 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                                title="將年度預算合計平均分攤至 1～12 月"
                              >
                                均攤
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-sm font-bold tabular-nums text-td-blue-dark">
                            NT$ {parseAmount(r.annualBudgetAmount).toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* 編列說明 */}
                      <td className="px-3 py-2 align-middle">
                        {viewMode === 'edit' ? (
                          <input
                            value={r.note}
                            onChange={(e) =>
                              updateRowField(idx, 'note', e.target.value)
                            }
                            placeholder="填寫預算編列說明"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          />
                        ) : (
                          <span className="text-slate-600">{r.note}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-900">
                  <td
                    colSpan={showMonthlyCols ? 15 : 3}
                    className="border-r border-slate-200 px-3 py-2.5 text-right"
                  >
                    {sheetTitle} 年度總計（共 {rows.length} 項次）：
                  </td>
                  <td className="border-r border-slate-200 bg-blue-100/60 px-3 py-2.5 text-right font-mono text-sm tabular-nums text-td-blue-dark">
                    NT$ {totalAnnualBudget.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          /* ==================== 表單 3：預算差異分析表（預覽與編輯模式） ==================== */
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1040px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100 text-left font-semibold text-slate-700">
                  <th className="w-20 border-r border-slate-200 px-2 py-2.5 text-center">
                    {viewMode === 'edit' ? '拖拉 / 項次' : '項次'}
                  </th>
                  <th className="w-48 border-r border-slate-200 px-2.5 py-2.5">
                    會計科目
                  </th>
                  <th className="w-40 border-r border-slate-200 px-2.5 py-2.5">
                    {fiscalYear} 預算編號（唯一值）
                  </th>
                  <th className="w-32 border-r border-slate-200 px-2.5 py-2.5 text-right">
                    {prevFiscalYear} 核定預算 (A)
                  </th>
                  <th className="w-32 border-r border-slate-200 px-2.5 py-2.5 text-right">
                    {prevFiscalYear} 實際執行數 (B)
                  </th>
                  <th className="w-24 border-r border-slate-200 px-2 py-2.5 text-right">
                    達成率 (B/A)
                  </th>
                  <th className="w-36 border-r border-slate-200 bg-blue-50/70 px-2.5 py-2.5 text-right">
                    {fiscalYear} 編列預算 (C)
                  </th>
                  <th className="w-32 border-r border-slate-200 px-2.5 py-2.5 text-right">
                    增減差異 (C-B)
                  </th>
                  <th className="w-24 border-r border-slate-200 px-2 py-2.5 text-right">
                    成長率
                  </th>
                  <th className="min-w-[200px] px-2.5 py-2.5">
                    差異原因與分析說明（變動 ±10% 請詳述）
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r, idx) => {
                  const prevA = parseAmount(r.prevApprovedAmount);
                  const prevB = parseAmount(r.prevActualAmount);
                  const currC = parseAmount(r.annualBudgetAmount);
                  const achieveRate =
                    prevA > 0 ? ((prevB / prevA) * 100).toFixed(1) : null;
                  const diffCB = currC - prevB;
                  const growthRate =
                    prevB > 0 ? ((diffCB / prevB) * 100).toFixed(1) : null;
                  const isSignificantDiff =
                    growthRate !== null && Math.abs(Number(growthRate)) >= 10;
                  const isDragging = draggedIdx === idx;
                  const isDragOver = dragOverIdx === idx && draggedIdx !== idx;

                  return (
                    <tr
                      key={r.rowId}
                      draggable={viewMode === 'edit'}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`transition ${
                        isDragging
                          ? 'bg-blue-50 opacity-60'
                          : isDragOver
                            ? 'border-t-2 border-t-blue-600 bg-blue-50/60'
                            : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="border-r border-slate-200 px-2 py-2 text-center font-mono text-slate-600">
                        {viewMode === 'edit' ? (
                          <div className="flex flex-col items-center gap-1">
                            <div
                              className="flex cursor-grab items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 hover:bg-blue-100"
                              title="按住滑鼠上下拖拉調整此項次位置"
                            >
                              <span>⠿</span>
                              <span>{idx + 1}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeRow(idx)}
                              className="text-[10px] text-red-500 hover:underline"
                            >
                              刪除
                            </button>
                          </div>
                        ) : (
                          <span>{idx + 1}</span>
                        )}
                      </td>
                      <td className="border-r border-slate-200 p-2">
                        <div className="font-mono text-[11px] font-semibold text-blue-700">
                          {r.itemCode}｜{r.accountNumber}
                        </div>
                        <div className="font-medium text-slate-800">
                          {r.category}
                        </div>
                      </td>
                      <td className="border-r border-slate-200 p-2 font-mono font-semibold text-slate-900">
                        {viewMode === 'edit' ? (
                          <input
                            value={r.code}
                            onChange={(e) =>
                              updateRowField(idx, 'code', e.target.value)
                            }
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs font-semibold"
                          />
                        ) : (
                          <span className="rounded border border-blue-200 bg-blue-50/70 px-2 py-0.5 font-mono text-xs font-bold text-td-blue-dark">
                            {r.code}
                          </span>
                        )}
                      </td>
                      <td className="border-r border-slate-200 p-2 text-right font-mono tabular-nums">
                        {viewMode === 'edit' ? (
                          <input
                            type="number"
                            min={0}
                            value={r.prevApprovedAmount}
                            onChange={(e) =>
                              updateRowField(
                                idx,
                                'prevApprovedAmount',
                                e.target.value.replace(/[-－]/g, '')
                              )
                            }
                            placeholder="0"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono tabular-nums"
                          />
                        ) : (
                          <span>{prevA.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="border-r border-slate-200 p-2 text-right font-mono tabular-nums">
                        {viewMode === 'edit' ? (
                          <input
                            type="number"
                            min={0}
                            value={r.prevActualAmount}
                            onChange={(e) =>
                              updateRowField(
                                idx,
                                'prevActualAmount',
                                e.target.value.replace(/[-－]/g, '')
                              )
                            }
                            placeholder="0"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-right font-mono tabular-nums"
                          />
                        ) : (
                          <span>{prevB.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="border-r border-slate-200 px-2 py-2 text-right font-mono tabular-nums text-slate-600">
                        {achieveRate !== null ? `${achieveRate}%` : '—'}
                      </td>
                      <td className="border-r border-slate-200 bg-blue-50/30 p-2 text-right font-mono font-bold tabular-nums text-td-blue-dark">
                        {viewMode === 'edit' ? (
                          <input
                            type="number"
                            min={0}
                            value={r.annualBudgetAmount}
                            onChange={(e) =>
                              updateRowField(
                                idx,
                                'annualBudgetAmount',
                                e.target.value.replace(/[-－]/g, '')
                              )
                            }
                            placeholder="0"
                            className="w-full rounded border border-blue-300 bg-white px-2 py-1 text-right font-mono font-semibold tabular-nums text-td-blue-dark"
                          />
                        ) : (
                          <span>NT$ {currC.toLocaleString()}</span>
                        )}
                      </td>
                      <td
                        className={`border-r border-slate-200 px-2.5 py-2 text-right font-mono font-semibold tabular-nums ${
                          diffCB > 0
                            ? 'text-red-600'
                            : diffCB < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {diffCB > 0 ? '+' : ''}
                        {diffCB.toLocaleString()}
                      </td>
                      <td
                        className={`border-r border-slate-200 px-2 py-2 text-right font-mono font-semibold tabular-nums ${
                          isSignificantDiff
                            ? 'bg-amber-50 text-amber-800'
                            : 'text-slate-600'
                        }`}
                      >
                        {growthRate !== null
                          ? `${Number(growthRate) > 0 ? '+' : ''}${growthRate}%`
                          : '—'}
                      </td>
                      <td className="p-2">
                        {viewMode === 'edit' ? (
                          <input
                            value={r.note}
                            onChange={(e) =>
                              updateRowField(idx, 'note', e.target.value)
                            }
                            placeholder={
                              isSignificantDiff
                                ? '⚠️ 差異達 ±10% 以上，請填寫差異原因'
                                : '差異原因說明'
                            }
                            className={`w-full rounded border px-2 py-1 text-xs ${
                              isSignificantDiff
                                ? 'border-amber-400 bg-amber-50/40 text-slate-900'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                          />
                        ) : (
                          <span className="text-slate-600">{r.note}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-900">
                  <td
                    colSpan={3}
                    className="border-r border-slate-200 px-3 py-2.5 text-right"
                  >
                    差異分析總計（共 {rows.length} 項次）：
                  </td>
                  <td className="border-r border-slate-200 px-2.5 py-2.5 text-right font-mono tabular-nums">
                    NT$ {totalPrevApproved.toLocaleString()}
                  </td>
                  <td className="border-r border-slate-200 px-2.5 py-2.5 text-right font-mono tabular-nums">
                    NT$ {totalPrevActual.toLocaleString()}
                  </td>
                  <td className="border-r border-slate-200 px-2 py-2.5 text-right font-mono tabular-nums">
                    {totalPrevApproved > 0
                      ? `${((totalPrevActual / totalPrevApproved) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="border-r border-slate-200 bg-blue-100/60 px-2.5 py-2.5 text-right font-mono text-sm tabular-nums text-td-blue-dark">
                    NT$ {totalAnnualBudget.toLocaleString()}
                  </td>
                  <td className="border-r border-slate-200 px-2.5 py-2.5 text-right font-mono tabular-nums">
                    {totalAnnualBudget - totalPrevActual > 0 ? '+' : ''}
                    {(totalAnnualBudget - totalPrevActual).toLocaleString()}
                  </td>
                  <td className="border-r border-slate-200 px-2 py-2.5 text-right font-mono tabular-nums">
                    {totalPrevActual > 0
                      ? `${(((totalAnnualBudget - totalPrevActual) / totalPrevActual) * 100).toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* 編輯模式的底下：可新增科目與儲存按鈕區 */}
        {viewMode === 'edit' ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={addCustomRow}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
              >
                ➕ 在底下新增預算科目項次
              </button>
              <span className="text-xs text-slate-600">
                可點擊新增科目，或用滑鼠按住任一項次左側「⠿」上下拖拉調整項次順序。
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setViewMode('preview')}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                👁️ 切換回預覽模式
              </button>
              <button
                type="button"
                onClick={handleSaveSheet}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? '儲存寫入中…'
                  : `💾 儲存《${sheetTitle}》並寫入預算編號清冊`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => setViewMode('edit')}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              ✏️ 進入編輯模式（新增科目／滑鼠拖拉調整項次／更動編號格式）
            </button>
          </div>
        )}
      </div>
    </section>
    </div>
  );
}
