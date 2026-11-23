'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inputCls } from '@/app/components/form-fields';
import { ASSET_STATUS_LABELS } from '@/lib/asset-transfers/constants';
import { updateAndConfirmHandoverLinesAction } from '@/lib/assets/actions';
import {
  EXISTENCE_FACT_LABELS,
  type ExistenceFact,
  type HandoverFormDetail,
  type HandoverLineItem,
} from '@/lib/assets/inventory-form-constants';
import type { RegisterRow } from '@/lib/assets/queries';

type CustodianAbnormalFact = Exclude<ExistenceFact, 'exists'>;
const CUSTODIAN_ABNORMAL_FACTS: CustodianAbnormalFact[] = [
  'exists_damaged',
  'missing',
];

function formatDateTimeTw(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ');
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

type ActiveHandoverContext = {
  form: HandoverFormDetail;
  line: HandoverLineItem;
};

type ModifyDraftState = {
  row: RegisterRow;
  form: HandoverFormDetail;
  line: HandoverLineItem;
  existenceFact: CustodianAbnormalFact;
  physicalQuantity: number;
  newLocation: string;
  explanation: string;
};

export function InventoryConfirmClient({
  rows,
  currentScope,
  canViewDepartment,
  openForms = [],
  initialHandoverId = null,
}: {
  rows: RegisterRow[];
  currentScope: 'mine' | 'department';
  canReviewInventory: boolean;
  canViewDepartment: boolean;
  openForms?: HandoverFormDetail[];
  initialHandoverId?: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 預設不直接打開盤點單，使用者點選【財產清點單 INV-...】標題後才進入盤點模式使用下方清單做盤點動作
  const [activeFormId, setActiveFormId] = useState<string | null>(() => {
    if (
      initialHandoverId &&
      openForms.some((f) => f.id === initialHandoverId)
    ) {
      return initialHandoverId;
    }
    return null;
  });

  // 保管人在清單中按下「修改」的明細 ID（line.id），展開 ① 確認此物品之存在事實 與 ② 點交其他說明
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [modifyDraft, setModifyDraft] = useState<ModifyDraftState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeForm = useMemo(
    () => openForms.find((f) => f.id === activeFormId) ?? null,
    [openForms, activeFormId]
  );

  // 僅當使用者點開某張【財產清點單】時，才將該單明細映射至下方資產清單
  const handoverMap = useMemo(() => {
    const byAssetId = new Map<string, ActiveHandoverContext>();
    const byTag = new Map<string, ActiveHandoverContext>();
    if (!activeForm) return { byAssetId, byTag };

    for (const line of activeForm.lines) {
      const ctx: ActiveHandoverContext = { form: activeForm, line };
      if (line.assetId && !byAssetId.has(line.assetId)) {
        byAssetId.set(line.assetId, ctx);
      }
      if (line.assetTag && !byTag.has(line.assetTag)) {
        byTag.set(line.assetTag, ctx);
      }
    }
    return { byAssetId, byTag };
  }, [activeForm]);

  const getHandoverForRow = (r: RegisterRow): ActiveHandoverContext | null => {
    return (
      handoverMap.byAssetId.get(r.id) ?? handoverMap.byTag.get(r.tag) ?? null
    );
  };

  // 是否已點開清點單進入盤點模式
  const isInventoryMode = activeForm !== null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!q) return true;
      return [
        r.tag,
        r.name,
        r.custodianName,
        r.custodyDepartmentName ?? '',
        r.location,
        r.itemKind ?? '',
        r.description ?? '',
      ].some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query]);

  // 檢查是否為該盤點單最後一筆未確認項目（若是，完成後即自動封存至財產清單紀錄）
  const isLastUnconfirmedInForm = (
    form: HandoverFormDetail,
    currentLineId: string
  ): boolean => {
    return form.lines.every(
      (l) => l.id === currentLineId || l.state.custodianConfirmed
    );
  };

  // 保管人在清單直接點擊「確認」
  const handleQuickConfirmLine = async (
    form: HandoverFormDetail,
    line: HandoverLineItem,
    row: RegisterRow
  ) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const effectiveLocation =
      line.state.originalLocation || row.location || '';
    const willFinishAll = isLastUnconfirmedInForm(form, line.id);

    const res = await updateAndConfirmHandoverLinesAction({
      batchId: form.id,
      lineIds: [line.id],
      party: 'custodian',
      confirm: true,
      locationAction: 'agree_current',
      confirmedLocation: effectiveLocation,
      changeType: 'none',
      confirmedStatus: row.status ?? line.state.originalStatus,
      existenceFact: 'exists',
      physicalQuantity: line.state.bookQuantity || row.quantity || 1,
      custodianNote: '',
    });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    if (editingLineId === line.id) {
      setEditingLineId(null);
      setModifyDraft(null);
    }

    if (willFinishAll) {
      setActiveFormId(null);
      setNotice(
        `✅ 【財產清點單 ${form.formNumber}】已全部盤點完成並封存至「財產清單紀錄」！`
      );
    } else {
      setNotice(`✅ 已完成「${row.tag}（${row.name}）」確認！`);
    }
    router.refresh();
  };

  // 保管人在清單點擊「修改」展開 ① 與 ②
  const toggleModifyLine = (
    form: HandoverFormDetail,
    line: HandoverLineItem,
    row: RegisterRow
  ) => {
    setError(null);
    if (editingLineId === line.id) {
      setEditingLineId(null);
      setModifyDraft(null);
      return;
    }
    const initFact: CustodianAbnormalFact =
      line.state.existenceFact === 'missing' ? 'missing' : 'exists_damaged';
    setEditingLineId(line.id);
    setModifyDraft({
      row,
      form,
      line,
      existenceFact: initFact,
      physicalQuantity:
        line.state.existenceFact === 'missing'
          ? 0
          : line.physicalQuantity || row.quantity || line.state.bookQuantity,
      newLocation:
        line.state.confirmedLocation ||
        line.state.originalLocation ||
        row.location ||
        '',
      explanation: line.state.custodianNote ?? '',
    });
  };

  // 送出保管人「修改」內容
  const handleSubmitModifyDraft = async (andRedirectToTransfer = false) => {
    if (!modifyDraft) return;
    setError(null);
    setNotice(null);

    const {
      row,
      form,
      line,
      existenceFact,
      physicalQuantity,
      newLocation,
      explanation,
    } = modifyDraft;
    const trimmedLoc = newLocation.trim();
    const trimmedNote = explanation.trim();
    const willFinishAll = isLastUnconfirmedInForm(form, line.id);

    setBusy(true);
    const effectiveLocation =
      trimmedLoc || line.state.originalLocation || row.location || '';

    const res = await updateAndConfirmHandoverLinesAction({
      batchId: form.id,
      lineIds: [line.id],
      party: 'custodian',
      confirm: true,
      locationAction: 'change_needed',
      confirmedLocation: effectiveLocation,
      changeType:
        existenceFact === 'exists_damaged'
          ? 'scrap_or_idle'
          : 'location_change',
      confirmedStatus: row.status ?? line.state.originalStatus,
      existenceFact,
      physicalQuantity,
      custodianNote: trimmedNote,
    });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setEditingLineId(null);
    setModifyDraft(null);

    if (andRedirectToTransfer) {
      const qs = new URLSearchParams();
      qs.set('assetId', row.id);
      if (trimmedLoc) qs.set('newLocation', trimmedLoc);
      if (trimmedNote) qs.set('remark', trimmedNote);
      router.push(`/asset-transfers/new?${qs.toString()}`);
      return;
    }

    if (willFinishAll) {
      setActiveFormId(null);
      setNotice(
        `✅ 【財產清點單 ${form.formNumber}】已全部盤點完成並封存至「財產清單紀錄」！`
      );
    } else {
      setNotice(
        `✏️ 已提交「${row.tag}（${row.name}）」的修改（${EXISTENCE_FACT_LABELS[existenceFact]}）與說明。`
      );
    }
    router.refresh();
  };

  const renderModifyPanel = (
    form: HandoverFormDetail,
    line: HandoverLineItem,
    row: RegisterRow
  ) => {
    if (!modifyDraft || modifyDraft.line.id !== line.id) return null;
    const bookQty = row.quantity ?? line.state.bookQuantity;
    const unitLabel = row.unit ?? line.state.unit ?? '台';
    const origLoc = row.location || line.state.originalLocation || '未填';
    const custName = row.custodianName || form.custodianName;

    return (
      <div className="grid gap-4 rounded-xl border border-amber-300 bg-white p-4 shadow-sm lg:grid-cols-12">
        {/* ① 確認此物品之存在事實（僅損壞／待修／不堪用、未尋獲，不含實盤正常） */}
        <div className="lg:col-span-5 space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
          <div className="text-xs font-bold text-slate-900">
            ① 確認此物品之存在事實
          </div>
          <div className="space-y-1.5">
            {CUSTODIAN_ABNORMAL_FACTS.map((fact) => (
              <label
                key={fact}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                  modifyDraft.existenceFact === fact
                    ? fact === 'exists_damaged'
                      ? 'border-amber-500 bg-amber-50 font-semibold text-amber-950'
                      : 'border-rose-500 bg-rose-50 font-semibold text-rose-950'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name={`mine-exist-${line.id}`}
                  checked={modifyDraft.existenceFact === fact}
                  onChange={() =>
                    setModifyDraft((m) =>
                      m
                        ? {
                            ...m,
                            existenceFact: fact,
                            physicalQuantity:
                              fact === 'missing'
                                ? 0
                                : m.physicalQuantity || bookQty,
                          }
                        : m
                    )
                  }
                />
                <span>{EXISTENCE_FACT_LABELS[fact]}</span>
              </label>
            ))}
          </div>
          <label className="block pt-1 text-xs font-semibold text-slate-700">
            實盤數量（帳載 {bookQty} {unitLabel}）
            <input
              type="number"
              min={0}
              value={modifyDraft.physicalQuantity}
              onChange={(e) =>
                setModifyDraft((m) =>
                  m
                    ? {
                        ...m,
                        physicalQuantity: Number(e.target.value) || 0,
                      }
                    : m
                )
              }
              className="field mt-1 w-full bg-white py-1 text-xs"
            />
          </label>
        </div>

        {/* ② 點交其他說明（僅保管人填寫，不顯示清點人說明） */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-slate-900">
              ② 點交其他說明（位置補充／異動備註）
            </div>
            <label className="block text-[11px] font-semibold text-slate-700">
              更改後之新實際位置（若位置有變動請修改）
              <input
                type="text"
                value={modifyDraft.newLocation}
                onChange={(e) =>
                  setModifyDraft((m) =>
                    m ? { ...m, newLocation: e.target.value } : m
                  )
                }
                placeholder={`目前登記位置：${origLoc}`}
                className="field mt-1 w-full bg-white py-1.5 text-xs"
              />
            </label>
            <label className="block text-[11px] font-semibold text-emerald-950">
              ✍️ 保管人（{custName}）說明：
              <input
                type="text"
                value={modifyDraft.explanation}
                onChange={(e) =>
                  setModifyDraft((m) =>
                    m ? { ...m, explanation: e.target.value } : m
                  )
                }
                placeholder="請填寫說明（如：目前放會議室、需改位置、預計轉移給誰、損壞狀況…）"
                className="field mt-1 w-full bg-white py-1.5 text-xs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSubmitModifyDraft(true)}
              className="text-[11px] font-bold text-indigo-700 underline hover:text-indigo-900"
            >
              提交說明並直接帶入《資產異動申請單》→
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditingLineId(null);
                  setModifyDraft(null);
                }}
                className="btn-secondary text-xs"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSubmitModifyDraft(false)}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? '儲存中…' : '儲存修改並確認'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <span>{notice}</span>
          <Link
            href="/asset-transfers"
            className="font-bold text-indigo-700 underline hover:text-indigo-900"
          >
            前往「財產清單紀錄」檢視 →
          </Link>
        </div>
      )}

      {/* 1. 簡化為【財產清點單 INV-...】標題列：預設不展開，使用者點進去才開始用下方清單做盤點動作 */}
      {openForms.length > 0 && (
        <div className="space-y-2">
          {openForms.map((form) => {
            const isOpened = activeFormId === form.id;
            return (
              <button
                key={form.id}
                type="button"
                onClick={() => {
                  setEditingLineId(null);
                  setModifyDraft(null);
                  setActiveFormId((prev) =>
                    prev === form.id ? null : form.id
                  );
                }}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  isOpened
                    ? 'border-indigo-500 bg-indigo-50/70 shadow-xs'
                    : 'border-indigo-200 bg-white hover:border-indigo-400 hover:bg-indigo-50/30'
                }`}
              >
                <span className="text-sm font-bold text-slate-900">
                  【財產清點單 {form.formNumber}】
                </span>
                <span className="text-xs font-semibold text-indigo-700">
                  {isOpened ? '結束盤點檢視 ▲' : '點此開始盤點 →'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. 工具列：範圍切換、搜尋、批次轉移 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {canViewDepartment && (
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-2xs">
              <Link
                href="/assets/mine?scope=mine"
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  currentScope === 'mine'
                    ? 'bg-td-blue text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                👤 我名下的資產
              </Link>
              <Link
                href="/assets/mine?scope=department"
                className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                  currentScope === 'department'
                    ? 'bg-td-blue text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                🏢 轄下部門資產
              </Link>
            </div>
          )}

          {selectedIds.length > 0 ? (
            <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/80 px-3 py-1.5">
              <span className="text-xs font-bold text-td-blue-dark">
                已勾選 {selectedIds.length} 項資產
              </span>
              <Link
                href={`/asset-transfers/new?assetIds=${encodeURIComponent(selectedIds.join(','))}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-td-blue px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-td-blue-dark"
              >
                ↪ 帶入《資產異動申請單》({selectedIds.length} 項) →
              </Link>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                取消勾選
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
              ☑️ 勾選下方多筆資產，即可一次帶入《資產異動申請單》辦理批次轉移
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-td-muted">
            共 {filtered.length} 項資產
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋財產編號、資產名稱、位置..."
            className={`${inputCls} w-64`}
          />
        </div>
      </div>

      {/* 3. 名下資產清單表格（點進【財產清點單】後，才在清單中顯示「確認」「修改」按鈕進行盤點） */}
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-td-border text-left text-xs text-td-muted">
              <th className="w-9 py-2.5 pr-2">
                <input
                  type="checkbox"
                  aria-label="全選資產"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((r) => selectedIds.includes(r.id))
                  }
                  onChange={() => {
                    const allIds = filtered.map((r) => r.id);
                    if (allIds.every((id) => selectedIds.includes(id))) {
                      setSelectedIds((prev) =>
                        prev.filter((id) => !allIds.includes(id))
                      );
                    } else {
                      setSelectedIds((prev) => [
                        ...new Set([...prev, ...allIds]),
                      ]);
                    }
                  }}
                />
              </th>
              <th className="py-2.5 pr-3">財產編號 / 種類</th>
              <th className="py-2.5 pr-3">資產名稱 / 規格說明</th>
              <th className="py-2.5 pr-3">保管人 / 部門</th>
              <th className="py-2.5 pr-3">數量</th>
              <th className="py-2.5 pr-3">物品存放位置</th>
              <th className="py-2.5 pr-3">保管狀態</th>
              {isInventoryMode && (
                <th className="py-2.5 pr-3">盤點點交狀態</th>
              )}
              <th className="py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-td-border">
            {filtered.map((r) => {
              const handoverCtx = isInventoryMode
                ? getHandoverForRow(r)
                : null;
              const line = handoverCtx?.line;
              const isCustodianConfirmed = Boolean(
                line?.state.custodianConfirmed
              );
              const isChangeNeeded =
                line?.state.locationAction === 'change_needed' ||
                (line?.state.existenceFact &&
                  line.state.existenceFact !== 'exists') ||
                Boolean(line?.state.custodianNote);
              const isEditingThisRow =
                Boolean(line && editingLineId === line.id);
              const isRowSelected = selectedIds.includes(r.id);
              const transferTargetIds =
                selectedIds.length > 0
                  ? isRowSelected
                    ? selectedIds
                    : [...selectedIds, r.id]
                  : [r.id];
              const transferHref = `/asset-transfers/new?assetIds=${encodeURIComponent(
                transferTargetIds.join(',')
              )}`;

              return (
                <Fragment key={r.id}>
                  <tr
                    className={`transition ${
                      isRowSelected
                        ? 'bg-blue-50/60 hover:bg-blue-50/90'
                        : 'hover:bg-slate-50/70'
                    }`}
                  >
                    <td className="py-3 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`選取 ${r.tag}`}
                        checked={isRowSelected}
                        onChange={() =>
                          setSelectedIds((prev) =>
                            prev.includes(r.id)
                              ? prev.filter((x) => x !== r.id)
                              : [...prev, r.id]
                          )
                        }
                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-td-blue"
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-mono font-bold text-td-blue-dark">
                        {r.tag}
                      </div>
                      <div className="text-xs text-td-muted">
                        {r.itemKind || r.accountingSubject || '一般資產'}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-td-blue-dark">
                        {r.name}
                      </div>
                      {r.description && (
                        <div className="text-xs text-td-muted">
                          {r.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <div className="font-medium text-slate-800">
                        {r.custodianName}
                      </div>
                      <div className="text-td-muted">
                        {r.custodyDepartmentName ?? r.custodianDepartment}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                      {r.quantity} {r.unit ?? '台'}
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <div className="font-semibold text-slate-800">
                        {r.location || '未填寫位置'}
                      </div>
                      {isInventoryMode &&
                        isCustodianConfirmed &&
                        isChangeNeeded && (
                          <div className="mt-1 space-y-0.5 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1 text-[11px] text-amber-950">
                            {line?.state.existenceFact &&
                              line.state.existenceFact !== 'exists' && (
                                <div className="font-bold">
                                  ⚠️{' '}
                                  {
                                    EXISTENCE_FACT_LABELS[
                                      line.state.existenceFact
                                    ]
                                  }
                                </div>
                              )}
                            {line?.state.confirmedLocation &&
                              line.state.confirmedLocation !==
                                line.state.originalLocation && (
                                <div className="font-semibold">
                                  📍 新位置：{line.state.confirmedLocation}
                                </div>
                              )}
                            {line?.state.custodianNote && (
                              <div>💬 說明：{line.state.custodianNote}</div>
                            )}
                          </div>
                        )}
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
                        {ASSET_STATUS_LABELS[r.status]}
                      </span>
                    </td>

                    {isInventoryMode && (
                      <td className="py-3 pr-3 text-xs">
                        {handoverCtx ? (
                          isCustodianConfirmed ? (
                            <div className="space-y-0.5">
                              {isChangeNeeded ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-900">
                                  ✏️ 已修改並提交說明
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800">
                                  ✅ 已確認
                                </span>
                              )}
                              <div className="text-[11px] text-slate-500">
                                {line?.state.inspectorConfirmed
                                  ? '🤝 清點人已複核'
                                  : `確認於 ${formatDateTimeTw(line?.state.custodianConfirmedAt)}`}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 font-bold text-amber-800 ring-1 ring-amber-300">
                              ⏳ 待確認
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">非本批清點範圍</span>
                        )}
                      </td>
                    )}

                    <td className="py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-2">
                        {isInventoryMode && handoverCtx && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleQuickConfirmLine(
                                  handoverCtx.form,
                                  handoverCtx.line,
                                  r
                                )
                              }
                              className={`rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs transition disabled:opacity-50 ${
                                isCustodianConfirmed && !isChangeNeeded
                                  ? 'border border-emerald-600 bg-emerald-50 text-emerald-800'
                                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
                              }`}
                            >
                              確認
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                toggleModifyLine(
                                  handoverCtx.form,
                                  handoverCtx.line,
                                  r
                                )
                              }
                              className={`rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs transition disabled:opacity-50 ${
                                isEditingThisRow || isChangeNeeded
                                  ? 'bg-amber-600 text-white hover:bg-amber-700'
                                  : 'border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
                              }`}
                            >
                              修改
                            </button>
                          </>
                        )}
                        <Link
                          href={transferHref}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold shadow-2xs transition ${
                            isRowSelected && selectedIds.length > 1
                              ? 'bg-td-blue text-white hover:bg-td-blue-dark'
                              : 'border border-td-blue/30 bg-white text-td-blue hover:bg-td-blue hover:text-white'
                          }`}
                        >
                          {selectedIds.length > 1 && isRowSelected
                            ? `↪ 轉移已選 (${selectedIds.length} 項)`
                            : selectedIds.length > 0 && !isRowSelected
                              ? `↪ 併入轉移 (${transferTargetIds.length} 項)`
                              : '↪ 轉移'}
                        </Link>
                      </div>
                    </td>
                  </tr>

                  {isEditingThisRow && handoverCtx && (
                    <tr className="bg-amber-50/40">
                      <td
                        colSpan={isInventoryMode ? 9 : 8}
                        className="px-4 py-3"
                      >
                        {renderModifyPanel(
                          handoverCtx.form,
                          handoverCtx.line,
                          r
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={isInventoryMode ? 9 : 8}
                  className="py-8 text-center text-sm text-td-muted"
                >
                  目前名下尚無符合條件的資產紀錄。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
