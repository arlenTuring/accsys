'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  createAssetFieldAction,
  downloadFieldPurgeBackupPreviewAction,
  hideAssetFieldAction,
  previewFieldPurgeAction,
  purgeAssetFieldAction,
  recognizeFieldPurgeBackupAction,
  restoreAssetFieldAction,
  seedCatalogFieldsAction,
  updateAssetFieldAction,
} from '@/lib/assets/fields/actions';
import {
  ASSET_FIELD_SECTIONS,
  ASSET_FIELD_TYPES,
  type AssetFieldDefinitionDto,
  type PurgeImpact,
} from '@/lib/assets/fields/types';

const SECTION_LABEL: Record<string, string> = {
  basic: '基本資料',
  accounting: '帳務參照',
  custody: '保管資訊',
  status_qty: '狀態與數量',
  notes: '管理註記',
  inventory: '盤點判斷',
  custom: '自訂',
};

const TYPE_LABEL: Record<string, string> = {
  text: '單行文字',
  textarea: '長文字',
  integer: '整數',
  decimal: '小數',
  date: '日期',
  select: '單選',
  multiselect: '多選',
  tristate: '是／否／未填',
  employee: '人員',
  department: '部門',
  project: '專案',
};

type Props = { initialFields: AssetFieldDefinitionDto[] };

