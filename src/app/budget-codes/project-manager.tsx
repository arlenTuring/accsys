'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmDialog } from '@/app/components/dialog';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import { PROJECT_KIND_LABELS, type ProjectKind } from '@/lib/expense-claims/editions';
import {
  deleteProject,
  setProjectActive,
  upsertProject,
} from '@/lib/projects/actions';
import type { ProjectListItem } from '@/lib/projects/queries';
import type {
  DepartmentOption,
  EmployeeOption,
  SupplierMasterItem,
} from './budget-codes-manager';

function inferProjectWestYear(code: string, name?: string, createdAt?: string): number {
  const upper = (code || '').trim().toUpperCase();
  const roc3 = upper.match(/^(1[01]\d)/);
  if (roc3) return Number(roc3[1]) + 1911;

  const prefix2 = upper.match(/^(?:TD|RV)(\d{2})\d+/);
  if (prefix2) return 2000 + Number(prefix2[1]);

  const westInCode = upper.match(/(20[12]\d)/);
  if (westInCode) return Number(westInCode[1]);
  if (name) {
    const westInName = name.match(/(20[12]\d)/);
    if (westInName) return Number(westInName[1]);
  }

  if (upper === 'YW20' || upper === 'T09') return 2025;

  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) return d.getFullYear();
  }
  return 2026;
}

type MasterSubTab = 'projects' | 'budget_codes' | 'suppliers';

type ProjectSortKey =
  | 'newest'
  | 'oldest'
  | 'code_asc'
  | 'code_desc'
  | 'name_asc'
  | 'used_first'
  | 'unused_first';

