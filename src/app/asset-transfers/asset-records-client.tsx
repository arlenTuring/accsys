'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type {
  AssetListRecordItem,
  AssetRecordKind,
} from '@/lib/asset-transfers/queries';

function kindBadgeCls(kind: AssetRecordKind): string {
  switch (kind) {
    case 'inventory':
      return 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200';
    case 'transfer_in':
      return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
    case 'transfer_out':
      return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200';
  }
}

function stageBadgeCls(
  stage: AssetListRecordItem['stage'],
  statusLabel: string
): string {
  if (stage === 'in_progress') {
    return 'bg-amber-100 text-amber-900 ring-1 ring-amber-300';
  }
  if (stage === 'under_review') {
    return 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-300';
  }
  if (statusLabel.includes('駁回')) {
    return 'bg-rose-100 text-rose-800 ring-1 ring-rose-200';
  }
  if (statusLabel.includes('撤回')) {
    return 'bg-slate-200 text-slate-700';
  }
  return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
}

export function AssetRecordsClient({
  records,
}: {
  records: AssetListRecordItem[];
}) {
  const [kindFilter, setKindFilter] = useState<'all' | AssetRecordKind>('all');

  const counts = useMemo(() => {
    return {
      all: records.length,
      inventory: records.filter((r) => r.kind === 'inventory').length,
      transfer_in: records.filter((r) => r.kind === 'transfer_in').length,
      transfer_out: records.filter((r) => r.kind === 'transfer_out').length,
    };
  }, [records]);

  const filtered = useMemo(() => {
    if (kindFilter === 'all') return records;
    return records.filter((r) => r.kind === kindFilter);
  }, [records, kindFilter]);

  const activeRecords = useMemo(
    () =>
      filtered.filter(
        (r) => r.stage === 'in_progress' || r.stage === 'under_review'
      ),
    [filtered]
  );

  const archivedRecords = useMemo(
    () => filtered.filter((r) => r.stage === 'archived'),
    [filtered]
  );

  const renderRecordList = (
    items: AssetListRecordItem[],
    emptyText: string
  ) => {
    if (items.length === 0) {
      return (
        <div className="card py-8 text-center text-sm text-td-muted">
          {emptyText}
        </div>
      );
    }

    return (
      <ul className="card divide-y divide-td-border !p-0">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-slate-50"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${kindBadgeCls(
                      item.kind
                    )}`}
                  >
                    {item.kindLabel}
                  </span>
                  <span className="text-sm font-bold text-slate-900">
                    {item.title}
                  </span>
                </div>
                <div className="text-xs text-slate-600">{item.subtitle}</div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-td-muted">{item.dateText}</span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${stageBadgeCls(
                    item.stage,
                    item.statusLabel
                  )}`}
                >
                  {item.statusLabel}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-6">
      {/* 單據類型篩選列 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setKindFilter('all')}
          className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            kindFilter === 'all'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          全部單據 ({counts.all})
        </button>
        <button
          type="button"
          onClick={() => setKindFilter('inventory')}
          className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            kindFilter === 'inventory'
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          📋 盤點的單子 ({counts.inventory})
        </button>
        <button
          type="button"
          onClick={() => setKindFilter('transfer_in')}
          className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            kindFilter === 'transfer_in'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          📥 別人轉移給我的單子 ({counts.transfer_in})
        </button>
        <button
          type="button"
          onClick={() => setKindFilter('transfer_out')}
          className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
            kindFilter === 'transfer_out'
              ? 'bg-sky-600 text-white'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          📤 我轉移出去的單子 ({counts.transfer_out})
        </button>
      </div>

      {/* 第一區：執行中／審核中單據 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            ⏳ 執行中／審核中（{activeRecords.length}）
          </h2>
        </div>
        {renderRecordList(
          activeRecords,
          '目前沒有執行中或審核中的財產清點單與異動單。'
        )}
      </section>

      {/* 第二區：歷史封存紀錄（獨立一區） */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            📦 歷史封存紀錄（{archivedRecords.length}）
          </h2>
        </div>
        {renderRecordList(archivedRecords, '目前尚無已封存的歷史財產單據紀錄。')}
      </section>
    </div>
  );
}
