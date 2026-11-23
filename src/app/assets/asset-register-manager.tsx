'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls } from '@/app/components/form-fields';
import {
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  MAX_LOCATION_LENGTH,
  type AssetStatus,
} from '@/lib/asset-transfers/constants';
import type { EmployeeOption } from '@/lib/asset-transfers/queries';
import {
  confirmPropertyRegisterImport,
  importAssetsFromExcel,
  previewPropertyRegisterImport,
  upsertAsset,
} from '@/lib/assets/actions';
import type { RegisterRow } from '@/lib/assets/queries';
import {
  matchesMultiSelectFilter,
  MultiSelectFilter,
} from './multi-select-filter';

type DepartmentChoice = { id: string; code: string; name: string };

type Draft = {
  tag: string;
  name: string;
  quantity: string;
  physicalQuantity: string;
  unit: string;
  itemKind: string;
  description: string;
  custodianEmployeeId: string;
  custodyDepartmentId: string;
  location: string;
  status: AssetStatus;
  remark: string;
  accountingSubject: string;
  acquiredOn: string;
  voucherNo: string;
  projectLabel: string;
  tagAffixed: string;
  disposalVoucherNo: string;
  changeRequest: string;
  invMatchesBooks: string;
  invIdleDisposable: string;
  invUnusableScrap: string;
  invDispositionNote: string;
};

const EMPTY: Draft = {
  tag: '',
  name: '',
  quantity: '1',
  physicalQuantity: '1',
  unit: '台',
  itemKind: '',
  description: '',
  custodianEmployeeId: '',
  custodyDepartmentId: '',
  location: '',
  status: 'in_custody',
  remark: '',
  accountingSubject: '',
  acquiredOn: '',
  voucherNo: '',
  projectLabel: '',
  tagAffixed: 'V',
  disposalVoucherNo: '',
  changeRequest: '',
  invMatchesBooks: 'V',
  invIdleDisposable: 'X',
  invUnusableScrap: 'X',
  invDispositionNote: '',
};

type ColumnFilters = {
  tag: string;
  name: string;
  itemKind: string[];
  department: string[];
  custodian: string[];
  location: string[];
  status: string[];
  accountingSubject: string[];
  projectLabel: string[];
  voucherNo: string;
};

const EMPTY_COLUMN_FILTERS: ColumnFilters = {
  tag: '',
  name: '',
  itemKind: [],
  department: [],
  custodian: [],
  location: [],
  status: [],
  accountingSubject: [],
  projectLabel: [],
  voucherNo: '',
};

type ColumnKeywords = {
  itemKind: string;
  department: string;
  custodian: string;
  location: string;
  status: string;
  accountingSubject: string;
  projectLabel: string;
};

const EMPTY_COLUMN_KEYWORDS: ColumnKeywords = {
  itemKind: '',
  department: '',
  custodian: '',
  location: '',
  status: '',
  accountingSubject: '',
  projectLabel: '',
};

function QuickImportPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'full23' | 'quick7'>('full23');
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    created: number;
    updated: number;
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [preview23, setPreview23] = useState<{
    sheetName: string;
    counts: { create: number; update: number; unchanged: number; skip: number; fail: number };
    issueCount: number;
  } | null>(null);
  const [fileName23, setFileName23] = useState<string | null>(null);
  const [idempotencyKey23, setIdempotencyKey23] = useState<string | null>(null);
  const [result23, setResult23] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onUploadQuick7 = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('請選擇 Excel 檔案');
    setError(null);
    setSummary(null);
    setBusy(true);
    const formData = new FormData();
    formData.set('file', file);
    const result = await importAssetsFromExcel(formData);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSummary(result.summary);
    router.refresh();
  };

  const onPreviewFull23 = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('請選擇 Excel 檔案');
    setError(null);
    setResult23(null);
    setPreview23(null);
    setBusy(true);
    const formData = new FormData();
    formData.set('file', file);
    const res = await previewPropertyRegisterImport(formData);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setPreview23(res.preview);
    setFileName23(res.fileName);
    setIdempotencyKey23(crypto.randomUUID());
  };

  const onConfirmFull23 = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !idempotencyKey23) return setError('請重新選擇 Excel 檔案');
    setError(null);
    setBusy(true);
    const formData = new FormData();
    formData.set('file', file);
    formData.set('idempotencyKey', idempotencyKey23);
    if (fileName23) formData.set('fileName', fileName23);
    const res = await confirmPropertyRegisterImport(formData);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setResult23(
      `匯入完成：新增 ${res.counts.create} 筆、更新 ${res.counts.update} 筆、略過 ${res.counts.skip} 筆`
    );
    setPreview23(null);
    router.refresh();
  };

  return (
    <section className="card space-y-3 border border-slate-200 bg-slate-50/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-td-blue-dark">匯入財產清冊 Excel</h2>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setImportMode('full23');
                setError(null);
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                importMode === 'full23' ? 'bg-td-blue text-white' : 'text-slate-600'
              }`}
            >
              完整 23 欄清冊
            </button>
            <button
              type="button"
              onClick={() => {
                setImportMode('quick7');
                setError(null);
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                importMode === 'quick7' ? 'bg-td-blue text-white' : 'text-slate-600'
              }`}
            >
              簡易 7 欄快速匯入
            </button>
          </div>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary text-xs">
          收合
        </button>
      </div>

      <p className="text-xs text-td-muted">
        {importMode === 'full23'
          ? '適用公司標準「財產保管清冊（23 欄）」工作表，先產生差異預覽、確認無誤後寫入。'
          : '第一列為標題，欄位依序：財產編號｜財產名稱｜數量｜保管人工號｜保管地點｜狀態｜備註。'}
      </p>

      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      {result23 && <p className="text-xs font-semibold text-emerald-800">{result23}</p>}
      {summary && (
        <div className="text-xs">
          <p className="font-semibold text-emerald-800">
            新增 {summary.created} 筆、更新 {summary.updated} 筆、失敗 {summary.errors.length} 筆
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-700">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  第 {e.row} 列：{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx" className="text-xs" />
        {importMode === 'full23' ? (
          <>
            <button
              type="button"
              onClick={onPreviewFull23}
              disabled={busy}
              className="btn-secondary text-xs disabled:opacity-50"
            >
              {busy ? '處理中…' : '1. 產生差異預覽'}
            </button>
            {preview23 && (
              <button
                type="button"
                onClick={onConfirmFull23}
                disabled={busy}
                className="btn-primary text-xs disabled:opacity-50"
              >
                2. 確認寫入（新增 {preview23.counts.create} / 更新 {preview23.counts.update}）
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={onUploadQuick7}
            disabled={busy}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {busy ? '匯入中…' : '上傳並匯入'}
          </button>
        )}
      </div>
    </section>
  );
}

export function AssetRegisterManager({
  register,
  employees,
  departments = [],
}: {
  register: RegisterRow[];
  employees: EmployeeOption[];
  departments?: DepartmentChoice[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [showEditor, setShowEditor] = useState(false);
  const [showQuickImport, setShowQuickImport] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAll23FormFields, setShowAll23FormFields] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 預設是精簡檢視 ('compact')，一進去就是公司所有財產
  const [tableViewMode, setTableViewMode] = useState<'compact' | 'full23'>('compact');
  const [query, setQuery] = useState('');
  const [colFilters, setColFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const [colKeywords, setColKeywords] = useState<ColumnKeywords>(EMPTY_COLUMN_KEYWORDS);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setColFilter = <K extends keyof ColumnFilters>(key: K, value: ColumnFilters[K]) =>
    setColFilters((prev) => ({ ...prev, [key]: value }));
  const setColKeyword = <K extends keyof ColumnKeywords>(key: K, value: string) =>
    setColKeywords((prev) => ({ ...prev, [key]: value }));

  const statusOptions = useMemo(
    () => ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_LABELS[s] })),
    []
  );

  // 各欄位不重複選項（供欄位標題下拉篩選直接選取）
  const filterOptions = useMemo(() => {
    const itemKinds = new Set<string>();
    const deptNames = new Set<string>();
    const custodianNames = new Set<string>();
    const locations = new Set<string>();
    const subjects = new Set<string>();
    const projects = new Set<string>();

    for (const r of register) {
      if (r.itemKind?.trim()) itemKinds.add(r.itemKind.trim());
      const dept = (r.custodyDepartmentName ?? r.custodianDepartment)?.trim();
      if (dept) deptNames.add(dept);
      if (r.custodianName?.trim()) custodianNames.add(r.custodianName.trim());
      if (r.location?.trim()) locations.add(r.location.trim());
      if (r.accountingSubject?.trim()) subjects.add(r.accountingSubject.trim());
      if (r.projectLabel?.trim()) projects.add(r.projectLabel.trim());
    }

    const sortZh = (arr: Iterable<string>) =>
      [...arr].sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    return {
      itemKinds: sortZh(itemKinds),
      departments: sortZh(deptNames),
      custodians: sortZh(custodianNames),
      locations: sortZh(locations),
      subjects: sortZh(subjects),
      projects: sortZh(projects),
    };
  }, [register]);

  const hasActiveFilters = useMemo(() => {
    return (
      query.trim() !== '' ||
      colFilters.tag.trim() !== '' ||
      colFilters.name.trim() !== '' ||
      colFilters.voucherNo.trim() !== '' ||
      colFilters.itemKind.length > 0 ||
      colFilters.department.length > 0 ||
      colFilters.custodian.length > 0 ||
      colFilters.location.length > 0 ||
      colFilters.status.length > 0 ||
      colFilters.accountingSubject.length > 0 ||
      colFilters.projectLabel.length > 0 ||
      Object.values(colKeywords).some((kw) => kw.trim() !== '')
    );
  }, [query, colFilters, colKeywords]);

  const clearAllFilters = () => {
    setQuery('');
    setColFilters(EMPTY_COLUMN_FILTERS);
    setColKeywords(EMPTY_COLUMN_KEYWORDS);
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const fTag = colFilters.tag.trim().toLowerCase();
    const fName = colFilters.name.trim().toLowerCase();
    const fVoucher = colFilters.voucherNo.trim().toLowerCase();

    return register.filter((r) => {
      const dept = (r.custodyDepartmentName ?? r.custodianDepartment) || '';
      if (fTag && !r.tag.toLowerCase().includes(fTag)) return false;
      if (
        fName &&
        !r.name.toLowerCase().includes(fName) &&
        !(r.description ?? '').toLowerCase().includes(fName)
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.itemKind ?? '',
          colFilters.itemKind,
          colKeywords.itemKind
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          dept,
          colFilters.department,
          colKeywords.department
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.custodianName,
          colFilters.custodian,
          colKeywords.custodian
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.location ?? '',
          colFilters.location,
          colKeywords.location
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.status,
          colFilters.status,
          colKeywords.status,
          ASSET_STATUS_LABELS[r.status]
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.accountingSubject ?? '',
          colFilters.accountingSubject,
          colKeywords.accountingSubject
        )
      ) {
        return false;
      }
      if (
        !matchesMultiSelectFilter(
          r.projectLabel ?? '',
          colFilters.projectLabel,
          colKeywords.projectLabel
        )
      ) {
        return false;
      }
      if (fVoucher && !(r.voucherNo ?? '').toLowerCase().includes(fVoucher)) return false;

      if (!q) return true;
      return [
        r.tag,
        r.name,
        r.description ?? '',
        r.custodianName,
        dept,
        r.location,
        r.itemKind ?? '',
        r.accountingSubject,
        r.voucherNo,
        r.projectLabel,
      ].some((v) => v.toLowerCase().includes(q));
    });
  }, [register, query, colFilters, colKeywords]);

  const edit = (r: RegisterRow) => {
    setDraft({
      tag: r.tag,
      name: r.name,
      quantity: String(r.quantity),
      physicalQuantity: String(r.physicalQuantity ?? r.quantity),
      unit: r.unit ?? '',
      itemKind: r.itemKind ?? '',
      description: r.description ?? '',
      custodianEmployeeId: r.custodianEmployeeId,
      custodyDepartmentId: r.custodyDepartmentId ?? '',
      location: r.location,
      status: r.status,
      remark: r.remark ?? '',
      accountingSubject: r.accountingSubject ?? '',
      acquiredOn: r.acquiredOn ?? '',
      voucherNo: r.voucherNo ?? '',
      projectLabel: r.projectLabel ?? '',
      tagAffixed: r.tagAffixed || 'V',
      disposalVoucherNo: r.disposalVoucherNo ?? '',
      changeRequest: r.changeRequest ?? '',
      invMatchesBooks: r.invMatchesBooks || 'V',
      invIdleDisposable: r.invIdleDisposable || 'X',
      invUnusableScrap: r.invUnusableScrap || 'X',
      invDispositionNote: r.invDispositionNote ?? '',
    });
    setEditing(true);
    setEditingId(r.id);
    setShowEditor(true);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openNewAssetForm = () => {
    setDraft(EMPTY);
    setEditing(false);
    setEditingId(null);
    setShowEditor((v) => !v);
    setError(null);
    setNotice(null);
  };

  const onSave = async () => {
    setError(null);
    setNotice(null);
    setSaving(true);
    const result = await upsertAsset({
      id: editingId ?? undefined,
      tag: draft.tag,
      name: draft.name,
      quantity: Number(draft.quantity),
      physicalQuantity: draft.physicalQuantity.trim() !== '' ? Number(draft.physicalQuantity) : null,
      unit: draft.unit,
      itemKind: draft.itemKind,
      description: draft.description,
      custodianEmployeeId: draft.custodianEmployeeId,
      custodyDepartmentId: draft.custodyDepartmentId || null,
      location: draft.location,
      status: draft.status,
      remark: draft.remark,
      accountingSubject: draft.accountingSubject,
      acquiredOn: draft.acquiredOn,
      voucherNo: draft.voucherNo,
      projectLabel: draft.projectLabel,
      tagAffixed: draft.tagAffixed,
      disposalVoucherNo: draft.disposalVoucherNo,
      changeRequest: draft.changeRequest,
      invMatchesBooks: draft.invMatchesBooks,
      invIdleDisposable: draft.invIdleDisposable,
      invUnusableScrap: draft.invUnusableScrap,
      invDispositionNote: draft.invDispositionNote,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setDraft(EMPTY);
    setEditing(false);
    setEditingId(null);
    setShowEditor(false);
    setNotice('已儲存財產清冊資料。');
    router.refresh();
  };

  const headerFilterInputCls =
    'mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-normal text-slate-800 placeholder:text-slate-400 focus:border-td-blue focus:outline-none';

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {/* 展開式：新增／編輯財產表單 */}
      {showEditor && (
        <section className="card space-y-4 border-2 border-td-blue/30 bg-slate-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-td-blue-dark">
                {editing ? `編輯財產 ${draft.tag}` : '新增財產'}
              </h2>
              <p className="text-xs text-td-muted">
                支援《財產保管清冊》完整欄位維護。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAll23FormFields((v) => !v)}
                className="btn-secondary text-xs"
              >
                {showAll23FormFields ? '收合進階帳務欄' : '展開全部 23 欄'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEditor(false);
                  setEditing(false);
                  setEditingId(null);
                  setDraft(EMPTY);
                }}
                className="btn-secondary text-xs"
              >
                關閉
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-td-muted">
              財產編號 *
              <input
                value={draft.tag}
                onChange={(e) => set({ tag: e.target.value })}
                placeholder="例：TD-IT-0054-01"
                className={`${inputCls} mt-1 font-mono`}
              />
            </label>
            <label className="text-xs text-td-muted sm:col-span-1 lg:col-span-2">
              設備或生財器具名稱 *
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="例：電腦主機/ASUS"
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className="text-xs text-td-muted">
              項目種類
              <input
                value={draft.itemKind}
                onChange={(e) => set({ itemKind: e.target.value })}
                placeholder="例：電腦設備、辦公設備、測試儀器"
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className="text-xs text-td-muted lg:col-span-2">
              說明（規格／型號／序號）
              <input
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="例：i7-13700 / 32GB RAM / SN:..."
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className="text-xs text-td-muted">
              帳載數量 *
              <input
                type="number"
                min="1"
                step="1"
                value={draft.quantity}
                onChange={(e) => set({ quantity: e.target.value })}
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className="text-xs text-td-muted">
              實盤數量 / 單位
              <div className="mt-1 flex gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.physicalQuantity}
                  onChange={(e) => set({ physicalQuantity: e.target.value })}
                  placeholder="實盤數"
                  className={`${inputCls} w-2/3`}
                />
                <input
                  value={draft.unit}
                  onChange={(e) => set({ unit: e.target.value })}
                  placeholder="單位(台/組)"
                  className={`${inputCls} w-1/3`}
                />
              </div>
            </label>
            <label className="text-xs text-td-muted">
              保管部門
              <select
                value={draft.custodyDepartmentId}
                onChange={(e) => set({ custodyDepartmentId: e.target.value })}
                className={`${inputCls} mt-1 !bg-white`}
              >
                <option value="">預設跟隨保管人部門</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}｜{d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-td-muted">
              保管人 *
              <select
                value={draft.custodianEmployeeId}
                onChange={(e) => set({ custodianEmployeeId: e.target.value })}
                className={`${inputCls} mt-1 !bg-white`}
              >
                <option value="">請選擇</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}（{e.departmentName}）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-td-muted">
              保管地點
              <input
                value={draft.location}
                onChange={(e) => set({ location: e.target.value })}
                maxLength={MAX_LOCATION_LENGTH}
                placeholder="例：台北辦公室 3F 研發區"
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className="text-xs text-td-muted">
              狀態
              <select
                value={draft.status}
                onChange={(e) => set({ status: e.target.value as AssetStatus })}
                className={`${inputCls} mt-1 !bg-white`}
              >
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ASSET_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-td-muted lg:col-span-4">
              備註
              <input
                value={draft.remark}
                onChange={(e) => set({ remark: e.target.value })}
                className={`${inputCls} mt-1`}
              />
            </label>
          </div>

          {showAll23FormFields && (
            <div className="space-y-3 border-t border-slate-200 pt-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs text-td-muted">
                  會計科目
                  <input
                    value={draft.accountingSubject}
                    onChange={(e) => set({ accountingSubject: e.target.value })}
                    placeholder="例：生財器具、辦公設備"
                    className={`${inputCls} mt-1`}
                  />
                </label>
                <label className="text-xs text-td-muted">
                  取得時間
                  <input
                    value={draft.acquiredOn}
                    onChange={(e) => set({ acquiredOn: e.target.value })}
                    placeholder="例：2024-05-20"
                    className={`${inputCls} mt-1 font-mono`}
                  />
                </label>
                <label className="text-xs text-td-muted">
                  傳票編號
                  <input
                    value={draft.voucherNo}
                    onChange={(e) => set({ voucherNo: e.target.value })}
                    placeholder="例：1228003"
                    className={`${inputCls} mt-1 font-mono`}
                  />
                </label>
                <label className="text-xs text-td-muted">
                  專案
                  <input
                    value={draft.projectLabel}
                    onChange={(e) => set({ projectLabel: e.target.value })}
                    placeholder="例：TD2401 自駕巴士專案"
                    className={`${inputCls} mt-1`}
                  />
                </label>
                <label className="text-xs text-td-muted">
                  已貼財編 (V/X)
                  <select
                    value={draft.tagAffixed}
                    onChange={(e) => set({ tagAffixed: e.target.value })}
                    className={`${inputCls} mt-1 !bg-white`}
                  >
                    <option value="V">V（已貼財編）</option>
                    <option value="X">X（未貼財編）</option>
                    <option value="">（未填）</option>
                  </select>
                </label>
                <label className="text-xs text-td-muted">
                  已處分傳票編號
                  <input
                    value={draft.disposalVoucherNo}
                    onChange={(e) => set({ disposalVoucherNo: e.target.value })}
                    className={`${inputCls} mt-1 font-mono`}
                  />
                </label>
                <label className="text-xs text-td-muted lg:col-span-2">
                  異動需求
                  <input
                    value={draft.changeRequest}
                    onChange={(e) => set({ changeRequest: e.target.value })}
                    className={`${inputCls} mt-1`}
                  />
                </label>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {saving ? '儲存中…' : editing ? '儲存修改' : '確認新增財產'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY);
                setEditing(false);
                setEditingId(null);
                setShowEditor(false);
                setError(null);
              }}
              className="btn-secondary text-xs"
            >
              取消
            </button>
          </div>
        </section>
      )}

      {showQuickImport && <QuickImportPanel onClose={() => setShowQuickImport(false)} />}

      {/* 主畫面：一進來直接顯示公司所有財產（預設精簡檢視＋欄位名稱直接篩選） */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 左側：筆數 ＋「精簡 / 完整」切換 */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-sm font-bold text-td-blue-dark">
              全公司所有財產（顯示 {rows.length} / 共 {register.length} 筆）
            </h2>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTableViewMode('compact')}
                className={`rounded-md px-3 py-1 font-semibold transition ${
                  tableViewMode === 'compact' ? 'bg-white text-td-blue shadow-2xs' : 'text-slate-600'
                }`}
              >
                精簡
              </button>
              <button
                type="button"
                onClick={() => setTableViewMode('full23')}
                className={`rounded-md px-3 py-1 font-semibold transition ${
                  tableViewMode === 'full23' ? 'bg-white text-td-blue shadow-2xs' : 'text-slate-600'
                }`}
              >
                完整
              </button>
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                ✕ 清除篩選
              </button>
            )}
          </div>

          {/* 右側：快速搜尋 ／ 匯入 ／ 匯出 ／ 新增財產 單行整齊排列 */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="快速搜尋..."
              className="w-48 sm:w-56 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-td-blue focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowQuickImport((v) => !v)}
              className="btn-secondary whitespace-nowrap text-xs"
            >
              匯入
            </button>
            <a
              href="/api/assets/export?scope=company&includeLeft=true"
              className="btn-secondary whitespace-nowrap text-xs"
            >
              匯出
            </a>
            <button
              type="button"
              onClick={openNewAssetForm}
              className="btn-primary whitespace-nowrap text-xs"
            >
              {showEditor && !editing ? '收合新增' : '+ 新增財產'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {tableViewMode === 'compact' ? (
            <table className="w-full min-w-[1020px] text-sm">
              <thead>
                <tr className="border-b border-td-border bg-slate-50/80 text-left align-top text-xs font-semibold text-slate-700">
                  <th className="py-2.5 pl-2 pr-3 w-40">
                    <div>財產編號</div>
                    <input
                      value={colFilters.tag}
                      onChange={(e) => setColFilter('tag', e.target.value)}
                      placeholder="篩選編號..."
                      className={headerFilterInputCls}
                    />
                  </th>
                  <th className="py-2.5 pr-3 min-w-[200px]">
                    <div>設備名稱 / 規格</div>
                    <input
                      value={colFilters.name}
                      onChange={(e) => setColFilter('name', e.target.value)}
                      placeholder="篩選名稱或規格..."
                      className={headerFilterInputCls}
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>項目種類</div>
                    <MultiSelectFilter
                      options={filterOptions.itemKinds}
                      selected={colFilters.itemKind}
                      onChange={(v) => setColFilter('itemKind', v)}
                      keyword={colKeywords.itemKind}
                      onKeywordChange={(kw) => setColKeyword('itemKind', kw)}
                      placeholder={`全部種類 (${filterOptions.itemKinds.length})`}
                      ariaLabel="依項目種類篩選（可輸入或複選）"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-24">
                    <div>數量</div>
                    <div className="mt-2 text-[11px] font-normal text-slate-400">帳載 / 實盤</div>
                  </th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>保管部門</div>
                    <MultiSelectFilter
                      options={filterOptions.departments}
                      selected={colFilters.department}
                      onChange={(v) => setColFilter('department', v)}
                      keyword={colKeywords.department}
                      onKeywordChange={(kw) => setColKeyword('department', kw)}
                      placeholder={`全部部門 (${filterOptions.departments.length})`}
                      ariaLabel="依保管部門篩選（可輸入或複選）"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>保管人</div>
                    <MultiSelectFilter
                      options={filterOptions.custodians}
                      selected={colFilters.custodian}
                      onChange={(v) => setColFilter('custodian', v)}
                      keyword={colKeywords.custodian}
                      onKeywordChange={(kw) => setColKeyword('custodian', kw)}
                      placeholder={`全部保管人 (${filterOptions.custodians.length})`}
                      ariaLabel="依保管人篩選（可輸入或複選）"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-44">
                    <div>保管地點</div>
                    <MultiSelectFilter
                      options={filterOptions.locations}
                      selected={colFilters.location}
                      onChange={(v) => setColFilter('location', v)}
                      keyword={colKeywords.location}
                      onKeywordChange={(kw) => setColKeyword('location', kw)}
                      placeholder={`全部地點 (${filterOptions.locations.length})`}
                      ariaLabel="依保管地點篩選（可輸入或複選）"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-36">
                    <div>狀態</div>
                    <MultiSelectFilter
                      options={statusOptions}
                      selected={colFilters.status}
                      onChange={(v) => setColFilter('status', v)}
                      keyword={colKeywords.status}
                      onKeywordChange={(kw) => setColKeyword('status', kw)}
                      placeholder="全部狀態"
                      ariaLabel="依狀態篩選（可輸入或複選）"
                    />
                  </th>
                  <th className="py-2.5 pr-2 text-right w-16">
                    <div>操作</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-td-border">
                {rows.map((r) => {
                  const deptName = r.custodyDepartmentName ?? r.custodianDepartment;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 pl-2 pr-3 font-mono font-semibold text-td-blue-dark">
                        {r.tag}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-td-blue-dark">{r.name}</div>
                        {r.description && (
                          <div className="text-xs text-td-muted">{r.description}</div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-700">
                        {r.itemKind || '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {r.quantity} / {r.physicalQuantity ?? r.quantity} {r.unit ?? ''}
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-medium text-slate-700">
                        {deptName || '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs font-semibold text-slate-900">
                        {r.custodianName}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-700">
                        {r.location || '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 font-semibold ${
                            r.status === 'in_custody'
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : r.status === 'lent'
                                ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                                : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {ASSET_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => edit(r)}
                          className="text-xs font-semibold text-td-blue hover:underline"
                        >
                          編輯
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-td-muted">
                      沒有符合篩選條件的財產。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full min-w-[2300px] text-xs">
              <thead>
                <tr className="border-b border-td-border bg-slate-50 text-left align-top font-semibold text-slate-700">
                  <th className="py-2.5 pl-2 pr-3 w-40">
                    <div>1.會計科目</div>
                    <MultiSelectFilter
                      options={filterOptions.subjects}
                      selected={colFilters.accountingSubject}
                      onChange={(v) => setColFilter('accountingSubject', v)}
                      keyword={colKeywords.accountingSubject}
                      onKeywordChange={(kw) => setColKeyword('accountingSubject', kw)}
                      placeholder="全部科目"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-32">
                    <div>2.狀態</div>
                    <MultiSelectFilter
                      options={statusOptions}
                      selected={colFilters.status}
                      onChange={(v) => setColFilter('status', v)}
                      keyword={colKeywords.status}
                      onKeywordChange={(kw) => setColKeyword('status', kw)}
                      placeholder="全部狀態"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-36">
                    <div>3.財產編號</div>
                    <input
                      value={colFilters.tag}
                      onChange={(e) => setColFilter('tag', e.target.value)}
                      placeholder="篩選編號..."
                      className={headerFilterInputCls}
                    />
                  </th>
                  <th className="py-2.5 pr-3">4.取得時間</th>
                  <th className="py-2.5 pr-3 w-32">
                    <div>5.傳票編號</div>
                    <input
                      value={colFilters.voucherNo}
                      onChange={(e) => setColFilter('voucherNo', e.target.value)}
                      placeholder="篩選傳票..."
                      className={headerFilterInputCls}
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-36">
                    <div>6.項目種類</div>
                    <MultiSelectFilter
                      options={filterOptions.itemKinds}
                      selected={colFilters.itemKind}
                      onChange={(v) => setColFilter('itemKind', v)}
                      keyword={colKeywords.itemKind}
                      onKeywordChange={(kw) => setColKeyword('itemKind', kw)}
                      placeholder="全部種類"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-44">
                    <div>7.設備或生財器具名稱</div>
                    <input
                      value={colFilters.name}
                      onChange={(e) => setColFilter('name', e.target.value)}
                      placeholder="篩選名稱..."
                      className={headerFilterInputCls}
                    />
                  </th>
                  <th className="py-2.5 pr-3">8.說明</th>
                  <th className="py-2.5 pr-3">9.帳載數量</th>
                  <th className="py-2.5 pr-3">10.實盤數量</th>
                  <th className="py-2.5 pr-3">11.單位</th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>12.保管部門</div>
                    <MultiSelectFilter
                      options={filterOptions.departments}
                      selected={colFilters.department}
                      onChange={(v) => setColFilter('department', v)}
                      keyword={colKeywords.department}
                      onKeywordChange={(kw) => setColKeyword('department', kw)}
                      placeholder="全部部門"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-36">
                    <div>13.保管人</div>
                    <MultiSelectFilter
                      options={filterOptions.custodians}
                      selected={colFilters.custodian}
                      onChange={(v) => setColFilter('custodian', v)}
                      keyword={colKeywords.custodian}
                      onKeywordChange={(kw) => setColKeyword('custodian', kw)}
                      placeholder="全部保管人"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>14.保管地點</div>
                    <MultiSelectFilter
                      options={filterOptions.locations}
                      selected={colFilters.location}
                      onChange={(v) => setColFilter('location', v)}
                      keyword={colKeywords.location}
                      onKeywordChange={(kw) => setColKeyword('location', kw)}
                      placeholder="全部地點"
                    />
                  </th>
                  <th className="py-2.5 pr-3 w-40">
                    <div>15.專案</div>
                    <MultiSelectFilter
                      options={filterOptions.projects}
                      selected={colFilters.projectLabel}
                      onChange={(v) => setColFilter('projectLabel', v)}
                      keyword={colKeywords.projectLabel}
                      onKeywordChange={(kw) => setColKeyword('projectLabel', kw)}
                      placeholder="全部專案"
                    />
                  </th>
                  <th className="py-2.5 pr-3">16.備註</th>
                  <th className="py-2.5 pr-3">17.已貼財編</th>
                  <th className="py-2.5 pr-3">18.已處分傳票編號</th>
                  <th className="py-2.5 pr-3">19.異動需求</th>
                  <th className="py-2.5 pr-3">20.帳務相符(V/X)</th>
                  <th className="py-2.5 pr-3">21.閒置可移轉(V/X)</th>
                  <th className="py-2.5 pr-3">22.不堪用報廢(V/X)</th>
                  <th className="py-2.5 pr-3">23.請註記如何處理</th>
                  <th className="py-2.5 pr-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-td-border">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="py-2 pl-2 pr-3">{r.accountingSubject || '—'}</td>
                    <td className="py-2 pr-3">{ASSET_STATUS_LABELS[r.status]}</td>
                    <td className="py-2 pr-3 font-mono font-semibold text-td-blue-dark">{r.tag}</td>
                    <td className="py-2 pr-3 font-mono">{r.acquiredOn || '—'}</td>
                    <td className="py-2 pr-3 font-mono">{r.voucherNo || '—'}</td>
                    <td className="py-2 pr-3">{r.itemKind || '—'}</td>
                    <td className="py-2 pr-3 font-medium text-td-blue-dark">{r.name}</td>
                    <td className="py-2 pr-3 max-w-48 truncate" title={r.description ?? ''}>
                      {r.description || '—'}
                    </td>
                    <td className="py-2 pr-3 text-center">{r.quantity}</td>
                    <td className="py-2 pr-3 text-center">{r.physicalQuantity ?? r.quantity}</td>
                    <td className="py-2 pr-3">{r.unit || '—'}</td>
                    <td className="py-2 pr-3">{r.custodyDepartmentName ?? r.custodianDepartment}</td>
                    <td className="py-2 pr-3 font-medium">{r.custodianName}</td>
                    <td className="py-2 pr-3">{r.location || '—'}</td>
                    <td className="py-2 pr-3">{r.projectLabel || '—'}</td>
                    <td className="py-2 pr-3 max-w-44 truncate" title={r.remark ?? ''}>
                      {r.remark || '—'}
                    </td>
                    <td className="py-2 pr-3 text-center font-mono">{r.tagAffixed || '—'}</td>
                    <td className="py-2 pr-3 font-mono">{r.disposalVoucherNo || '—'}</td>
                    <td className="py-2 pr-3">{r.changeRequest || '—'}</td>
                    <td className="py-2 pr-3 text-center font-mono">{r.invMatchesBooks || '—'}</td>
                    <td className="py-2 pr-3 text-center font-mono">{r.invIdleDisposable || '—'}</td>
                    <td className="py-2 pr-3 text-center font-mono">{r.invUnusableScrap || '—'}</td>
                    <td className="py-2 pr-3">{r.invDispositionNote || '—'}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => edit(r)}
                        className="text-xs font-semibold text-td-blue hover:underline"
                      >
                        編輯
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={24} className="py-8 text-center text-td-muted">
                      沒有符合篩選條件的財產。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
