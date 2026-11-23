'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  completeInventoryHandoverFormAction,
  updateAndConfirmHandoverLinesAction,
} from '@/lib/assets/actions';
import {
  EXISTENCE_FACT_LABELS,
  type ExistenceFact,
  type HandoverFormDetail,
  type HandoverLineItem,
} from '@/lib/assets/inventory-form-constants';

type CustodianAbnormalFact = Exclude<ExistenceFact, 'exists'>;

const CUSTODIAN_ABNORMAL_FACTS: CustodianAbnormalFact[] = [
  'exists_damaged',
  'missing',
];

type DraftLineEdit = {
  /** 保管人異常選項：僅在按下「修改」後顯示，只有 exists_damaged 與 missing */
  existenceFact: CustodianAbnormalFact;
  physicalQuantity: number;
  confirmedLocation: string;
  custodianNote: string;
  /** 清點人異常說明：僅在按下「異常」後填寫 */
  inspectorNote: string;
};

function initDraftFromLine(line: HandoverLineItem): DraftLineEdit {
  const existingFact: CustodianAbnormalFact =
    line.state.existenceFact === 'missing' ? 'missing' : 'exists_damaged';
  return {
    existenceFact: existingFact,
    physicalQuantity:
      line.state.existenceFact === 'missing' ? 0 : line.physicalQuantity,
    confirmedLocation:
      line.state.confirmedLocation || line.state.originalLocation,
    custodianNote: line.state.custodianNote || '',
    inspectorNote: line.state.inspectorNote || '',
  };
}

