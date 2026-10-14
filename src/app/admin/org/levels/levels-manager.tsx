'use client';

import { useState } from 'react';
import { createLevelAction, deleteLevelAction, updateLevelAction } from '@/lib/admin/org/actions';
import type { OrgLevelRow } from '@/lib/admin/org/queries';
import { ActionMessage, InUseNote, Section, dangerBtn, smallBtn, smallInput, useOrgAction } from '../org-ui';

export function LevelsManager({ levels, inUse }: { levels: OrgLevelRow[]; inUse: Record<string, string[]> }) {
  const { pending, msg, run } = useOrgAction();
  const [edits, setEdits] = useState<Record<string, { name: string; rank: string }>>({});
  const [draft, setDraft] = useState({ code: '', name: '', rank: '' });

  const value = (l: OrgLevelRow) => edits[l.id] ?? { name: l.name, rank: String(l.rank) };
  const change = (l: OrgLevelRow, patch: Partial<{ name: string; rank: string }>) => setEdits((e) => ({ ...e, [l.id]: { ...value(l), ...patch } }));
  const dirty = (l: OrgLevelRow) => {
    const v = edits[l.id];
    return !!v && (v.name !== l.name || v.rank !== String(l.rank));
  };
  const forget = (id: string) =>
    setEdits((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });

  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <Section
        title="組織層級"
        description="數字越大層級越高（例如 組 10、處 20、事業群 30、總經理室 40）。「組織層級」關卡會從申請部門往上找主管，直到指定的層級；代號建立後不能修改，因為流程以代號引用。"
      >
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-td-muted">
            <tr>
              <th className="py-1">代號</th>
              <th>名稱</th>
              <th className="w-28">高低</th>
              <th>部門數</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {levels.map((l) => {
              const v = value(l);
              return (
                <tr key={l.id} className="border-t border-td-border">
                  <td className="py-2">
                    <span className="mono-case">{l.code}</span>
                  </td>
                  <td className="py-2 pr-2">
                    <input aria-label={`${l.code} 名稱`} className={smallInput} value={v.name} maxLength={30} onChange={(e) => change(l, { name: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    <input aria-label={`${l.code} 高低`} className={smallInput} type="number" min={1} max={1000} value={v.rank} onChange={(e) => change(l, { rank: e.target.value })} />
                  </td>
                  <td className="py-2">
                    {l.departmentCount} <InUseNote forms={inUse[l.code]} />
                  </td>
                  <td className="space-x-1 py-2 text-right">
                    {dirty(l) && (
                      <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => updateLevelAction(l.id, v), '層級已更新', () => forget(l.id))}>
                        儲存
                      </button>
                    )}
                    <button
                      type="button"
                      className={dangerBtn}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`刪除層級「${l.name}」？`)) run(() => deleteLevelAction(l.id), '層級已刪除');
                      }}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              );
            })}
            {levels.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-td-muted">
                  尚未設定組織層級
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <form
          className="grid gap-2 border-t border-dashed border-td-border pt-4 sm:grid-cols-[1fr_1fr_8rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createLevelAction(draft), '層級已新增', () => setDraft({ code: '', name: '', rank: '' }));
          }}
        >
          <input aria-label="新層級代號" className={smallInput} placeholder="代號，例如 division" value={draft.code} maxLength={40} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <input aria-label="新層級名稱" className={smallInput} placeholder="名稱，例如 處" value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input aria-label="新層級高低" className={smallInput} type="number" min={1} max={1000} placeholder="高低" value={draft.rank} onChange={(e) => setDraft({ ...draft, rank: e.target.value })} />
          <button type="submit" className="btn-secondary !py-1.5" disabled={pending}>
            新增層級
          </button>
        </form>
      </Section>
    </div>
  );
}