export function ProjectManager({
  projects,
  budgetCodes = [],
  departments = [],
  employees = [],
  suppliers = [],
}: {
  projects: ProjectListItem[];
  budgetCodes?: BudgetCodeListItem[];
  departments?: DepartmentOption[];
  employees?: EmployeeOption[];
  suppliers?: SupplierMasterItem[];
}) {
  const router = useRouter();
  const [subTab, setSubTab] = useState<MasterSubTab>('projects');
  const [localProjects, setLocalProjects] = useState<ProjectListItem[]>(projects);

  useEffect(() => {
    setLocalProjects(projects);
  }, [projects]);

  // Top form state (create or edit)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('product');

  // Inline row editing state
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineCode, setInlineCode] = useState('');
  const [inlineName, setInlineName] = useState('');
  const [inlineKind, setInlineKind] = useState<ProjectKind>('product');

  // Search, filter & sort state for projects
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterYear, setFilterYear] = useState<string>('ALL');
  const [filterKind, setFilterKind] = useState<'ALL' | ProjectKind>('ALL');
  const [filterUsageStatus, setFilterUsageStatus] = useState<
    'ALL' | 'USED' | 'UNUSED' | 'ACTIVE' | 'INACTIVE'
  >('ALL');
  const [sortBy, setSortBy] = useState<ProjectSortKey>('newest');

  // Search for secondary master data tabs
  const [bcKeyword, setBcKeyword] = useState('');
  const [supplierKeyword, setSupplierKeyword] = useState('');

  // Feedback & busy indicators
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingTarget = useMemo(
    () => localProjects.find((p) => p.id === editingProjectId) ?? null,
    [localProjects, editingProjectId]
  );

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const p of localProjects) {
      const y = p.year ?? inferProjectWestYear(p.code, p.name, p.created_at);
      years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [localProjects]);

  const stats = useMemo(() => {
    const total = localProjects.length;
    const activeCount = localProjects.filter((p) => p.active !== false).length;
    const inactiveCount = total - activeCount;
    const usedCount = localProjects.filter((p) => p.hasBudgetForms).length;
    const unusedCount = total - usedCount;
    return { total, activeCount, inactiveCount, usedCount, unusedCount };
  }, [localProjects]);

  const filteredAndSortedProjects = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    const filtered = localProjects.filter((p) => {
      const pYear = p.year ?? inferProjectWestYear(p.code, p.name, p.created_at);
      const pRoc = p.rocYear ?? pYear - 1911;
      if (filterYear !== 'ALL' && String(pYear) !== filterYear) return false;
      if (filterKind !== 'ALL' && p.kind !== filterKind) return false;
      const isActive = p.active !== false;
      const isUsed = Boolean(p.hasBudgetForms);
      if (filterUsageStatus === 'USED' && !isUsed) return false;
      if (filterUsageStatus === 'UNUSED' && isUsed) return false;
      if (filterUsageStatus === 'ACTIVE' && !isActive) return false;
      if (filterUsageStatus === 'INACTIVE' && isActive) return false;

      if (kw) {
        const hay = `${p.code} ${p.name} ${p.department ?? ''} ${p.period ?? ''} ${pYear} ${pRoc}年`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const yA = a.year ?? inferProjectWestYear(a.code, a.name, a.created_at);
      const yB = b.year ?? inferProjectWestYear(b.code, b.name, b.created_at);
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;

      if (sortBy === 'newest') {
        if (yA !== yB) return yB - yA;
        if (tA && tB && Math.abs(tA - tB) > 10_000) return tB - tA;
        return b.code.localeCompare(a.code, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'oldest') {
        if (yA !== yB) return yA - yB;
        if (tA && tB && Math.abs(tA - tB) > 10_000) return tA - tB;
        return a.code.localeCompare(b.code, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'code_asc') {
        return a.code.localeCompare(b.code, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'code_desc') {
        return b.code.localeCompare(a.code, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'name_asc') {
        return a.name.localeCompare(b.name, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'used_first') {
        const uA = a.hasBudgetForms ? 1 : 0;
        const uB = b.hasBudgetForms ? 1 : 0;
        if (uA !== uB) return uB - uA;
        if (yA !== yB) return yB - yA;
        return b.code.localeCompare(a.code, 'zh-Hant-TW', { numeric: true });
      }
      if (sortBy === 'unused_first') {
        const uA = a.hasBudgetForms ? 1 : 0;
        const uB = b.hasBudgetForms ? 1 : 0;
        if (uA !== uB) return uA - uB;
        if (yA !== yB) return yB - yA;
        return b.code.localeCompare(a.code, 'zh-Hant-TW', { numeric: true });
      }
      return 0;
    });
  }, [
    localProjects,
    searchKeyword,
    filterYear,
    filterKind,
    filterUsageStatus,
    sortBy,
  ]);

  const toggleSortColumn = (col: 'year' | 'code' | 'name' | 'usage') => {
    if (col === 'year') {
      setSortBy((prev) => (prev === 'newest' ? 'oldest' : 'newest'));
    } else if (col === 'code') {
      setSortBy((prev) => (prev === 'code_asc' ? 'code_desc' : 'code_asc'));
    } else if (col === 'name') {
      setSortBy('name_asc');
    } else if (col === 'usage') {
      setSortBy((prev) => (prev === 'used_first' ? 'unused_first' : 'used_first'));
    }
  };

  const resetTopForm = () => {
    setEditingProjectId(null);
    setCode('');
    setName('');
    setKind('product');
    setError(null);
  };

  const startEditProject = (p: ProjectListItem) => {
    setError(null);
    setSuccessMsg(null);
    setEditingProjectId(p.id);
    setCode(p.code);
    setName(p.name);
    setKind(p.kind);
    setInlineEditId(p.id);
    setInlineCode(p.code);
    setInlineName(p.name);
    setInlineKind(p.kind);
  };

  const cancelEdit = () => {
    setEditingProjectId(null);
    setInlineEditId(null);
    setCode('');
    setName('');
    setKind('product');
    setError(null);
  };

  const onSubmitTopForm = async () => {
    setError(null);
    setSuccessMsg(null);
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      setError('請輸入專案代碼（如 TD2601）');
      return;
    }
    if (!trimmedName) {
      setError('請輸入專案名稱');
      return;
    }

    setSaving(true);
    const isEditing = Boolean(editingProjectId);
    const result = await upsertProject({
      id: editingProjectId,
      code: trimmedCode,
      name: trimmedName,
      kind,
      mode: isEditing ? 'update' : 'create',
    });
    setSaving(false);

    if (result.ok) {
      const nowIso = new Date().toISOString();
      const inferredYear = inferProjectWestYear(trimmedCode, trimmedName, nowIso);
      if (isEditing && editingProjectId) {
        setLocalProjects((prev) =>
          prev.map((item) =>
            item.id === editingProjectId
              ? {
                  ...item,
                  code: trimmedCode,
                  name: trimmedName,
                  kind,
                  year: inferredYear,
                  rocYear: inferredYear - 1911,
                }
              : item
          )
        );
        setSuccessMsg(`已儲存專案「${trimmedCode}｜${trimmedName}」的修改`);
      } else {
        setLocalProjects((prev) => [
          {
            id: result.projectId,
            code: trimmedCode,
            name: trimmedName,
            kind,
            year: inferredYear,
            rocYear: inferredYear - 1911,
            period: `${inferredYear - 1911} 年度（${inferredYear}）`,
            active: true,
            budgetCodeCount: 0,
            budgetFormCount: 0,
            hasBudgetForms: false,
            created_at: nowIso,
          },
          ...prev.filter((item) => item.id !== result.projectId),
        ]);
        setSortBy('newest');
        setSuccessMsg(`已成功新增專案「${trimmedCode}｜${trimmedName}」（已排在清單最前面）`);
      }
      resetTopForm();
      setInlineEditId(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onSaveInlineEdit = async (p: ProjectListItem) => {
    setError(null);
    setSuccessMsg(null);
    const trimmedCode = inlineCode.trim();
    const trimmedName = inlineName.trim();
    if (!trimmedCode) {
      setError('專案代碼為必填');
      return;
    }
    if (!trimmedName) {
      setError('專案名稱為必填');
      return;
    }

    setSaving(true);
    const result = await upsertProject({
      id: p.id,
      code: trimmedCode,
      name: trimmedName,
      kind: inlineKind,
      mode: 'update',
    });
    setSaving(false);

    if (result.ok) {
      const inferredYear = inferProjectWestYear(trimmedCode, trimmedName, p.created_at);
      setLocalProjects((prev) =>
        prev.map((item) =>
          item.id === p.id
            ? {
                ...item,
                code: trimmedCode,
                name: trimmedName,
                kind: inlineKind,
                year: inferredYear,
                rocYear: inferredYear - 1911,
              }
            : item
        )
      );
      setSuccessMsg(`已更新專案「${trimmedCode}｜${trimmedName}」`);
      setInlineEditId(null);
      if (editingProjectId === p.id) {
        resetTopForm();
      }
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onToggleProjectActive = async (p: ProjectListItem) => {
    setError(null);
    setSuccessMsg(null);
    const currentlyActive = p.active !== false;
    const nextActive = !currentlyActive;

    if (!nextActive) {
      const confirmed = await confirmDialog({
        title: `是否停用專案「${p.code}」？`,
        message: [
          `專案代碼：${p.code}`,
          `專案名稱：${p.name}`,
          `專案類型：${PROJECT_KIND_LABELS[p.kind] ?? p.kind}`,
          p.hasBudgetForms
            ? `使用狀態：已有使用紀錄（含 ${p.budgetCodeCount ?? 0} 筆預算科目／單據）`
            : '使用狀態：尚未建立預算單',
          '',
          '停用後，此專案及其預算代號將不會出現在新增預算單與費用申請單的選單中，但歷史紀錄完整保留（隨時可重新啟用）。',
        ].join('\n'),
        confirmLabel: '確認停用專案',
        cancelLabel: '取消',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    setTogglingId(p.id);
    const result = await setProjectActive(p.id, nextActive);
    setTogglingId(null);

    if (result.ok) {
      setLocalProjects((prev) =>
        prev.map((item) => (item.id === p.id ? { ...item, active: nextActive } : item))
      );
      setSuccessMsg(
        nextActive
          ? `已重新啟用專案「${p.code}｜${p.name}」`
          : `已停用專案「${p.code}｜${p.name}」`
      );
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onDeleteProject = async (p: ProjectListItem) => {
    setError(null);
    setSuccessMsg(null);

    if (p.hasBudgetForms) {
      setError(
        `專案「${p.code}（${p.name}）」已經有建立預算單或使用紀錄（含 ${p.budgetCodeCount ?? 0} 筆預算科目），不可刪除，請選擇「停用」！`
      );
      return;
    }

    const confirmed = await confirmDialog({
      title: `是否刪除未使用專案「${p.code}」？`,
      message: [
        `專案代碼：${p.code}`,
        `專案名稱：${p.name}`,
        `專案類型：${PROJECT_KIND_LABELS[p.kind] ?? p.kind}`,
        `所屬年度：${p.rocYear ? `${p.rocYear} 年（${p.year}）` : p.year ?? '—'}`,
        '使用狀態：尚未建立任何預算單或費用單據（未使用）',
        '',
        '刪除後無法復原，確定要刪除此專案嗎？',
      ].join('\n'),
      confirmLabel: '確認刪除',
      cancelLabel: '取消',
      tone: 'danger',
    });
    if (!confirmed) return;

    setDeletingId(p.id);
    const result = await deleteProject(p.id);
    setDeletingId(null);

    if (result.ok) {
      setLocalProjects((prev) => prev.filter((item) => item.id !== p.id));
      if (editingProjectId === p.id || inlineEditId === p.id) {
        cancelEdit();
      }
      setSuccessMsg(`已刪除專案「${p.code}｜${p.name}」`);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const filteredBudgetCodes = useMemo(() => {
    const kw = bcKeyword.trim().toLowerCase();
    if (!kw) return budgetCodes;
    return budgetCodes.filter((b) =>
      `${b.code} ${b.departmentCode ?? ''} ${b.departmentName ?? ''} ${b.projectCode ?? ''} ${b.projectName ?? ''} ${b.category} ${b.fiscalYear} ${b.ownerName ?? ''}`
        .toLowerCase()
        .includes(kw)
    );
  }, [budgetCodes, bcKeyword]);

  const filteredSuppliers = useMemo(() => {
    const kw = supplierKeyword.trim().toLowerCase();
    if (!kw) return suppliers;
    return suppliers.filter((s) =>
      `${s.name} ${s.shortName ?? ''} ${s.taxId ?? ''} ${s.phone ?? ''} ${s.email ?? ''} ${s.contactName ?? ''}`
        .toLowerCase()
        .includes(kw)
    );
  }, [suppliers, supplierKeyword]);

  return (
    <div className="space-y-5">
      {/* 財會系統・主檔管理頂部分類切換列 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSubTab('projects')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              subTab === 'projects'
                ? 'bg-td-blue text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🚀 專案主檔管理（{localProjects.length}）
          </button>
          <button
            type="button"
            onClick={() => setSubTab('budget_codes')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              subTab === 'budget_codes'
                ? 'bg-td-blue text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            💰 預算編號主檔（{budgetCodes.length}）
          </button>
          <button
            type="button"
            onClick={() => setSubTab('suppliers')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              subTab === 'suppliers'
                ? 'bg-td-blue text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🏭 供應商主檔（{suppliers.length}）
          </button>
        </div>
        <span className="text-xs text-slate-500">
          財會管理 · 預算管理平台主檔中心
        </span>
      </div>

      {/* ==================== 分頁 1：專案主檔管理（含歷年與當期專案清單） ==================== */}
      {subTab === 'projects' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-td-blue-dark">
                專案主檔管理（含歷年與當期專案清單）
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                預設以「
                <span className="font-semibold text-slate-800">
                  最新的在前面、舊的在後面
                </span>
                」排序，支援搜尋、排序與建立新專案。
                <span className="font-semibold text-amber-800">
                  有使用到（已建立預算單或單據）的專案可選擇「停用」
                </span>
                ；
                <span className="font-semibold text-red-700">
                  沒使用到的專案可直接按下「刪除」進行刪除
                </span>
                。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setFilterUsageStatus('ALL')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filterUsageStatus === 'ALL'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                全部專案 {stats.total}
              </button>
              <button
                type="button"
                onClick={() => setFilterUsageStatus('USED')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filterUsageStatus === 'USED'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
              >
                有使用到（可停用） {stats.usedCount}
              </button>
              <button
                type="button"
                onClick={() => setFilterUsageStatus('UNUSED')}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  filterUsageStatus === 'UNUSED'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                沒使用到（可刪除） {stats.unusedCount}
              </button>
              {stats.inactiveCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterUsageStatus('INACTIVE')}
                  className={`rounded-full px-3 py-1 font-medium transition ${
                    filterUsageStatus === 'INACTIVE'
                      ? 'bg-amber-700 text-white'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  已停用 {stats.inactiveCount}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>⚠️ {error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-xs font-medium text-red-600 underline hover:text-red-800"
              >
                關閉
              </button>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span>✅ {successMsg}</span>
              <button
                type="button"
                onClick={() => setSuccessMsg(null)}
                className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900"
              >
                關閉
              </button>
            </div>
          )}

          {/* 新增／修改專案表單區 */}
          <div
            className={`rounded-xl border p-4 text-sm transition ${
              editingTarget
                ? 'border-blue-300 bg-blue-50/50'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                {editingTarget ? (
                  <span className="text-blue-800">
                    ✏️ 正在修改專案：{editingTarget.code}（{editingTarget.name}）
                  </span>
                ) : (
                  '➕ 建立新專案（建立後自動排在清單最前面）'
                )}
              </span>
              {editingTarget && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                >
                  取消修改，切換回新增模式
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSubmitTopForm();
                  }
                }}
                placeholder="專案代碼（如 TD2602、116BD001）"
                aria-label="專案代碼"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono"
              />
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSubmitTopForm();
                  }
                }}
                placeholder="專案名稱"
                aria-label="專案名稱"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5"
              />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ProjectKind)}
                aria-label="專案類型"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5"
              >
                {Object.entries(PROJECT_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onSubmitTopForm}
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? '儲存中…'
                  : editingTarget
                    ? '儲存專案修改'
                    : '新增專案'}
              </button>
              {editingTarget && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  取消
                </button>
              )}
            </div>
          </div>

          {/* 搜尋、篩選與排序工具列 */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2.5 text-sm">
              <input
                type="search"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="🔍 搜尋專案代碼、專案名稱、部門或年度…"
                className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              />
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                aria-label="篩選專案年度"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="ALL">全部年度（最新 → 歷年）</option>
                {availableYears.map((y) => (
                  <option key={y} value={String(y)}>
                    {y - 1911} 年度（西元 {y} 年）
                  </option>
                ))}
              </select>
              <select
                value={filterKind}
                onChange={(e) =>
                  setFilterKind(e.target.value as 'ALL' | ProjectKind)
                }
                aria-label="篩選專案類型"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="ALL">全部專案類型</option>
                {Object.entries(PROJECT_KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={filterUsageStatus}
                onChange={(e) =>
                  setFilterUsageStatus(
                    e.target.value as
                      | 'ALL'
                      | 'USED'
                      | 'UNUSED'
                      | 'ACTIVE'
                      | 'INACTIVE'
                  )
                }
                aria-label="篩選使用與啟用狀態"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="ALL">全部狀態（含歷史與已停用）</option>
                <option value="USED">有使用到（已建立預算·僅可停用）</option>
                <option value="UNUSED">沒使用到（無預算單·可直接刪除）</option>
                <option value="ACTIVE">僅啟用中專案</option>
                <option value="INACTIVE">僅已停用專案</option>
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-xs font-semibold text-slate-600">
                排序方式：
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as ProjectSortKey)}
                aria-label="排序方式"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"
              >
                <option value="newest">
                  最新在前面、舊的在後面（預設：新 → 舊）
                </option>
                <option value="oldest">舊的在前面、最新在後面（舊 → 新）</option>
                <option value="code_desc">專案代碼（Z → A）</option>
                <option value="code_asc">專案代碼（A → Z）</option>
                <option value="name_asc">專案名稱（A → Z）</option>
                <option value="used_first">有使用到的專案排前面</option>
                <option value="unused_first">沒使用到（可刪除）排前面</option>
              </select>
              <span className="ml-1 text-xs text-slate-500">
                顯示 {filteredAndSortedProjects.length} / {localProjects.length}{' '}
                筆
              </span>
            </div>
          </div>

          {/* 專案主檔表格 */}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr className="border-b text-left">
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSortColumn('year')}
                      className="inline-flex items-center gap-1 hover:text-td-blue-dark"
                      title="點擊切換最新在前面／最舊在前面"
                    >
                      年度
                      <span>
                        {sortBy === 'newest'
                          ? '↓新→舊'
                          : sortBy === 'oldest'
                            ? '↑舊→新'
                            : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSortColumn('code')}
                      className="inline-flex items-center gap-1 hover:text-td-blue-dark"
                      title="點擊依專案代碼排序"
                    >
                      專案代碼
                      <span>
                        {sortBy === 'code_asc'
                          ? '↑'
                          : sortBy === 'code_desc'
                            ? '↓'
                            : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => toggleSortColumn('name')}
                      className="inline-flex items-center gap-1 hover:text-td-blue-dark"
                      title="點擊依專案名稱排序"
                    >
                      專案名稱（含歷年專案資訊）
                      <span>{sortBy === 'name_asc' ? '↑' : '↕'}</span>
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    專案類型
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSortColumn('usage')}
                      className="inline-flex items-center gap-1 hover:text-td-blue-dark"
                      title="點擊切換有使用到／沒使用到排序"
                    >
                      使用與預算狀態
                      <span>
                        {sortBy === 'used_first'
                          ? '↓已用'
                          : sortBy === 'unused_first'
                            ? '↑未用'
                            : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    啟用狀態
                  </th>
                  <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                    操作（修改／停用／刪除）
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAndSortedProjects.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      查無符合篩選條件的專案主檔資料
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedProjects.map((p) => {
                    const isActive = p.active !== false;
                    const isRowEditing = inlineEditId === p.id;
                    const hasBudget = Boolean(p.hasBudgetForms);
                    const westYear =
                      p.year ??
                      inferProjectWestYear(p.code, p.name, p.created_at);
                    const rocYear = p.rocYear ?? westYear - 1911;

                    return (
                      <tr
                        key={p.id}
                        className={`transition hover:bg-slate-50/80 ${
                          !isActive ? 'bg-slate-50/60 text-slate-400' : ''
                        } ${isRowEditing ? 'bg-blue-50/40' : ''}`}
                      >
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          <span
                            className={`inline-flex flex-col rounded px-2 py-0.5 text-xs font-semibold ${
                              westYear >= 2026
                                ? 'bg-blue-50 text-blue-800'
                                : westYear === 2025
                                  ? 'bg-sky-50 text-sky-800'
                                  : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            <span>{rocYear} 年</span>
                            <span className="text-[10px] font-normal opacity-75">
                              {westYear}
                            </span>
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 font-mono font-medium text-slate-900 whitespace-nowrap">
                          {isRowEditing ? (
                            <input
                              value={inlineCode}
                              onChange={(e) => {
                                setInlineCode(e.target.value);
                                setCode(e.target.value);
                              }}
                              className="w-36 rounded border border-blue-400 bg-white px-2 py-1 font-mono text-sm text-slate-900"
                            />
                          ) : (
                            <span
                              className={
                                !isActive ? 'line-through text-slate-400' : ''
                              }
                            >
                              {p.code}
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-800">
                          {isRowEditing ? (
                            <input
                              value={inlineName}
                              onChange={(e) => {
                                setInlineName(e.target.value);
                                setName(e.target.value);
                              }}
                              className="w-full min-w-[220px] rounded border border-blue-400 bg-white px-2 py-1 text-sm text-slate-900"
                            />
                          ) : (
                            <div>
                              <div
                                className={
                                  !isActive
                                    ? 'text-slate-400'
                                    : 'font-medium text-slate-900'
                                }
                              >
                                {p.name}
                              </div>
                              {(p.department || p.period) && (
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {p.department ? `${p.department}` : ''}
                                  {p.department && p.period ? ' · ' : ''}
                                  {p.period ? `${p.period}` : ''}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {isRowEditing ? (
                            <select
                              value={inlineKind}
                              onChange={(e) => {
                                const nextKind = e.target.value as ProjectKind;
                                setInlineKind(nextKind);
                                setKind(nextKind);
                              }}
                              className="rounded border border-blue-400 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              {Object.entries(PROJECT_KIND_LABELS).map(
                                ([value, label]) => (
                                  <option key={value} value={value}>
                                    {label}
                                  </option>
                                )
                              )}
                            </select>
                          ) : (
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                p.kind === 'revenue'
                                  ? 'bg-purple-50 text-purple-700'
                                  : 'bg-blue-50 text-blue-700'
                              }`}
                            >
                              {PROJECT_KIND_LABELS[p.kind] ?? p.kind}
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {hasBudget ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700"
                              title="此專案已有使用到（已建立預算單、預算科目或費用單據），不可刪除，可選擇停用"
                            >
                              📋 已使用
                              {(p.budgetCodeCount ?? 0) > 0
                                ? `（${p.budgetCodeCount} 筆預算科目）`
                                : ''}
                            </span>
                          ) : (
                            <span
                              className="inline-block rounded-full bg-emerald-50/70 px-2.5 py-0.5 text-xs font-medium text-emerald-800"
                              title="此專案尚未建立任何預算單或費用單據，可直接按下刪除"
                            >
                              未使用（可刪除）
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {isActive ? (
                            <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              啟用中
                            </span>
                          ) : (
                            <span className="inline-block rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                              已停用
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {isRowEditing ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onSaveInlineEdit(p)}
                                disabled={saving}
                                className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                              >
                                {saving ? '儲存中…' : '儲存'}
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={saving}
                                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => startEditProject(p)}
                                className="text-xs font-medium text-blue-600 underline hover:text-blue-800"
                              >
                                修改
                              </button>
                              <button
                                type="button"
                                onClick={() => onToggleProjectActive(p)}
                                disabled={togglingId === p.id}
                                className={`text-xs font-medium underline disabled:opacity-50 ${
                                  isActive
                                    ? 'text-amber-700 hover:text-amber-900'
                                    : 'text-emerald-700 hover:text-emerald-900'
                                }`}
                              >
                                {togglingId === p.id
                                  ? '處理中…'
                                  : isActive
                                    ? '停用'
                                    : '啟用'}
                              </button>
                              {hasBudget ? (
                                <span
                                  className="cursor-not-allowed text-xs text-slate-400"
                                  title="有使用到（已建立預算單）的專案不可刪除，請使用「停用」功能"
                                >
                                  已使用·僅可停用
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onDeleteProject(p)}
                                  disabled={deletingId === p.id}
                                  className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                  title="此專案尚未被預算單或單據使用，可直接刪除"
                                >
                                  {deletingId === p.id ? '刪除中…' : '刪除'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== 分頁 2：預算編號主檔清單 ==================== */}
      {subTab === 'budget_codes' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-td-blue-dark">
                預算編號主檔一覽（共 {budgetCodes.length} 筆）
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                全公司各部門與各專案之年度預算編號、會計科目與負責人主檔清冊。
              </p>
            </div>
            <input
              type="search"
              value={bcKeyword}
              onChange={(e) => setBcKeyword(e.target.value)}
              placeholder="🔍 搜尋預算編號、部門／專案或科目…"
              className="w-72 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr className="border-b text-left">
                  <th className="px-3.5 py-2.5 font-semibold">年度</th>
                  <th className="px-3.5 py-2.5 font-semibold">預算編號</th>
                  <th className="px-3.5 py-2.5 font-semibold">歸屬部門／專案</th>
                  <th className="px-3.5 py-2.5 font-semibold">會計科目類別</th>
                  <th className="px-3.5 py-2.5 font-semibold">預算負責人</th>
                  <th className="px-3.5 py-2.5 font-semibold">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBudgetCodes.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80">
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      {b.fiscalYear} 年
                    </td>
                    <td className="px-3.5 py-2.5 font-mono font-medium text-slate-900">
                      {b.code}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-800">
                      {b.departmentCode
                        ? `部門：${b.departmentCode} ${b.departmentName ?? ''}`
                        : b.projectCode
                          ? `專案：${b.projectCode} ${b.projectName ?? ''}`
                          : '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">{b.category}</td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {b.ownerName ?? '—'}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {b.active !== false ? (
                        <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          啟用中
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                          已停用
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== 分頁 3：供應商主檔清單 ==================== */}
      {subTab === 'suppliers' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-td-blue-dark">
                供應商主檔一覽（共 {suppliers.length} 家）
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                採購單、驗收單與費用申請單往來廠商主檔清冊。
              </p>
            </div>
            <input
              type="search"
              value={supplierKeyword}
              onChange={(e) => setSupplierKeyword(e.target.value)}
              placeholder="🔍 搜尋供應商名稱、統編或聯絡人…"
              className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr className="border-b text-left">
                  <th className="px-3.5 py-2.5 font-semibold">供應商名稱</th>
                  <th className="px-3.5 py-2.5 font-semibold">簡稱</th>
                  <th className="px-3.5 py-2.5 font-semibold">統一編號</th>
                  <th className="px-3.5 py-2.5 font-semibold">聯絡人</th>
                  <th className="px-3.5 py-2.5 font-semibold">聯絡電話</th>
                  <th className="px-3.5 py-2.5 font-semibold">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSuppliers.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="px-3.5 py-2.5 font-medium text-slate-900">
                      {s.name}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {s.shortName || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-700">
                      {s.taxId || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {s.contactName || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-700">
                      {s.phone || '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {s.email || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