function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function HandoverFormClient({
  detail,
  currentEmployeeName,
}: {
  detail: HandoverFormDetail;
  currentEmployeeName: string;
}) {
  const router = useRouter();

  // 保管人：哪些條目目前按下了「修改」展開 ① 確認此物品之存在事實 與 ② 點交其他說明
  const [custodianEditingIds, setCustodianEditingIds] = useState<Set<string>>(
    () => new Set()
  );

  // 清點人：哪些條目目前按下了「異常」展開說明輸入框
  const [inspectorAbnormalIds, setInspectorAbnormalIds] = useState<Set<string>>(
    () => new Set()
  );

  const [drafts, setDrafts] = useState<Record<string, DraftLineEdit>>(() => {
    const map: Record<string, DraftLineEdit> = {};
    for (const l of detail.lines) {
      map[l.id] = initDraftFromLine(l);
    }
    return map;
  });

  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const isLocked = detail.status === 'locked';
  // 依系統真實身份判定：本單財產擁有者本人且非本單清點人為 custodian；管理員賦予之財產清點人為 inspector
  const activeRole: 'custodian' | 'inspector' =
    detail.canActAsCustodian && !detail.canActAsInspector
      ? 'custodian'
      : detail.canActAsInspector
        ? 'inspector'
        : 'custodian';

  const getDraft = (line: HandoverLineItem): DraftLineEdit =>
    drafts[line.id] ?? initDraftFromLine(line);

  const updateDraft = (line: HandoverLineItem, patch: Partial<DraftLineEdit>) => {
    setDrafts((prev) => {
      const cur = prev[line.id] ?? initDraftFromLine(line);
      const next = { ...cur, ...patch };
      if (patch.existenceFact === 'missing') {
        next.physicalQuantity = 0;
      } else if (
        patch.existenceFact === 'exists_damaged' &&
        cur.existenceFact === 'missing' &&
        next.physicalQuantity === 0
      ) {
        next.physicalQuantity = line.state.bookQuantity;
      }
      return { ...prev, [line.id]: next };
    });
  };

  // 保管人直接按「確認」（無問題、正常確認）
  const handleCustodianQuickConfirm = (line: HandoverLineItem) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await updateAndConfirmHandoverLinesAction({
        batchId: detail.id,
        lineIds: [line.id],
        party: 'custodian',
        confirm: true,
        locationAction: 'agree_current',
        confirmedLocation: line.state.originalLocation,
        changeType: 'none',
        confirmedStatus: line.state.originalStatus,
        existenceFact: 'exists',
        physicalQuantity: line.state.bookQuantity,
        custodianNote: '',
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      setCustodianEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(line.id);
        return next;
      });
      setFeedback({
        ok: true,
        text: `✅ 【${line.assetTag} ${line.state.assetName}】已由保管人（${currentEmployeeName}）確認無誤！`,
      });
      router.refresh();
    });
  };

  // 保管人按「修改」後送出（含 ① 物品存在事實異常 與 ② 保管人說明）
  const handleCustodianSubmitModification = (line: HandoverLineItem) => {
    const d = getDraft(line);
    setFeedback(null);
    startTransition(async () => {
      const res = await updateAndConfirmHandoverLinesAction({
        batchId: detail.id,
        lineIds: [line.id],
        party: 'custodian',
        confirm: true,
        locationAction: 'change_needed',
        confirmedLocation:
          d.confirmedLocation.trim() || line.state.originalLocation,
        changeType:
          d.existenceFact === 'exists_damaged'
            ? 'scrap_or_idle'
            : 'location_change',
        confirmedStatus: line.state.originalStatus,
        existenceFact: d.existenceFact,
        physicalQuantity: d.physicalQuantity,
        custodianNote: d.custodianNote.trim(),
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      setCustodianEditingIds((prev) => {
        const next = new Set(prev);
        next.delete(line.id);
        return next;
      });
      setFeedback({
        ok: true,
        text: `✏️ 【${line.assetTag} ${line.state.assetName}】已由保管人（${currentEmployeeName}）提交修改與說明！`,
      });
      router.refresh();
    });
  };

  // 清點人直接按「確認」
  const handleInspectorQuickConfirm = (line: HandoverLineItem) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await updateAndConfirmHandoverLinesAction({
        batchId: detail.id,
        lineIds: [line.id],
        party: 'inspector',
        confirm: true,
        inspectorNote: '',
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      setInspectorAbnormalIds((prev) => {
        const next = new Set(prev);
        next.delete(line.id);
        return next;
      });
      setFeedback({
        ok: true,
        text: `✅ 【${line.assetTag} ${line.state.assetName}】已由清點人（${currentEmployeeName}）確認完成！`,
      });
      router.refresh();
    });
  };

  // 清點人按「異常」後填寫說明並送出
  const handleInspectorSubmitAbnormal = (line: HandoverLineItem) => {
    const d = getDraft(line);
    if (!d.inspectorNote.trim()) {
      setFeedback({
        ok: false,
        text: `請填寫【${line.assetTag} ${line.state.assetName}】的異常說明文字後再送出。`,
      });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const res = await updateAndConfirmHandoverLinesAction({
        batchId: detail.id,
        lineIds: [line.id],
        party: 'inspector',
        confirm: true,
        inspectorNote: d.inspectorNote.trim(),
      });
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      setInspectorAbnormalIds((prev) => {
        const next = new Set(prev);
        next.delete(line.id);
        return next;
      });
      setFeedback({
        ok: true,
        text: `⚠️ 【${line.assetTag} ${line.state.assetName}】已由清點人（${currentEmployeeName}）記錄異常說明並完成點交確認！`,
      });
      router.refresh();
    });
  };

  const handleBatchConfirm = (party: 'custodian' | 'inspector') => {
    const targetIds =
      selectedLineIds.size > 0
        ? [...selectedLineIds]
        : detail.lines
            .filter((l) =>
              party === 'custodian'
                ? !l.state.custodianConfirmed
                : !l.state.inspectorConfirmed
            )
            .map((l) => l.id);

    if (targetIds.length === 0) {
      setFeedback({
        ok: false,
        text: '所有財產明細皆已完成該角色的確認，或請先勾選要批次確認的項目。',
      });
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      for (const lineId of targetIds) {
        const line = detail.lines.find((l) => l.id === lineId);
        if (!line) continue;
        const res = await updateAndConfirmHandoverLinesAction(
          party === 'custodian'
            ? {
                batchId: detail.id,
                lineIds: [line.id],
                party: 'custodian',
                confirm: true,
                locationAction: 'agree_current',
                confirmedLocation: line.state.originalLocation,
                changeType: 'none',
                confirmedStatus: line.state.originalStatus,
                existenceFact: 'exists',
                physicalQuantity: line.state.bookQuantity,
                custodianNote: line.state.custodianNote,
              }
            : {
                batchId: detail.id,
                lineIds: [line.id],
                party: 'inspector',
                confirm: true,
                inspectorNote: line.state.inspectorNote,
              }
        );
        if (!res.ok) {
          setFeedback({ ok: false, text: res.error });
          router.refresh();
          return;
        }
      }
      const partyLabel = party === 'custodian' ? '保管人' : '清點人';
      setFeedback({
        ok: true,
        text: `✅ 已由${partyLabel}（${currentEmployeeName}）批次確認 ${targetIds.length} 條財產明細！`,
      });
      setSelectedLineIds(new Set());
      router.refresh();
    });
  };

  const handleCompleteForm = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await completeInventoryHandoverFormAction(detail.id);
      if (!res.ok) {
        setFeedback({ ok: false, text: res.error });
        return;
      }
      setFeedback({
        ok: true,
        text: `🎉 清點單 ${res.formNumber} 已因雙方每一條皆確認完成而正式結束結案！並已同步更新 ${res.updatedAssetCount} 筆財產保管清冊紀錄。`,
      });
      router.refresh();
    });
  };

  const toggleSelectLine = (id: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const unconfirmedLines = detail.lines.filter(
    (l) => !l.state.custodianConfirmed || !l.state.inspectorConfirmed
  );

  return (
    <div className="space-y-6">
      {/* 1. 表單主資訊與進度總覽 */}
      <section className="card space-y-4 border-2 border-indigo-200 bg-gradient-to-r from-indigo-50/50 via-white to-emerald-50/40">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mono-case rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">
                {detail.formNumber}
              </span>
              {isLocked ? (
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                  ✅ 雙方每一條皆已確認 · 已正式結束結案
                </span>
              ) : detail.allLinesConfirmedByBoth ? (
                <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white">
                  🎯 雙方每一條皆已確認 · 可點擊結束本單
                </span>
              ) : (
                <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white">
                  ⏳ 點交確認進行中（須雙方每一條都確認後才可結束）
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-slate-900">{detail.label}</h2>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
              <div className="text-[11px] text-emerald-800">✍️ 保管人已確認</div>
              <div className="text-base font-extrabold text-emerald-900">
                {detail.custodianConfirmedLines} / {detail.totalLines}
              </div>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2">
              <div className="text-[11px] text-indigo-800">🔍 清點人已確認</div>
              <div className="text-base font-extrabold text-indigo-900">
                {detail.inspectorConfirmedLines} / {detail.totalLines}
              </div>
            </div>
            <div className="rounded-xl border border-slate-300 bg-slate-100 px-3 py-2">
              <div className="text-[11px] text-slate-700">🤝 雙方皆已確認</div>
              <div className="text-base font-extrabold text-slate-900">
                {detail.bothConfirmedLines} / {detail.totalLines}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-slate-500">👤 保管人（財產擁有者）：</span>
            <div className="mt-0.5 font-bold text-slate-900">
              {detail.custodianName}{' '}
              <span className="font-mono text-slate-500">
                ({detail.custodianEmployeeCode})
              </span>
              {detail.custodianDepartmentName
                ? ` · ${detail.custodianDepartmentName}`
                : ''}
            </div>
          </div>
          <div>
            <span className="text-slate-500">🔍 清點人：</span>
            <div className="mt-0.5 font-bold text-slate-900">
              {detail.inspectorName}{' '}
              <span className="font-mono text-slate-500">
                ({detail.inspectorEmployeeCode})
              </span>
            </div>
          </div>
          <div>
            <span className="text-slate-500">🕒 指定清點／點交時間：</span>
            <div className="mt-0.5 font-bold text-indigo-700">
              {detail.scheduledAt
                ? detail.scheduledAt.replace('T', ' ')
                : '未指定'}
            </div>
          </div>
          <div>
            <span className="text-slate-500">📍 點交地點：</span>
            <div className="mt-0.5 font-semibold text-slate-800">
              {detail.meetingLocation || '原保管現場'}
            </div>
          </div>
          {detail.instructions && (
            <div className="sm:col-span-2 lg:col-span-4 border-t border-slate-100 pt-2 text-slate-700">
              <span className="font-semibold text-slate-800">📋 清點說明：</span>
              {detail.instructions}
            </div>
          )}
        </div>

        {/* 批次快速操作與結案門檻控制列 */}
        {!isLocked && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {activeRole === 'custodian' && detail.canActAsCustodian && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleBatchConfirm('custodian')}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  ✅ 保管人一鍵確認
                  {selectedLineIds.size > 0
                    ? `已勾選 (${selectedLineIds.size})`
                    : '全部未確認項目'}
                </button>
              )}

              {activeRole === 'inspector' && detail.canActAsInspector && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleBatchConfirm('inspector')}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  ✅ 清點人一鍵確認
                  {selectedLineIds.size > 0
                    ? `已勾選 (${selectedLineIds.size})`
                    : '全部未確認項目'}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending || !detail.allLinesConfirmedByBoth}
                onClick={handleCompleteForm}
                className={`rounded-xl px-4 py-2 text-xs font-extrabold shadow transition ${
                  detail.allLinesConfirmedByBoth
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800 ring-2 ring-emerald-300'
                    : 'cursor-not-allowed bg-slate-200 text-slate-500'
                }`}
              >
                {detail.allLinesConfirmedByBoth
                  ? '🎉 雙方每一條皆已確認 — 正式結束此清點單（結案）'
                  : `🔒 尚有 ${unconfirmedLines.length} 條未完成雙方確認`}
              </button>
            </div>
          </div>
        )}

        {isLocked && (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-950">
            ✅ 此張財產清點單已於{' '}
            <strong>{fmtDateTime(detail.lockedAt)}</strong>{' '}
            完成雙方每一條明細確認並正式結束結案。
          </div>
        )}

        {feedback && (
          <div
            className={`rounded-xl border px-4 py-2.5 text-xs font-semibold ${
              feedback.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-rose-300 bg-rose-50 text-rose-800'
            }`}
          >
            {feedback.text}
          </div>
        )}
      </section>

      {/* 2. 物品清單：依身分顯示預設按鈕（保管人：確認／修改；清點人：確認／異常） */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">
            📦 財產清點明細（共 {detail.totalLines} 條）
          </h3>
          {!isLocked && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() =>
                  setSelectedLineIds(new Set(detail.lines.map((l) => l.id)))
                }
                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
              >
                全選明細
              </button>
              <button
                type="button"
                onClick={() => setSelectedLineIds(new Set())}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50"
              >
                取消勾選
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {detail.lines.map((line) => {
            const d = getDraft(line);
            const bothDone =
              line.state.custodianConfirmed && line.state.inspectorConfirmed;
            const isChecked = selectedLineIds.has(line.id);
            const isCustodianEditing = custodianEditingIds.has(line.id);
            const isInspectorAbnormal = inspectorAbnormalIds.has(line.id);

            const custodianModified =
              line.state.locationAction === 'change_needed' ||
              line.state.existenceFact !== 'exists' ||
              Boolean(line.state.custodianNote);

            const inspectorMarkedAbnormal = Boolean(line.state.inspectorNote);

            return (
              <div
                key={line.id}
                className={`card space-y-3 border-2 transition ${
                  bothDone
                    ? 'border-emerald-300 bg-emerald-50/15'
                    : line.state.custodianConfirmed ||
                        line.state.inspectorConfirmed
                      ? 'border-indigo-200 bg-white'
                      : 'border-slate-200 bg-white'
                }`}
              >
                {/* 單列主資訊 + 右側身分操作按鈕（「確認／修改」或「確認／異常」） */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    {!isLocked && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectLine(line.id)}
                        className="mt-1 h-4 w-4"
                      />
                    )}
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white">
                          第 {line.lineNo} 條
                        </span>
                        <span className="mono-case text-sm font-extrabold text-indigo-950">
                          {line.assetTag}
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {line.state.assetName}
                        </span>
                        {line.state.itemKind && (
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                            種類：{line.state.itemKind}
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          帳載數量：{line.state.bookQuantity}{' '}
                          {line.state.unit || '台'}
                        </span>
                        <span className="rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
                          目前登記位置：{line.state.originalLocation}
                        </span>
                      </div>

                      {line.state.description && (
                        <p className="text-xs text-slate-500">
                          規格／財產描述：{line.state.description}
                        </p>
                      )}

                      {/* 狀態與紀錄摘要：
                          - 清點人可唯讀看到保管人填寫的狀態與說明（不可修改）
                          - 保管人看不到清點人寫的說明文字 */}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                        {line.state.custodianConfirmed ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                              custodianModified
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {custodianModified
                              ? `✏️ 保管人已修改（${EXISTENCE_FACT_LABELS[line.state.existenceFact]}，實盤 ${line.physicalQuantity} ${line.state.unit || '台'}）`
                              : '✅ 保管人已確認'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">
                            ⏳ 待保管人確認
                          </span>
                        )}

                        {line.state.inspectorConfirmed ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold ${
                              inspectorMarkedAbnormal
                                ? 'bg-rose-100 text-rose-900'
                                : 'bg-indigo-100 text-indigo-800'
                            }`}
                          >
                            {inspectorMarkedAbnormal
                              ? '⚠️ 清點人標記異常'
                              : '✅ 清點人已確認'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600">
                            ⏳ 待清點人確認
                          </span>
                        )}
                      </div>

                      {/* 保管人填寫的說明：保管人自己可見，清點人僅可唯讀檢視、無法修改 */}
                      {line.state.custodianNote && (
                        <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-950">
                          <span className="font-bold">
                            👤 保管人（{detail.custodianName}）說明：
                          </span>
                          <span>{line.state.custodianNote}</span>
                          {line.state.confirmedLocation &&
                            line.state.confirmedLocation !==
                              line.state.originalLocation && (
                              <span className="ml-2 font-semibold text-indigo-800">
                                （新位置：{line.state.confirmedLocation}）
                              </span>
                            )}
                        </div>
                      )}

                      {/* 清點人填寫的異常說明：只有清點人看得到，保管人看不到 */}
                      {activeRole === 'inspector' &&
                        line.state.inspectorNote && (
                          <div className="mt-1 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs text-rose-950">
                            <span className="font-bold">
                              🔍 清點人（{detail.inspectorName}）異常說明：
                            </span>
                            <span>{line.state.inspectorNote}</span>
                          </div>
                        )}
                    </div>
                  </div>

                  {/* 右側操作按鈕區 */}
                  {!isLocked && (
                    <div className="flex flex-wrap items-center gap-2">
                      {activeRole === 'custodian' && detail.canActAsCustodian && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleCustodianQuickConfirm(line)}
                            className={`rounded-lg px-4 py-1.5 text-xs font-bold shadow-xs transition disabled:opacity-50 ${
                              line.state.custodianConfirmed && !custodianModified
                                ? 'border border-emerald-600 bg-emerald-50 text-emerald-800'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            確認
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setCustodianEditingIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(line.id)) next.delete(line.id);
                                else next.add(line.id);
                                return next;
                              })
                            }
                            className={`rounded-lg px-4 py-1.5 text-xs font-bold shadow-xs transition disabled:opacity-50 ${
                              isCustodianEditing || custodianModified
                                ? 'bg-amber-600 text-white hover:bg-amber-700'
                                : 'border border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
                            }`}
                          >
                            修改
                          </button>
                        </>
                      )}

                      {activeRole === 'inspector' && detail.canActAsInspector && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleInspectorQuickConfirm(line)}
                            className={`rounded-lg px-4 py-1.5 text-xs font-bold shadow-xs transition disabled:opacity-50 ${
                              line.state.inspectorConfirmed &&
                              !inspectorMarkedAbnormal
                                ? 'border border-emerald-600 bg-emerald-50 text-emerald-800'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            確認
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setInspectorAbnormalIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(line.id)) next.delete(line.id);
                                else next.add(line.id);
                                return next;
                              })
                            }
                            className={`rounded-lg px-4 py-1.5 text-xs font-bold shadow-xs transition disabled:opacity-50 ${
                              isInspectorAbnormal || inspectorMarkedAbnormal
                                ? 'bg-rose-600 text-white hover:bg-rose-700'
                                : 'border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100'
                            }`}
                          >
                            異常
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* 保管人按下「修改」後才展開：① 確認此物品之存在事實（不含實盤正常） ＋ ② 點交其他說明 */}
                {!isLocked &&
                  activeRole === 'custodian' &&
                  detail.canActAsCustodian &&
                  isCustodianEditing && (
                    <div className="grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-12">
                      {/* ① 確認此物品之存在事實（僅保留損壞／待修／不堪用、未尋獲，移除物品存在實盤正常） */}
                      <div className="lg:col-span-5 space-y-2.5 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                        <div className="text-xs font-bold text-slate-900">
                          ① 確認此物品之存在事實
                        </div>
                        <div className="space-y-1.5">
                          {CUSTODIAN_ABNORMAL_FACTS.map((fact) => (
                            <label
                              key={fact}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
                                d.existenceFact === fact
                                  ? fact === 'exists_damaged'
                                    ? 'border-amber-500 bg-amber-50 font-semibold text-amber-950'
                                    : 'border-rose-500 bg-rose-50 font-semibold text-rose-950'
                                  : 'border-slate-200 bg-white text-slate-700'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`exist-${line.id}`}
                                checked={d.existenceFact === fact}
                                onChange={() =>
                                  updateDraft(line, { existenceFact: fact })
                                }
                              />
                              <span>{EXISTENCE_FACT_LABELS[fact]}</span>
                            </label>
                          ))}
                        </div>
                        <label className="block pt-1 text-xs font-semibold text-slate-700">
                          實盤數量（帳載 {line.state.bookQuantity}{' '}
                          {line.state.unit || '台'}）
                          <input
                            type="number"
                            min={0}
                            value={d.physicalQuantity}
                            onChange={(e) =>
                              updateDraft(line, {
                                physicalQuantity: Number(e.target.value) || 0,
                              })
                            }
                            className="field mt-1 w-full bg-white py-1 text-xs"
                          />
                        </label>
                      </div>

                      {/* ② 點交其他說明（僅顯示保管人自己的說明欄位，不顯示清點人欄位） */}
                      <div className="lg:col-span-7 flex flex-col justify-between space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                        <div className="space-y-2.5">
                          <div className="text-xs font-bold text-slate-900">
                            ② 點交其他說明（位置補充／異動備註）
                          </div>
                          <label className="block text-[11px] font-semibold text-slate-700">
                            更改後之新實際位置（若位置有變動請修改）
                            <input
                              type="text"
                              value={d.confirmedLocation}
                              onChange={(e) =>
                                updateDraft(line, {
                                  confirmedLocation: e.target.value,
                                })
                              }
                              placeholder={`目前登記位置：${line.state.originalLocation}`}
                              className="field mt-1 w-full bg-white py-1.5 text-xs"
                            />
                          </label>
                          <label className="block text-[11px] font-semibold text-emerald-950">
                            ✍️ 保管人（{detail.custodianName}）說明：
                            <input
                              type="text"
                              value={d.custodianNote}
                              onChange={(e) =>
                                updateDraft(line, {
                                  custodianNote: e.target.value,
                                })
                              }
                              placeholder="請填寫說明（如：目前放會議室、預計轉移給誰、損壞狀況…）"
                              className="field mt-1 w-full bg-white py-1.5 text-xs"
                            />
                          </label>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setCustodianEditingIds((prev) => {
                                const next = new Set(prev);
                                next.delete(line.id);
                                return next;
                              })
                            }
                            className="btn-secondary text-xs"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              handleCustodianSubmitModification(line)
                            }
                            className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 disabled:opacity-50"
                          >
                            儲存修改並確認
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                {/* 清點人按下「異常」後才展開：清點人填寫異常說明文字（且無法修改保管人寫的說明） */}
                {!isLocked &&
                  activeRole === 'inspector' &&
                  detail.canActAsInspector &&
                  isInspectorAbnormal && (
                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 space-y-2.5">
                        {line.state.custodianNote && (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            <span className="font-bold text-slate-800">
                              👤 保管人（{detail.custodianName}）填寫之說明（唯讀）：
                            </span>
                            <span>{line.state.custodianNote}</span>
                          </div>
                        )}
                        <label className="block text-xs font-bold text-rose-950">
                          🔍 清點人（{detail.inspectorName}）異常說明（保管人不會看到此說明）：
                          <input
                            type="text"
                            value={d.inspectorNote}
                            onChange={(e) =>
                              updateDraft(line, {
                                inspectorNote: e.target.value,
                              })
                            }
                            placeholder="請輸入清點異常說明文字（例如：現場未見實物、標籤脫落、位置與申報不符…）"
                            className="field mt-1.5 w-full bg-white py-1.5 text-xs"
                          />
                        </label>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              setInspectorAbnormalIds((prev) => {
                                const next = new Set(prev);
                                next.delete(line.id);
                                return next;
                              })
                            }
                            className="btn-secondary text-xs"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => handleInspectorSubmitAbnormal(line)}
                            className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
                          >
                            送出異常說明
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. 底部結案把關區 */}
      {!isLocked && (
        <section className="card flex flex-wrap items-center justify-between gap-4 border-2 border-slate-300 bg-slate-50">
          <div className="space-y-1 text-xs">
            <div className="font-bold text-slate-900">
              🏁 清點單結案條件：雙方每一條都確認後，這張單才可以結束
            </div>
            {detail.allLinesConfirmedByBoth ? (
              <p className="font-semibold text-emerald-700">
                ✅ 本單全部 {detail.totalLines} 條財產皆已由「保管人（
                {detail.custodianName}）」與「清點人（{detail.inspectorName}
                ）」雙方處理完畢，現在可以正式結束本單！
              </p>
            ) : (
              <p className="text-amber-800">
                ⚠️ 目前尚有 <strong>{unconfirmedLines.length}</strong>{' '}
                條財產未完成雙方確認（
                {unconfirmedLines
                  .slice(0, 5)
                  .map((l) => l.assetTag)
                  .join('、')}
                {unconfirmedLines.length > 5 ? '…' : ''}
                ），請雙方於上方逐條確認完成後再按結束。
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={pending || !detail.allLinesConfirmedByBoth}
            onClick={handleCompleteForm}
            className={`rounded-xl px-5 py-2.5 text-xs font-extrabold shadow transition ${
              detail.allLinesConfirmedByBoth
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'cursor-not-allowed bg-slate-200 text-slate-500'
            }`}
          >
            {detail.allLinesConfirmedByBoth
              ? '🎉 正式結束此張財產清點單（結案並同步清冊）'
              : '🔒 需雙方每一條都確認後才可結束'}
          </button>
        </section>
      )}
    </div>
  );
}