export function AssetFieldManager({ initialFields }: Props) {
  const [fields, setFields] = useState(initialFields);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [label, setLabel] = useState('');
  const [help, setHelp] = useState('');
  const [fieldType, setFieldType] = useState<(typeof ASSET_FIELD_TYPES)[number]>('text');
  const [section, setSection] = useState<(typeof ASSET_FIELD_SECTIONS)[number]>('custom');
  const [required, setRequired] = useState(false);
  const [optionsText, setOptionsText] = useState('選項A\n選項B');
  const [purgeTarget, setPurgeTarget] = useState<AssetFieldDefinitionDto | null>(null);
  const [purgeImpact, setPurgeImpact] = useState<PurgeImpact | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purgeBackupReady, setPurgeBackupReady] = useState(false);
  const [recognizeNote, setRecognizeNote] = useState<string | null>(null);

  const active = useMemo(() => fields.filter((f) => f.status === 'active'), [fields]);
  const hidden = useMemo(() => fields.filter((f) => f.status === 'hidden'), [fields]);

  const previewOptions =
    fieldType === 'select' || fieldType === 'multiselect'
      ? optionsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((label, i) => ({ id: `opt_${i + 1}`, label }))
      : [];

  function refresh(next: AssetFieldDefinitionDto) {
    setFields((prev) => {
      const i = prev.findIndex((f) => f.id === next.id);
      if (i < 0) return [...prev, next];
      const copy = [...prev];
      copy[i] = { ...copy[i], ...next };
      return copy;
    });
  }

  return (
    <div className="space-y-8">
      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>}

      <section className="card space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-td-blue-dark">新增欄位</h2>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await seedCatalogFieldsAction();
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setNotice(`已種子化 Excel 對應欄位：新增 ${res.inserted}、略過 ${res.skipped}。請重新整理頁面。`);
                window.location.reload();
              })
            }
          >
            匯入 Excel 初始欄位定義
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            顯示名稱
            <input className="mt-1 w-full rounded border px-2 py-1.5" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="text-sm">
            型別
            <select
              className="mt-1 w-full rounded border px-2 py-1.5"
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as (typeof ASSET_FIELD_TYPES)[number])}
            >
              {ASSET_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            區塊
            <select
              className="mt-1 w-full rounded border px-2 py-1.5"
              value={section}
              onChange={(e) => setSection(e.target.value as (typeof ASSET_FIELD_SECTIONS)[number])}
            >
              {ASSET_FIELD_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {SECTION_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm md:mt-6">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            必填（既有資產缺值時仍可閱讀；送出時再驗證）
          </label>
          <label className="text-sm md:col-span-2">
            說明／填寫提示
            <textarea className="mt-1 w-full rounded border px-2 py-1.5" rows={2} value={help} onChange={(e) => setHelp(e.target.value)} />
          </label>
          {(fieldType === 'select' || fieldType === 'multiselect') && (
            <label className="text-sm md:col-span-2">
              選項（每行一個）
              <textarea className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs" rows={4} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
            </label>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-td-border bg-slate-50 px-3 py-3 text-sm">
          <p className="font-medium text-td-blue-dark">預覽</p>
          <p className="mt-1 text-td-muted">{label || '（顯示名稱）'}</p>
          {help && <p className="mt-0.5 text-xs text-td-muted">{help}</p>}
          <div className="mt-2">
            {fieldType === 'textarea' ? (
              <textarea className="w-full rounded border px-2 py-1" rows={2} disabled placeholder="範例輸入" />
            ) : fieldType === 'select' || fieldType === 'multiselect' ? (
              <select className="w-full rounded border px-2 py-1" disabled>
                <option>請選擇</option>
                {previewOptions.map((o) => (
                  <option key={o.id}>{o.label}</option>
                ))}
              </select>
            ) : fieldType === 'tristate' ? (
              <select className="w-full rounded border px-2 py-1" disabled>
                <option>未填</option>
                <option>是</option>
                <option>否</option>
              </select>
            ) : (
              <input className="w-full rounded border px-2 py-1" disabled placeholder={TYPE_LABEL[fieldType]} />
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={pending || !label.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              setNotice(null);
              const res = await createAssetFieldAction({
                label: label.trim(),
                help,
                fieldType,
                section,
                required,
                options: previewOptions,
                showInList: false,
                searchable: true,
                filterable: false,
                exportable: true,
              });
              if (!res.ok) {
                setError(res.error);
                return;
              }
              refresh(res.field);
              setLabel('');
              setHelp('');
              setNotice(`已新增欄位「${res.field.label}」（不需重新部署即可在資產編輯使用）。`);
            })
          }
        >
          {pending ? '處理中…' : '建立欄位'}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-td-blue-dark">啟用中（{active.length}）</h2>
        <ul className="space-y-2">
          {active.map((f) => (
            <li key={f.id} className="card flex flex-col gap-2 p-3 text-sm md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-td-blue-dark">
                  {f.label}{' '}
                  <span className="text-xs font-normal text-td-muted">
                    {TYPE_LABEL[f.fieldType]} · {SECTION_LABEL[f.section]} · v{f.version}
                  </span>
                </p>
                <p className="text-xs text-td-muted">ID: {f.stableKey}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const next = window.prompt('新的顯示名稱', f.label);
                      if (!next || next.trim() === f.label) return;
                      const res = await updateAssetFieldAction({
                        id: f.id,
                        expectedVersion: f.version,
                        label: next.trim(),
                      });
                      if (!res.ok) {
                        setError(res.error);
                        if ('field' in res && res.field) refresh(res.field);
                        return;
                      }
                      refresh(res.field);
                      setNotice('已改名（欄位 ID 不變）。');
                    })
                  }
                >
                  改名
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={pending || Boolean(f.systemBinding)}
                  onClick={() =>
                    start(async () => {
                      if (
                        !window.confirm(
                          '隱藏後，既有資料會保留，但此欄位不再出現在日常資產操作中。具權限的管理員可在欄位管理中恢復。'
                        )
                      ) {
                        return;
                      }
                      const res = await hideAssetFieldAction({ id: f.id, expectedVersion: f.version });
                      if (!res.ok) {
                        setError(res.error);
                        return;
                      }
                      refresh(res.field);
                      setNotice(`已隱藏「${res.field.label}」。`);
                    })
                  }
                >
                  隱藏
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-td-blue-dark">已隱藏欄位（{hidden.length}）</h2>
        {hidden.length === 0 ? (
          <p className="text-sm text-td-muted">目前沒有隱藏欄位。</p>
        ) : (
          <ul className="space-y-2">
            {hidden.map((f) => (
              <li key={f.id} className="card flex flex-col gap-2 p-3 text-sm md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-medium">{f.label}</p>
                  <p className="text-xs text-td-muted">
                    {TYPE_LABEL[f.fieldType]} · 有值約 {f.filledCount ?? '—'} 筆 · 隱藏於 {f.hiddenAt ?? '—'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await restoreAssetFieldAction({ id: f.id, expectedVersion: f.version });
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        refresh(res.field);
                        setNotice(`已恢復「${res.field.label}」。`);
                      })
                    }
                  >
                    恢復
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-red-800"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null);
                        const res = await previewFieldPurgeAction(f.id);
                        if (!res.ok) {
                          setError(res.error);
                          return;
                        }
                        setPurgeTarget(f);
                        setPurgeImpact(res.impact);
                        setPurgeConfirm('');
                        setPurgeBackupReady(false);
                      })
                    }
                  >
                    永久刪除…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {purgeTarget && purgeImpact && (
        <section className="card space-y-3 border-red-200 p-4 text-sm">
          <h2 className="text-lg font-semibold text-red-900">永久刪除確認</h2>
          <p className="text-red-950">
            永久刪除後，此欄位及所列範圍內的資料無法從系統介面恢復。若只是不想繼續使用，請選擇「暫時隱藏」。
          </p>
          <ul className="list-disc space-y-1 pl-5 text-td-blue-dark">
            <li>
              {purgeImpact.label}（{purgeImpact.fieldType}）· 資產有值 {purgeImpact.assetFilledCount} · 盤點有值{' '}
              {purgeImpact.inventoryFilledCount}
            </li>
            {purgeImpact.dependencies.map((d) => (
              <li key={d} className="text-amber-900">
                {d}
              </li>
            ))}
          </ul>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="font-medium">會刪除</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {purgeImpact.willDelete.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">不會刪除／無法保證銷毀</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {purgeImpact.willNotDelete.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <label className="block text-sm">
            請輸入欄位名稱「{purgeImpact.label}」以確認
            <input
              className="mt-1 w-full rounded border px-2 py-1.5"
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
            />
          </label>
          <p className="text-xs text-td-muted">
            永久刪除前必須先下載備份 JSON（含欄位定義與有值資料）。刪除完成後伺服器會再寫入完成標記，供備份還原程序辨識。
            {purgeBackupReady ? ' · 已下載預覽備份' : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setPurgeTarget(null); setPurgeImpact(null); setPurgeBackupReady(false); }}>
              取消
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await downloadFieldPurgeBackupPreviewAction(purgeTarget.id);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  const blob = new Blob([res.json], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = res.fileName;
                  a.click();
                  URL.revokeObjectURL(url);
                  setPurgeBackupReady(true);
                })
              }
            >
              下載刪除前備份
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={pending}
              onClick={() => {
                setPurgeTarget(null);
                setPurgeImpact(null);
                setPurgeBackupReady(false);
                setNotice('已改為保留隱藏狀態（未刪除資料）。');
              }}
            >
              改為隱藏
            </button>
            <button
              type="button"
              className="btn-primary bg-red-800"
              disabled={
                pending ||
                !purgeBackupReady ||
                purgeConfirm.trim() !== purgeImpact.label ||
                Boolean(purgeImpact.systemBinding)
              }
              onClick={() =>
                start(async () => {
                  const res = await purgeAssetFieldAction({
                    fieldId: purgeTarget.id,
                    expectedVersion: purgeTarget.version,
                    confirmLabel: purgeConfirm,
                    idempotencyKey: crypto.randomUUID(),
                  });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setFields((prev) => prev.filter((x) => x.id !== purgeTarget.id));
                  setPurgeTarget(null);
                  setPurgeImpact(null);
                  setPurgeBackupReady(false);
                  const href = `/api/assets/fields/purge-backup/${res.jobId}`;
                  setNotice(`永久刪除已完成。伺服器備份：${href}`);
                })
              }
            >
              永久刪除
            </button>
          </div>
        </section>
      )}

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="font-semibold">辨識永久刪除備份（還原用）</h2>
        <p className="text-xs text-td-muted">上傳／貼上備份 JSON，確認還原程序是否應略過已刪除欄位值。</p>
        <input
          type="file"
          accept="application/json,.json"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            start(async () => {
              setRecognizeNote(null);
              setError(null);
              const text = await file.text();
              const res = await recognizeFieldPurgeBackupAction(text);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setRecognizeNote(res.message);
            });
          }}
        />
        {recognizeNote && <p className="text-td-blue-dark">{recognizeNote}</p>}
      </section>
    </div>
  );
}
