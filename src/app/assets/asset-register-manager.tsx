'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls } from '@/app/components/form-fields';
import { ASSET_STATUSES, ASSET_STATUS_LABELS, MAX_LOCATION_LENGTH, type AssetStatus } from '@/lib/asset-transfers/constants';
import type { EmployeeOption } from '@/lib/asset-transfers/queries';
import { importAssetsFromExcel, upsertAsset } from '@/lib/assets/actions';
import type { RegisterRow } from '@/lib/assets/queries';

type Draft = { tag: string; name: string; quantity: string; custodianEmployeeId: string; location: string; status: AssetStatus; remark: string };
const EMPTY: Draft = { tag: '', name: '', quantity: '1', custodianEmployeeId: '', location: '', status: 'in_custody', remark: '' };

function ImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ created: number; updated: number; errors: { row: number; reason: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('請選擇檔案');
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

  return (
    <section className="card">
      <h2 className="mb-1 text-sm font-semibold text-td-blue-dark">批次匯入（Excel）</h2>
      <p className="mb-3 text-xs text-td-muted">
        第一列為標題，欄位依序：財產編號｜財產名稱｜數量｜保管人工號｜保管地點｜狀態（可空白，保管中／出借中／已併入／已出售／已報廢）｜備註。財產編號已存在時會更新該筆資料。
      </p>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="mb-2 text-sm">
          <p>
            新增 {summary.created} 筆、更新 {summary.updated} 筆、失敗 {summary.errors.length} 筆
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-6 text-red-700">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  第 {e.row} 列：{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".xlsx" className="text-sm" />
        <button type="button" onClick={onUpload} disabled={busy} className="btn-secondary disabled:opacity-50">
          {busy ? '匯入中…' : '上傳並匯入'}
        </button>
      </div>
    </section>
  );
}

export function AssetRegisterManager({ register, employees }: { register: RegisterRow[]; employees: EmployeeOption[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [showLeft, setShowLeft] = useState(false);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const edit = (r: RegisterRow) => {
    setDraft({
      tag: r.tag,
      name: r.name,
      quantity: String(r.quantity),
      custodianEmployeeId: r.custodianEmployeeId,
      location: r.location,
      status: r.status,
      remark: r.remark ?? '',
    });
    setEditing(true);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onSave = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertAsset({
      tag: draft.tag,
      name: draft.name,
      quantity: Number(draft.quantity),
      custodianEmployeeId: draft.custodianEmployeeId,
      location: draft.location,
      status: draft.status,
      remark: draft.remark,
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setDraft(EMPTY);
    setEditing(false);
    router.refresh();
  };

  const q = query.trim().toLowerCase();
  const rows = register.filter(
    (r) =>
      (showLeft || r.status === 'in_custody' || r.status === 'lent') &&
      (q === '' || [r.tag, r.name, r.custodianName, r.location].some((v) => v.toLowerCase().includes(q)))
  );

  return (
    <>
      <section className="card">
        <h2 className="mb-3 text-sm font-semibold text-td-blue-dark">{editing ? `編輯財產 ${draft.tag}` : '新增財產'}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-td-muted">
            財產編號
            <input value={draft.tag} onChange={(e) => set({ tag: e.target.value })} readOnly={editing} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-td-muted sm:col-span-1 lg:col-span-2">
            財產名稱
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="例：電腦主機/ASUS" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-td-muted">
            數量
            <input type="number" min="1" step="1" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs text-td-muted">
            保管人
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
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-td-muted">
            狀態
            <select value={draft.status} onChange={(e) => set({ status: e.target.value as AssetStatus })} className={`${inputCls} mt-1 !bg-white`}>
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ASSET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-td-muted">
            備註
            <input value={draft.remark} onChange={(e) => set({ remark: e.target.value })} className={`${inputCls} mt-1`} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? '儲存中…' : editing ? '儲存修改' : '新增財產'}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY);
                setEditing(false);
                setError(null);
              }}
              className="btn-secondary"
            >
              取消
            </button>
          )}
        </div>
      </section>

      <ImportForm />

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-td-blue-dark">清冊（{rows.length} 筆）</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-td-muted">
              <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
              顯示已併入／已出售／已報廢
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜尋編號、名稱、保管人、地點" className={`${inputCls} w-64`} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-td-border text-left text-xs text-td-muted">
                <th className="py-2 pr-4">財產編號</th>
                <th className="py-2 pr-4">財產名稱</th>
                <th className="py-2 pr-4">數量</th>
                <th className="py-2 pr-4">保管人</th>
                <th className="py-2 pr-4">保管地點</th>
                <th className="py-2 pr-4">狀態</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-td-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4 font-mono">{r.tag}</td>
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{r.quantity}</td>
                  <td className="py-2 pr-4">
                    {r.custodianName}
                    <span className="ml-1 text-xs text-td-muted">{r.custodianDepartment}</span>
                  </td>
                  <td className="py-2 pr-4">{r.location || '—'}</td>
                  <td className="py-2 pr-4">{ASSET_STATUS_LABELS[r.status]}</td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => edit(r)} className="text-xs font-medium text-td-blue hover:underline">
                      編輯
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-td-muted">
                    沒有符合的財產。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
