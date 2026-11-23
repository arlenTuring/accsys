'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  STANDARD_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { FieldDef } from '@/lib/custom-forms/schema';
import type { TableValue } from '@/lib/custom-forms/validate';
import { amountText } from './submission-fields';

type TableField = Extract<FieldDef, { type: 'table' }>;
type Row = Record<string, unknown>;

const MONTH_KEYS = [
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
] as const;

function parseNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sumMonths(row: Row): { sum: number; hasAny: boolean } {
  let sum = 0;
  let hasAny = false;
  for (const k of MONTH_KEYS) {
    const raw = String(row[k] ?? '').replace(/,/g, '').trim();
    if (raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        sum += n;
        hasAny = true;
      }
    }
  }
  return { sum, hasAny };
}

/** 判斷該列是否為使用者自行新增之會計科目（僅使用者新增之科目可更改會計科目與刪除；財會派發科目則鎖定） */
function isUserAddedRow(row: Row): boolean {
  return row.rowOrigin === 'user_added' || row.isUserAdded === true;
}

/** 取得該列標準化會計科目識別鍵（供跨年度科目對齊比對） */
function getSubjectMatchKey(row: Row): string {
  const std =
    findStandardAccountCategory(String(row.category ?? '')) ??
    findStandardAccountCategory(String(row.itemCode ?? ''));
  if (std) return std.itemCode;
  const cat = String(row.category ?? '').trim();
  if (cat) return `CAT:${cat}`;
  const code = String(row.code ?? '').trim();
  return `CODE:${code}`;
}

export function BudgetRequestItemsEditor({
  field,
  value,
  onChange,
  errors,
  options,
  fiscalYear,
  budgetScope,
  targetDepartmentId,
  targetProjectId,
}: {
  field: TableField;
  value: TableValue;
  onChange: (v: TableValue) => void;
  errors: Record<string, string>;
  options: PickerOptions;
  fiscalYear: string;
  budgetScope: string;
  targetDepartmentId: string;
  targetProjectId: string;
}) {
  const [viewMode, setViewMode] = useState<'monthly' | 'variance' | 'all'>(
    'monthly'
  );
  /** 在編列主表每一格內顯示「去年填寫資料」輔助抄寫對照（可隨時按按鈕開啟／隱藏） */
  const [showPrevYearInCells, setShowPrevYearInCells] = useState<boolean>(true);
  const [evenDistAmount, setEvenDistAmount] = useState<Record<number, string>>(
    {}
  );

  const selectedDept = useMemo(
    () => options.departments.find((d) => d.id === targetDepartmentId),
    [options.departments, targetDepartmentId]
  );
  const selectedProj = useMemo(
    () => options.projects.find((p) => p.id === targetProjectId),
    [options.projects, targetProjectId]
  );

  const unitCode = useMemo(() => {
    if (budgetScope === 'project') {
      if (selectedProj?.code) return selectedProj.code;
      const m = selectedProj?.label.match(/^([A-Za-z0-9_-]+)/);
      return m ? m[1]! : '';
    }
    if (selectedDept?.code) return selectedDept.code;
    const m = selectedDept?.label.match(/^([A-Za-z0-9&-]+)[｜|]/);
    return m ? m[1]! : '';
  }, [budgetScope, selectedDept, selectedProj]);

  const rocYear = useMemo(() => {
    const fy = (fiscalYear || '116').trim();
    const num = Number(fy);
    return Number.isFinite(num) && num > 1911
      ? String(num - 1911)
      : fy || '116';
  }, [fiscalYear]);

  const prevRocYear = useMemo(() => {
    const num = Number(rocYear);
    return Number.isFinite(num) ? String(num - 1) : '115';
  }, [rocYear]);

  const westYear = useMemo(() => {
    const num = Number(rocYear);
    return Number.isFinite(num) && num < 1911 ? String(num + 1911) : rocYear;
  }, [rocYear]);

  const prevWestYear = useMemo(() => {
    const num = Number(westYear);
    return Number.isFinite(num) ? String(num - 1) : '去年';
  }, [westYear]);

  const rows = value?.rows ?? [];

  /** 產生與同表格式一致的預算編號（例如專案 112BD003 在 116 年度編列時統一產生 116112BD003SE01） */
  const formatConsistentBudgetCode = (
    yearStr: string,
    unitStr: string,
    itemCodeStr: string
  ) => {
    const cleanYear = yearStr.trim();
    const cleanUnit = unitStr.trim();
    const cleanItem = itemCodeStr.trim().toUpperCase();
    if (!cleanUnit || !cleanItem) return '';
    if (cleanUnit.startsWith(cleanYear)) {
      return `${cleanUnit}${cleanItem}`;
    }
    return `${cleanYear}${cleanUnit}${cleanItem}`;
  };

  const updateRows = (nextRows: Row[]) => {
    onChange({ ...value, rows: nextRows });
  };

  // 自動正規化舊版草稿中不一致的科目名稱與科目編號
  useEffect(() => {
    let changed = false;
    const normalized = rows.map((r) => {
      const catStr = String(r.category ?? '').trim();
      const accStr = String(r.accountNumber ?? '').trim();
      if (catStr === '研究發展費-認證測試' || accStr === '62880114') {
        changed = true;
        const std = findStandardAccountCategory('SE23')!;
        return {
          ...r,
          category: std.categoryName,
          itemCode: std.itemCode,
          accountNumber: std.accountNumber,
          code: unitCode
            ? formatConsistentBudgetCode(rocYear, unitCode, std.itemCode)
            : String(r.code ?? '').replace(/SE09$/, 'SE23'),
          rowOrigin: r.rowOrigin || 'finance_dispatch',
        };
      }
      if (catStr === '研究發展費-材料及零件' || accStr === '51880101') {
        changed = true;
        const std = findStandardAccountCategory('PR01')!;
        return {
          ...r,
          category: std.categoryName,
          itemCode: std.itemCode,
          accountNumber: std.accountNumber,
          rowOrigin: r.rowOrigin || 'finance_dispatch',
        };
      }
      const matchedByCat = findStandardAccountCategory(catStr);
      if (
        matchedByCat &&
        (r.itemCode !== matchedByCat.itemCode ||
          r.accountNumber !== matchedByCat.accountNumber)
      ) {
        changed = true;
        return {
          ...r,
          itemCode: matchedByCat.itemCode,
          accountNumber: matchedByCat.accountNumber,
          code: unitCode
            ? formatConsistentBudgetCode(
                rocYear,
                unitCode,
                matchedByCat.itemCode
              )
            : r.code,
          rowOrigin: r.rowOrigin || 'finance_dispatch',
        };
      }
      return r;
    });
    if (changed) {
      updateRows(normalized);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, unitCode, rocYear]);

  // 取得去年（prevRocYear，如 115 年度）該部門或專案實際填寫送出的歷史預算明細列
  const prevYearHistoricalRows = useMemo((): Row[] => {
    const scopeKey = budgetScope === 'project' ? 'project' : 'department';
    const histList = options.historicalBudgetSubmissions ?? [];
    const matchedSubmission =
      histList.find(
        (h) =>
          h.fiscalYear === prevRocYear &&
          h.budgetScope === scopeKey &&
          (scopeKey === 'project'
            ? !targetProjectId || h.targetProjectId === targetProjectId
            : !targetDepartmentId || h.targetDepartmentId === targetDepartmentId)
      ) ??
      histList.find(
        (h) => h.fiscalYear === prevRocYear && h.budgetScope === scopeKey
      );

    if (matchedSubmission && matchedSubmission.rows.length > 0) {
      return matchedSubmission.rows;
    }

    // Fallback：若資料庫尚未查詢到歷史單據，則由目前列上的 prevApprovedBudget 加上示範之「去年有編、今年未編」科目組合成去年填寫資料
    const fallbackFromCurrent: Row[] = rows
      .filter((r) => parseNum(r.prevApprovedBudget) > 0)
      .map((r) => {
        const std =
          findStandardAccountCategory(String(r.category ?? '')) ??
          findStandardAccountCategory(String(r.itemCode ?? ''));
        const itemCode = String(std?.itemCode ?? r.itemCode ?? 'SE01');
        const effUnit = unitCode || (scopeKey === 'project' ? 'PROJ' : 'DEPT');
        const prevTotal = parseNum(r.prevApprovedBudget);
        const perM = Math.floor(prevTotal / 12);
        const rem = prevTotal - perM * 12;
        const mObj: Record<string, string> = {};
        MONTH_KEYS.forEach((mk, idx) => {
          mObj[mk] = String(idx === 11 ? perM + rem : perM);
        });
        return {
          code: buildStandardBudgetCode({
            fiscalYear: prevRocYear,
            unitCode: effUnit,
            itemCode,
          }),
          category: std?.categoryName ?? r.category,
          itemCode,
          accountNumber: std?.accountNumber ?? r.accountNumber,
          ...mObj,
          annualBudgetAmount: String(prevTotal),
          description: `${prevRocYear} 年度（${prevWestYear} 年）核定編列之${std?.categoryName ?? r.category}預算。`,
        };
      });

    const extraDroppedCat =
      scopeKey === 'project'
        ? findStandardAccountCategory('SE07')!
        : findStandardAccountCategory('SE06')!;
    const effUnit = unitCode || (scopeKey === 'project' ? 'PROJ' : 'DEPT');
    if (
      !fallbackFromCurrent.some((r) => r.itemCode === extraDroppedCat.itemCode)
    ) {
      fallbackFromCurrent.push({
        code: buildStandardBudgetCode({
          fiscalYear: prevRocYear,
          unitCode: effUnit,
          itemCode: extraDroppedCat.itemCode,
        }),
        category: extraDroppedCat.categoryName,
        itemCode: extraDroppedCat.itemCode,
        accountNumber: extraDroppedCat.accountNumber,
        m1: '15000',
        m2: '15000',
        m3: '15000',
        m4: '15000',
        m5: '15000',
        m6: '15000',
        m7: '15000',
        m8: '15000',
        m9: '15000',
        m10: '15000',
        m11: '15000',
        m12: '15000',
        annualBudgetAmount: '180000',
        description: `${prevRocYear} 年度原編列之${extraDroppedCat.categoryName}（${rocYear} 年度起調整不續編）。`,
      });
    }

    return fallbackFromCurrent;
  }, [
    budgetScope,
    options.historicalBudgetSubmissions,
    prevRocYear,
    prevWestYear,
    rocYear,
    rows,
    targetDepartmentId,
    targetProjectId,
    unitCode,
  ]);

  // 建立「去年科目索引 Map」以及「去年有編列、但今年沒有的多出科目清單（置於表格最下方）」
  const { prevByKey, droppedPrevYearRows } = useMemo(() => {
    const map = new Map<string, Row>();
    for (const pr of prevYearHistoricalRows) {
      map.set(getSubjectMatchKey(pr), pr);
    }
    const currentKeys = new Set(rows.map((r) => getSubjectMatchKey(r)));
    const dropped = prevYearHistoricalRows.filter(
      (pr) => !currentKeys.has(getSubjectMatchKey(pr))
    );
    return { prevByKey: map, droppedPrevYearRows: dropped };
  }, [prevYearHistoricalRows, rows]);

  const NON_NEGATIVE_COLS = new Set<string>([
    'prevApprovedBudget',
    'prevActualAmount',
    'annualBudgetAmount',
    ...MONTH_KEYS,
  ]);

  const blockMinusKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '-' || e.key === '－') {
      e.preventDefault();
    }
  };

  const setCell = (rowIndex: number, colId: string, rawVal: string) => {
    const targetRow = rows[rowIndex];
    if (!targetRow) return;

    // 財會派發之科目列：鎖定會計科目（category、itemCode、accountNumber）與預算編號（code），不可更改
    const userAdded = isUserAddedRow(targetRow);
    if (
      !userAdded &&
      (colId === 'category' ||
        colId === 'code' ||
        colId === 'itemCode' ||
        colId === 'accountNumber')
    ) {
      return;
    }

    const sanitizedVal = NON_NEGATIVE_COLS.has(colId)
      ? rawVal.replace(/[-－]/g, '')
      : rawVal;

    const nextRows = rows.map((r, idx) => {
      if (idx !== rowIndex) return r;
      const updated: Row = { ...r, [colId]: sanitizedVal };

      // 當使用者在「自訂新增科目」選擇會計科目時，自動帶入科目代碼、8碼科目編號、標準預算編號與預設說明
      if (colId === 'category' && userAdded) {
        const std = findStandardAccountCategory(sanitizedVal);
        if (std) {
          updated.itemCode = std.itemCode;
          updated.accountNumber = std.accountNumber;
          const effUnit =
            unitCode || (budgetScope === 'project' ? 'PROJ' : 'DEPT');
          const baseCode = formatConsistentBudgetCode(
            rocYear,
            effUnit,
            std.itemCode
          );
          const codeTaken = rows.some(
            (other, oIdx) =>
              oIdx !== rowIndex && String(other.code ?? '') === baseCode
          );
          updated.code = codeTaken ? `${baseCode}-${rowIndex + 1}` : baseCode;
          // 同步檢查去年是否有此科目，若有則自動帶入去年核定與實際執行數
          const matchedPrev = prevByKey.get(std.itemCode);
          if (matchedPrev) {
            updated.prevApprovedBudget = String(
              matchedPrev.annualBudgetAmount ?? '0'
            );
            updated.prevActualAmount = String(
              matchedPrev.prevActualAmount ??
                matchedPrev.annualBudgetAmount ??
                '0'
            );
          } else {
            updated.prevApprovedBudget = '0';
            updated.prevActualAmount = '0';
          }
          if (!String(updated.description ?? '').trim()) {
            updated.description = std.description;
          }
        }
      }

      // 當編輯 1~12 月任一月份金額時，自動加總至 annualBudgetAmount = SUM(m1..m12)
      if ((MONTH_KEYS as readonly string[]).includes(colId)) {
        const { sum, hasAny } = sumMonths(updated);
        if (hasAny) {
          updated.annualBudgetAmount = sum > 0 ? String(sum) : '0';
        }
      }

      return updated;
    });
    updateRows(nextRows);
  };

  /** 一鍵將某列去年的 1~12 月數字抄寫帶入今年的格子中 */
  const copyPrevYearRowToCurrent = (rowIndex: number, prevRow: Row) => {
    const nextRows = rows.map((r, idx) => {
      if (idx !== rowIndex) return r;
      const copy: Row = { ...r };
      let sum = 0;
      MONTH_KEYS.forEach((mk) => {
        const v = parseNum(prevRow[mk]);
        copy[mk] = String(v);
        sum += v;
      });
      copy.annualBudgetAmount = String(
        sum > 0 ? sum : parseNum(prevRow.annualBudgetAmount)
      );
      return copy;
    });
    updateRows(nextRows);
  };

  const distributeEvenlyToMonths = (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    const rawTarget =
      evenDistAmount[rowIndex] ?? String(row.annualBudgetAmount ?? '');
    const total = parseNum(rawTarget);
    if (total <= 0) return;
    const perMonth = Math.floor(total / 12);
    const remainder = Math.round((total - perMonth * 12) * 100) / 100;
    const nextRows = rows.map((r, idx) => {
      if (idx !== rowIndex) return r;
      const copy: Row = { ...r };
      MONTH_KEYS.forEach((mk, mIdx) => {
        copy[mk] = String(mIdx === 11 ? perMonth + remainder : perMonth);
      });
      copy.annualBudgetAmount = String(total);
      return copy;
    });
    updateRows(nextRows);
  };

  const addUserSubjectRow = () => {
    const usedCategories = new Set(rows.map((r) => String(r.category ?? '')));
    const candidateCat =
      STANDARD_ACCOUNT_CATEGORIES.find(
        (c) =>
          (budgetScope === 'project' ? true : c.applicableTo !== 'project') &&
          !usedCategories.has(c.categoryName)
      ) ??
      STANDARD_ACCOUNT_CATEGORIES.find((c) => c.itemCode === 'SE05') ??
      STANDARD_ACCOUNT_CATEGORIES[1]!;

    const effUnit = unitCode || (budgetScope === 'project' ? 'PROJ' : 'DEPT');
    const baseCode = formatConsistentBudgetCode(
      rocYear,
      effUnit,
      candidateCat.itemCode
    );
    const codeTaken = rows.some((r) => String(r.code ?? '') === baseCode);
    const code = codeTaken ? `${baseCode}-${rows.length + 1}` : baseCode;

    const matchedPrev = prevByKey.get(candidateCat.itemCode);

    updateRows([
      ...rows,
      {
        code,
        category: candidateCat.categoryName,
        itemCode: candidateCat.itemCode,
        accountNumber: candidateCat.accountNumber,
        rowOrigin: 'user_added',
        isUserAdded: true,
        prevApprovedBudget: matchedPrev
          ? String(matchedPrev.annualBudgetAmount ?? '0')
          : '0',
        prevActualAmount: matchedPrev
          ? String(
              matchedPrev.prevActualAmount ??
                matchedPrev.annualBudgetAmount ??
                '0'
            )
          : '0',
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
        description: candidateCat.description,
      },
    ]);
  };

  const removeUserAddedRow = (rowIndex: number) => {
    const target = rows[rowIndex];
    if (!target || !isUserAddedRow(target)) return;
    if (rows.length <= 1) return;
    updateRows(rows.filter((_, idx) => idx !== rowIndex));
  };

  // Column totals for current year and previous year
  const totals = useMemo(() => {
    const monthTotals = MONTH_KEYS.map((mk) =>
      rows.reduce((s, r) => s + parseNum(r[mk]), 0)
    );
    const prevMonthTotals = MONTH_KEYS.map((mk) =>
      prevYearHistoricalRows.reduce((s, r) => s + parseNum(r[mk]), 0)
    );
    const prevApprovedTotal = rows.reduce(
      (s, r) => s + parseNum(r.prevApprovedBudget),
      0
    );
    const prevActualTotal = rows.reduce(
      (s, r) => s + parseNum(r.prevActualAmount),
      0
    );
    const annualTotal = rows.reduce(
      (s, r) => s + parseNum(r.annualBudgetAmount),
      0
    );
    const prevSheetAnnualTotal = prevYearHistoricalRows.reduce(
      (s, r) => s + parseNum(r.annualBudgetAmount),
      0
    );
    return {
      monthTotals,
      prevMonthTotals,
      prevApprovedTotal,
      prevActualTotal,
      annualTotal,
      prevSheetAnnualTotal,
    };
  }, [rows, prevYearHistoricalRows]);

  const showMonths = viewMode === 'monthly' || viewMode === 'all';
  const showVariance = viewMode === 'variance' || viewMode === 'all';

  const categoryColumn = field.columns.find((c) => c.id === 'category');
  const categoryOptions = categoryColumn?.options ?? [];

  const totalColSpan =
    3 +
    (showVariance ? 3 : 0) +
    (showMonths ? 12 : 0) +
    1 +
    (showVariance ? 2 : 0) +
    1;

  return (
    <div className="space-y-4">
      {/* 年份標題與新增會計科目工具列 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/90 via-indigo-50/50 to-slate-50 px-4 py-3 text-xs">
        <span className="rounded bg-td-blue px-2.5 py-1 text-sm font-bold text-white">
          {westYear} 年度（民國 {rocYear} 年）預算編列表
        </span>

        {rows.length < field.maxRows && (
          <button
            type="button"
            onClick={addUserSubjectRow}
            className="rounded-lg bg-td-blue px-3.5 py-2 font-semibold text-white shadow-sm hover:opacity-95"
          >
            ＋ 新增會計科目
          </button>
        )}
      </div>

      {/* 檢視模式切換 + 在每一格內顯示去年填寫資料輔助開關 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                viewMode === 'monthly'
                  ? 'bg-white text-td-blue-dark shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 1～12 月預算編列表（部門／專案預算表）
            </button>
            <button
              type="button"
              onClick={() => setViewMode('variance')}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                viewMode === 'variance'
                  ? 'bg-white text-td-blue-dark shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📊 年度預算差異分析表（含 {prevWestYear} 歷年比較）
            </button>
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                viewMode === 'all'
                  ? 'bg-white text-td-blue-dark shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🔍 展開全部欄位
            </button>
          </div>

          {/* 切換在每一格內直接顯示去年填寫資料供抄寫 */}
          <button
            type="button"
            onClick={() => setShowPrevYearInCells((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition shadow-sm ${
              showPrevYearInCells
                ? 'border-amber-400 bg-amber-50 text-amber-900 ring-1 ring-amber-300'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            title="在每一格內直接顯示去年填寫的數字，方便邊看邊抄寫修改；去年沒有的科目顯示「無」，去年比今年多出的科目則列於最下方"
          >
            <span>
              {showPrevYearInCells ? '👁️ 已在各格顯示' : '👁️ 點擊顯示'}：
            </span>
            <span>去年（{prevRocYear}年／{prevWestYear}）各格填寫資料對照</span>
          </button>
        </div>

        <div className="text-xs text-slate-600">
          共 <strong className="text-slate-900">{rows.length}</strong> 項科目 ·
          全年預算總計：
          <strong className="ml-1 text-sm tabular-nums text-td-blue-dark">
            NT$ {amountText(totals.annualTotal)}
          </strong>
        </div>
      </div>

      {/* 今年度線上預算編列主表格 */}
      <div className="overflow-x-auto rounded-xl border border-slate-300 shadow-sm">
        <table className="w-full min-w-[72rem] border-collapse text-xs">
          <thead>
            <tr className="bg-[#0F2D5C] text-white">
              <th className="sticky left-0 z-10 w-14 border border-slate-600 bg-[#0F2D5C] px-2 py-2.5 text-center font-semibold whitespace-nowrap">
                #
              </th>
              <th className="min-w-[14rem] border border-slate-600 px-2.5 py-2.5 text-left font-semibold whitespace-nowrap">
                會計科目（代碼／編號／名稱）*
              </th>
              <th className="min-w-[15rem] border border-slate-600 px-2.5 py-2.5 text-left font-semibold whitespace-nowrap">
                預算編號 *
              </th>

              {showVariance && (
                <>
                  <th className="min-w-[7.5rem] border border-slate-600 bg-slate-800 px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    {prevWestYear}年核定預算(A)
                  </th>
                  <th className="min-w-[7.5rem] border border-slate-600 bg-slate-800 px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    {prevWestYear}年實際執行數(B)
                  </th>
                  <th className="min-w-[5.5rem] border border-slate-600 bg-slate-800 px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    達成率(B/A)
                  </th>
                </>
              )}

              {showMonths &&
                MONTH_KEYS.map((mk, mIdx) => (
                  <th
                    key={mk}
                    className="min-w-[5.75rem] border border-slate-600 px-1.5 py-2.5 text-right font-semibold whitespace-nowrap"
                  >
                    <div>{mIdx + 1}月</div>
                    {showPrevYearInCells && (
                      <div className="mt-0.5 text-[10px] font-normal text-amber-200">
                        含去年對照
                      </div>
                    )}
                  </th>
                ))}

              <th className="min-w-[10rem] border border-slate-600 bg-blue-950 px-2.5 py-2.5 text-right font-semibold whitespace-nowrap">
                <div>{westYear}年全年預算合計(C) *</div>
                {showPrevYearInCells && (
                  <div className="mt-0.5 text-[10px] font-normal text-amber-200">
                    含去年合計對照
                  </div>
                )}
              </th>

              {showVariance && (
                <>
                  <th className="min-w-[6.5rem] border border-slate-600 bg-slate-800 px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    與去年差異(C-B)
                  </th>
                  <th className="min-w-[6rem] border border-slate-600 bg-slate-800 px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    成長率((C-B)/B)
                  </th>
                </>
              )}

              <th className="min-w-[15rem] border border-slate-600 px-2.5 py-2.5 text-left font-semibold whitespace-nowrap">
                {showVariance
                  ? '差異原因分析與編列說明 *'
                  : '編列說明／細項備註 *'}
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row, i) => {
              const userAdded = isUserAddedRow(row);
              const std =
                findStandardAccountCategory(String(row.category ?? '')) ??
                findStandardAccountCategory(String(row.itemCode ?? ''));
              const itemCode = String(std?.itemCode ?? row.itemCode ?? '');
              const accountNo = String(
                std?.accountNumber ?? row.accountNumber ?? ''
              );
              const categoryName = String(
                std?.categoryName ?? row.category ?? '未指定科目'
              );

              // 對照去年是否有此會計科目
              const prevRow = prevByKey.get(getSubjectMatchKey(row)) ?? null;
              const hadInPrevYear = Boolean(prevRow);

              const prevA = parseNum(
                row.prevApprovedBudget || prevRow?.annualBudgetAmount
              );
              const prevB = parseNum(
                row.prevActualAmount ||
                  prevRow?.prevActualAmount ||
                  prevRow?.annualBudgetAmount
              );
              const currC = parseNum(row.annualBudgetAmount);
              const achieveRate =
                prevA > 0 ? `${((prevB / prevA) * 100).toFixed(1)}%` : '—';
              const diffCB = currC - prevB;
              const growthRateNum =
                prevB > 0 ? ((currC - prevB) / prevB) * 100 : null;
              const growthRateStr =
                growthRateNum !== null ? `${growthRateNum.toFixed(1)}%` : '—';
              const needsVarianceNote =
                growthRateNum !== null && Math.abs(growthRateNum) >= 10;

              const currentCodeUpper = String(row.code ?? '').trim().toUpperCase();
              const dupRowIdx = currentCodeUpper
                ? rows.findIndex(
                    (other, oIdx) =>
                      oIdx !== i &&
                      String(other.code ?? '').trim().toUpperCase() ===
                        currentCodeUpper
                  )
                : -1;
              const codeErr =
                errors[`${field.id}.${i}.code`] ||
                (dupRowIdx !== -1
                  ? `⚠️ 預算編號「${String(row.code ?? '').trim()}」與第 ${dupRowIdx + 1} 列重複（必須為唯一值）`
                  : undefined);
              const catErr = errors[`${field.id}.${i}.category`];
              const amtErr = errors[`${field.id}.${i}.annualBudgetAmount`];
              const descErr = errors[`${field.id}.${i}.description`];

              return (
                <tr
                  key={i}
                  className={
                    userAdded
                      ? 'bg-emerald-50/30 hover:bg-emerald-50/60'
                      : i % 2 === 0
                        ? 'bg-white hover:bg-blue-50/30'
                        : 'bg-slate-50/60 hover:bg-blue-50/30'
                  }
                >
                  {/* 第 1 欄 (#)：使用者自行新增之科目可直接在最前面第一格整筆刪除 */}
                  <td className="sticky left-0 z-10 border border-slate-200 bg-inherit px-1.5 py-2 text-center align-middle">
                    {userAdded ? (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="font-mono text-[11px] font-semibold text-emerald-800">
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeUserAddedRow(i)}
                          className="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600 whitespace-nowrap hover:bg-red-100"
                          title="直接刪除此筆自訂新增的會計科目"
                          aria-label={`刪除第 ${i + 1} 列`}
                        >
                          ✕ 刪除
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-xs text-slate-500">
                        {i + 1}
                      </span>
                    )}
                  </td>

                  {/* 第 2 欄 (會計科目)：去除下方重複的「代碼 / 科目編號」小方框，保持單一清爽呈現 */}
                  <td className="border border-slate-200 p-2 align-middle">
                    {userAdded ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 whitespace-nowrap">
                            ✨ 新增會計科目（可更改）
                          </span>
                        </div>
                        <select
                          value={String(row.category ?? '')}
                          onChange={(e) =>
                            setCell(i, 'category', e.target.value)
                          }
                          aria-label={`第 ${i + 1} 列 會計科目`}
                          className={`w-full rounded border px-2 py-1.5 text-xs font-semibold text-slate-800 ${
                            catErr
                              ? 'border-red-500 bg-red-50'
                              : 'border-emerald-400 bg-white'
                          }`}
                        >
                          <option value="">請選擇會計科目</option>
                          {categoryOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-100/90 px-2.5 py-2"
                        title="財會派發之會計科目（代碼／編號／名稱）已鎖定，不可更改"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                            {itemCode || '—'}｜{accountNo || '—'}
                          </div>
                          <div className="mt-0.5 font-bold text-xs text-slate-900">
                            {categoryName}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-slate-200/90 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 whitespace-nowrap">
                          財會核發
                        </span>
                      </div>
                    )}
                    {catErr && (
                      <p className="mt-1 text-[11px] text-red-600">{catErr}</p>
                    )}
                  </td>

                  {/* 第 3 欄 (預算編號)：上下兩層對齊，下方「去年編號」與「整列帶入」強制單行不換行 */}
                  <td className="border border-slate-200 p-2 align-middle">
                    {userAdded ? (
                      <input
                        type="text"
                        value={String(row.code ?? '')}
                        onChange={(e) => setCell(i, 'code', e.target.value)}
                        placeholder={
                          unitCode
                            ? formatConsistentBudgetCode(
                                rocYear,
                                unitCode,
                                itemCode || 'SE01'
                              )
                            : '如 116ADSE01'
                        }
                        aria-label={`第 ${i + 1} 列 預算編號`}
                        className={`w-full rounded border px-2.5 py-1.5 font-mono text-xs font-semibold text-td-blue-dark ${
                          codeErr
                            ? 'border-red-500 bg-red-50'
                            : 'border-emerald-400 bg-white'
                        }`}
                      />
                    ) : (
                      <div
                        className="rounded border border-slate-200 bg-slate-100/90 px-2.5 py-1.5 font-mono text-xs font-bold text-slate-800 whitespace-nowrap select-all"
                        title="財會派發之預算編號已鎖定，不可修改"
                      >
                        {String(row.code ?? '—')}
                      </div>
                    )}

                    {showPrevYearInCells && (
                      <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-amber-200/80 bg-amber-50/90 px-2 py-1 text-[11px] text-amber-950 whitespace-nowrap">
                        <span className="font-mono whitespace-nowrap">
                          去年：{prevRow ? String(prevRow.code ?? '—') : '無'}
                        </span>
                        {prevRow && (
                          <button
                            type="button"
                            onClick={() => copyPrevYearRowToCurrent(i, prevRow)}
                            className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs transition whitespace-nowrap hover:bg-blue-700"
                            title="將此科目去年的 1～12 月填寫數字全部抄入今年格子中"
                          >
                            整列帶入
                          </button>
                        )}
                      </div>
                    )}
                    {codeErr && (
                      <p className="mt-1 text-[11px] text-red-600">{codeErr}</p>
                    )}
                  </td>

                  {/* 歷年核定與實際執行數（若去年未編列則顯示「無」） */}
                  {showVariance && (
                    <>
                      <td className="border border-slate-200 p-1.5 align-middle">
                        <div className="rounded border border-slate-200 bg-slate-100/90 px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {!hadInPrevYear && prevA === 0
                            ? '無'
                            : amountText(prevA)}
                        </div>
                      </td>
                      <td className="border border-slate-200 p-1.5 align-middle">
                        <div className="rounded border border-slate-200 bg-slate-100/90 px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {!hadInPrevYear && prevB === 0
                            ? '無'
                            : amountText(prevB)}
                        </div>
                      </td>
                      <td className="border border-slate-200 px-2 py-2 text-right align-middle font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        {!hadInPrevYear && prevA === 0 ? '無' : achieveRate}
                      </td>
                    </>
                  )}

                  {/* 1~12 月分月金額（每一格內直接顯示去年該月填寫數字或「無」，單行不換行） */}
                  {showMonths &&
                    MONTH_KEYS.map((mk, mIdx) => {
                      const prevMonthNum = prevRow ? parseNum(prevRow[mk]) : null;
                      return (
                        <td
                          key={mk}
                          className="border border-slate-200 p-1.5 align-middle"
                        >
                          {showPrevYearInCells && (
                            <div className="mb-1 flex items-center justify-between gap-1 rounded bg-amber-50/90 px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                              <span className="text-amber-800/80">去年:</span>
                              {prevRow ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCell(i, mk, String(prevMonthNum ?? 0))
                                  }
                                  className="font-mono font-semibold tabular-nums text-amber-950 hover:text-td-blue hover:underline"
                                  title="點擊可將去年該月數字直接填入下方格子"
                                >
                                  {prevMonthNum && prevMonthNum > 0
                                    ? amountText(prevMonthNum)
                                    : '0'}
                                </button>
                              ) : (
                                <span className="font-medium text-slate-400">
                                  無
                                </span>
                              )}
                            </div>
                          )}
                          <input
                            type="text"
                            inputMode="decimal"
                            value={String(row[mk] ?? '')}
                            onKeyDown={blockMinusKey}
                            onChange={(e) => setCell(i, mk, e.target.value)}
                            placeholder="0"
                            aria-label={`第 ${i + 1} 列 ${mIdx + 1}月`}
                            className="w-full rounded border border-slate-200 bg-white px-1.5 py-1.5 text-right tabular-nums focus:border-td-blue"
                          />
                        </td>
                      );
                    })}

                  {/* 全年預算合計(C)（格內同步顯示去年合計或「無」） */}
                  <td className="border border-slate-200 bg-blue-50/40 p-1.5 align-middle">
                    {showPrevYearInCells && (
                      <div className="mb-1 flex items-center justify-between gap-1 rounded bg-amber-50/90 px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                        <span className="text-amber-800/80">去年合計:</span>
                        {prevRow ? (
                          <span className="font-mono font-bold tabular-nums text-amber-950">
                            {amountText(parseNum(prevRow.annualBudgetAmount))}
                          </span>
                        ) : (
                          <span className="font-medium text-slate-400">無</span>
                        )}
                      </div>
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(row.annualBudgetAmount ?? '')}
                      onKeyDown={blockMinusKey}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/[-－]/g, '');
                        setCell(i, 'annualBudgetAmount', clean);
                        setEvenDistAmount((prev) => ({
                          ...prev,
                          [i]: clean,
                        }));
                      }}
                      placeholder="0"
                      aria-label={`第 ${i + 1} 列 年度預算金額`}
                      className={`w-full rounded border px-2 py-1.5 text-right font-bold tabular-nums text-td-blue-dark ${
                        amtErr
                          ? 'border-red-500 bg-red-50'
                          : 'border-blue-300 bg-white'
                      }`}
                    />
                    {showMonths && parseNum(row.annualBudgetAmount) > 0 && (
                      <button
                        type="button"
                        onClick={() => distributeEvenlyToMonths(i)}
                        className="mt-1 block w-full text-right text-[10px] font-medium text-blue-600 whitespace-nowrap hover:underline"
                        title="將全年預算金額平均分攤至 1～12 月"
                      >
                        ⇄ 均攤至 12 個月
                      </button>
                    )}
                    {amtErr && (
                      <p className="mt-1 text-[11px] text-red-600">{amtErr}</p>
                    )}
                  </td>

                  {/* 與去年差異及成長率 */}
                  {showVariance && (
                    <>
                      <td
                        className={`border border-slate-200 px-2 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap ${
                          diffCB > 0
                            ? 'text-amber-700'
                            : diffCB < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {!hadInPrevYear && prevB === 0 && currC === 0
                          ? '無'
                          : prevB > 0 || currC > 0
                            ? `${diffCB > 0 ? '+' : ''}${amountText(diffCB)}`
                            : '—'}
                      </td>
                      <td
                        className={`border border-slate-200 px-2 py-2 text-right align-middle font-mono font-semibold tabular-nums whitespace-nowrap ${
                          needsVarianceNote
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {!hadInPrevYear && prevB === 0
                          ? '無（今年新增）'
                          : growthRateStr}
                        {needsVarianceNote && (
                          <span className="block text-[10px] font-normal text-amber-700">
                            ±10%以上請說明
                          </span>
                        )}
                      </td>
                    </>
                  )}

                  {/* 說明與差異分析（格內同步顯示去年填寫說明或「無」） */}
                  <td className="border border-slate-200 p-1.5 align-middle">
                    {showPrevYearInCells && (
                      <div
                        className="mb-1 truncate rounded bg-amber-50/90 px-1.5 py-0.5 text-[10px] text-amber-950"
                        title={
                          prevRow
                            ? String(prevRow.description ?? '—')
                            : '去年無此科目'
                        }
                      >
                        <span className="text-amber-800/80">去年說明: </span>
                        {prevRow ? (
                          <span>{String(prevRow.description ?? '—')}</span>
                        ) : (
                          <span className="text-slate-400">無</span>
                        )}
                      </div>
                    )}
                    <input
                      type="text"
                      value={String(row.description ?? '')}
                      onChange={(e) =>
                        setCell(i, 'description', e.target.value)
                      }
                      placeholder={
                        std?.description ||
                        '請填寫預算項目用途、細項說明或與去年差異達 ±10% 之原因'
                      }
                      aria-label={`第 ${i + 1} 列 用途說明`}
                      className={`w-full rounded border px-2 py-1.5 text-xs ${
                        descErr
                          ? 'border-red-500 bg-red-50'
                          : needsVarianceNote
                            ? 'border-amber-400 bg-amber-50/30'
                            : 'border-slate-300 bg-white'
                      }`}
                    />
                    {descErr && (
                      <p className="mt-1 text-[11px] text-red-600">{descErr}</p>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* 最下方：去年（115年）有編列、但今年（116年）沒有的多出科目，直接放在同一張表格最下面供參考對照 */}
            {showPrevYearInCells &&
              droppedPrevYearRows.map((prevRow, extraIdx) => {
                const std =
                  findStandardAccountCategory(String(prevRow.category ?? '')) ??
                  findStandardAccountCategory(String(prevRow.itemCode ?? ''));
                const itemCode = String(std?.itemCode ?? prevRow.itemCode ?? '');
                const accountNo = String(
                  std?.accountNumber ?? prevRow.accountNumber ?? ''
                );
                const categoryName = String(
                  std?.categoryName ?? prevRow.category ?? '去年編列科目'
                );
                const prevA = parseNum(
                  prevRow.annualBudgetAmount ?? prevRow.prevApprovedBudget
                );
                const prevB = parseNum(
                  prevRow.prevActualAmount ?? prevRow.annualBudgetAmount
                );
                const achieveRate =
                  prevA > 0 ? `${((prevB / prevA) * 100).toFixed(1)}%` : '—';

                return (
                  <Fragment key={`dropped-prev-${extraIdx}-${itemCode}`}>
                    {extraIdx === 0 && (
                      <tr className="bg-amber-100/90 text-amber-950">
                        <td
                          colSpan={totalColSpan}
                          className="border border-amber-300 px-3 py-1.5 text-xs font-bold"
                        >
                          ⬇ 以下為去年（{prevRocYear} 年／{prevWestYear}
                          ）有填寫、但今年（{rocYear}{' '}
                          年）減少／未編列之科目（置於最下方供對照）
                        </td>
                      </tr>
                    )}
                    <tr className="bg-amber-50/60 text-slate-600">
                      <td className="sticky left-0 z-10 border border-slate-200 bg-amber-50 px-1.5 py-2 text-center font-mono text-[11px] font-semibold text-amber-800 whitespace-nowrap">
                        去年
                      </td>
                      <td className="border border-slate-200 p-2 align-middle">
                        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-100/60 px-2.5 py-2">
                          <div className="min-w-0">
                            <div className="font-mono text-[11px] font-semibold text-amber-800 whitespace-nowrap">
                              {itemCode || '—'}｜{accountNo || '—'}
                            </div>
                            <div className="mt-0.5 font-bold text-xs text-amber-950">
                              {categoryName}
                            </div>
                          </div>
                          <span className="shrink-0 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 whitespace-nowrap">
                            去年多出
                          </span>
                        </div>
                      </td>
                      <td className="border border-slate-200 p-2 align-middle font-mono text-xs text-amber-900">
                        <div className="rounded border border-dashed border-slate-200 bg-slate-100/80 px-2.5 py-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
                          今年：無
                        </div>
                        <div className="mt-1.5 flex items-center justify-between rounded border border-amber-200/80 bg-amber-100/70 px-2 py-1 text-[11px] text-amber-950 whitespace-nowrap">
                          <span>去年：{String(prevRow.code ?? '—')}</span>
                        </div>
                      </td>

                      {showVariance && (
                        <>
                          <td className="border border-slate-200 p-1.5 text-right align-middle font-mono tabular-nums text-amber-950 whitespace-nowrap">
                            {amountText(prevA)}
                          </td>
                          <td className="border border-slate-200 p-1.5 text-right align-middle font-mono tabular-nums text-amber-950 whitespace-nowrap">
                            {amountText(prevB)}
                          </td>
                          <td className="border border-slate-200 px-2 py-2 text-right align-middle font-mono tabular-nums whitespace-nowrap">
                            {achieveRate}
                          </td>
                        </>
                      )}

                      {showMonths &&
                        MONTH_KEYS.map((mk) => {
                          const mVal = parseNum(prevRow[mk]);
                          return (
                            <td
                              key={mk}
                              className="border border-slate-200 p-1.5 align-middle"
                            >
                              <div className="mb-1 flex items-center justify-between gap-1 rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                                <span className="text-amber-800/80">去年:</span>
                                <span className="font-mono font-semibold tabular-nums text-amber-950">
                                  {mVal > 0 ? amountText(mVal) : '0'}
                                </span>
                              </div>
                              <div className="rounded border border-dashed border-slate-200 bg-slate-100/70 px-1.5 py-1.5 text-center text-[11px] text-slate-400 whitespace-nowrap">
                                無
                              </div>
                            </td>
                          );
                        })}

                      <td className="border border-slate-200 bg-amber-100/40 p-1.5 align-middle">
                        <div className="mb-1 flex items-center justify-between gap-1 rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] whitespace-nowrap">
                          <span className="text-amber-800/80">去年合計:</span>
                          <span className="font-mono font-bold tabular-nums text-amber-950">
                            {amountText(prevA)}
                          </span>
                        </div>
                        <div className="rounded border border-dashed border-slate-200 bg-slate-100/70 px-2 py-1.5 text-center text-[11px] font-medium text-slate-400 whitespace-nowrap">
                          無（今年未編列）
                        </div>
                      </td>

                      {showVariance && (
                        <>
                          <td className="border border-slate-200 px-2 py-2 text-right align-middle font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                            -{amountText(prevB)}
                          </td>
                          <td className="border border-slate-200 px-2 py-2 text-right align-middle font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                            -100.0%
                          </td>
                        </>
                      )}

                      <td className="border border-slate-200 p-1.5 align-middle text-xs text-amber-900">
                        <div className="mb-1 truncate rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] text-amber-950">
                          <span className="text-amber-800/80">去年說明: </span>
                          {String(
                            prevRow.description ?? '去年編列項目，今年度未續編'
                          )}
                        </div>
                        <div className="rounded border border-dashed border-slate-200 bg-slate-100/70 px-2 py-1.5 text-[11px] text-slate-400 whitespace-nowrap">
                          無（今年未編列此科目）
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
          </tbody>

          <tfoot>
            <tr className="bg-slate-100 font-bold text-slate-900">
              <td
                colSpan={3}
                className="sticky left-0 z-10 border border-slate-300 bg-slate-100 px-3 py-2.5 text-right whitespace-nowrap"
              >
                <div>合計（今年共 {rows.length} 項科目）</div>
                {showPrevYearInCells && (
                  <div className="mt-0.5 text-[11px] font-normal text-amber-900">
                    去年（{prevRocYear}年）填寫總計對照
                  </div>
                )}
              </td>
              {showVariance && (
                <>
                  <td className="border border-slate-300 px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                    NT$ {amountText(totals.prevApprovedTotal)}
                  </td>
                  <td className="border border-slate-300 px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                    NT$ {amountText(totals.prevActualTotal)}
                  </td>
                  <td className="border border-slate-300 px-2 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    {totals.prevApprovedTotal > 0
                      ? `${(
                          (totals.prevActualTotal / totals.prevApprovedTotal) *
                          100
                        ).toFixed(1)}%`
                      : '—'}
                  </td>
                </>
              )}
              {showMonths &&
                totals.monthTotals.map((mSum, idx) => (
                  <td
                    key={MONTH_KEYS[idx]}
                    className="border border-slate-300 px-1.5 py-2.5 text-right tabular-nums whitespace-nowrap"
                  >
                    <div>{mSum > 0 ? amountText(mSum) : '0'}</div>
                    {showPrevYearInCells && (
                      <div className="mt-0.5 font-mono text-[10px] font-normal text-amber-800">
                        去年: {amountText(totals.prevMonthTotals[idx] ?? 0)}
                      </div>
                    )}
                  </td>
                ))}
              <td className="border border-slate-300 bg-blue-100/70 px-2.5 py-2.5 text-right text-sm tabular-nums text-td-blue-dark whitespace-nowrap">
                <div>NT$ {amountText(totals.annualTotal)}</div>
                {showPrevYearInCells && (
                  <div className="mt-0.5 font-mono text-[11px] font-normal text-amber-900">
                    去年: NT$ {amountText(totals.prevSheetAnnualTotal)}
                  </div>
                )}
              </td>
              {showVariance && (
                <>
                  <td className="border border-slate-300 px-2 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {totals.prevActualTotal > 0 || totals.annualTotal > 0
                      ? `${
                          totals.annualTotal - totals.prevActualTotal > 0
                            ? '+'
                            : ''
                        }${amountText(
                          totals.annualTotal - totals.prevActualTotal
                        )}`
                      : '—'}
                  </td>
                  <td className="border border-slate-300 px-2 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    {totals.prevActualTotal > 0
                      ? `${(
                          ((totals.annualTotal - totals.prevActualTotal) /
                            totals.prevActualTotal) *
                          100
                        ).toFixed(1)}%`
                      : '—'}
                  </td>
                </>
              )}
              <td className="border border-slate-300 px-2.5 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>

      {rows.length < field.maxRows && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addUserSubjectRow}
            className="rounded-lg border border-td-blue bg-white px-3.5 py-1.5 text-xs font-semibold text-td-blue hover:bg-blue-50"
          >
            ＋ 新增一個會計科目（可自選科目與刪除）
          </button>
          <span className="text-xs text-slate-500">
            說明：財會核發的固定會計科目僅供填寫各月預算數字；自行新增的會計科目可於表格最左側第一格直接點選「✕
            刪除」移除。
          </span>
        </div>
      )}
    </div>
  );
}
