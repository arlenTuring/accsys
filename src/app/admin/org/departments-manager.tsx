'use client';

import { useMemo, useState } from 'react';
import { saveDepartmentAction, setDepartmentActiveAction } from '@/lib/admin/org/actions';
import type { OrgDepartmentRow, OrgDirectory } from '@/lib/admin/org/queries';
import { ActionMessage, EmployeeSelect, InUseNote, Section, dangerBtn, employeeLabel, smallBtn, smallInput, useOrgAction } from './org-ui';

type Draft = { id: string | null; code: string; name: string; parentId: string; orgLevelId: string; managerId: string; sortOrder: string };

const blank = (parentId = ''): Draft => ({ id: null, code: '', name: '', parentId, orgLevelId: '', managerId: '', sortOrder: '0' });

function subtree(id: string, departments: OrgDepartmentRow[]): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of departments) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id);
        grew = true;
      }
    }
  }
  return out;
}

export function DepartmentsManager({ data }: { data: OrgDirectory }) {
  const { pending, msg, run } = useOrgAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const { departments, levels, employees, inUse } = data;

  const rows = useMemo(() => {
    const ids = new Set(departments.map((d) => d.id));
    const children = new Map<string | null, OrgDepartmentRow[]>();
    for (const d of departments) {
      const parent = d.parentId && ids.has(d.parentId) ? d.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), d]);
    }
    const out: { dept: OrgDepartmentRow; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const d of children.get(parent) ?? []) {
        if (!showInactive && !d.active) continue;
        out.push({ dept: d, depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [departments, showInactive]);

  const edit = (d: OrgDepartmentRow) =>
    setDraft({
      id: d.id,
      code: d.code,
      name: d.name,
      parentId: d.parentId ?? '',
      orgLevelId: d.orgLevelId ?? '',
      managerId: d.managerId ?? '',
      sortOrder: String(d.sortOrder),
    });

  const editing = draft?.id ? departments.find((d) => d.id === draft.id) : undefined;
  const blocked = draft?.id ? subtree(draft.id, departments) : new Set<string>();
  const parentChoices = departments.filter((d) => (d.active || d.id === draft?.parentId) && !blocked.has(d.id));
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = () => {
    if (!draft) return;
    run(
      () =>
        saveDepartmentAction(draft.id, {
          code: draft.code,
          name: draft.name,
          parentId: draft.parentId || null,
          orgLevelId: draft.orgLevelId || null,
          managerId: draft.managerId || null,
          sortOrder: draft.sortOrder,
        }),
      draft.id ? '部門已更新' : '部門已新增',
      () => setDraft(null)
    );
  };

  return (
    <div className="space-y-4">
    <ActionMessage msg={msg} />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Section
        title={`部門（${departments.filter((d) => d.active).length}）`}
        description="部門主管用在「部門主管」關卡；組織層級用在「組織層級」關卡（從申請部門往上找到指定層級的主管）。"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-td-muted">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              顯示已停用
            </label>
            <button type="button" className={smallBtn} onClick={() => setDraft(blank())}>
              新增部門
            </button>
          </div>
        }
      >
        <ul className="divide-y divide-td-border rounded border border-td-border">
          {rows.map(({ dept: d, depth }) => {
            const level = levels.find((l) => l.id === d.orgLevelId);
            const manager = employees.find((e) => e.id === d.managerId);
            return (
              <li key={d.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${draft?.id === d.id ? 'bg-td-blue-light/60' : ''}`}>
                <span style={{ paddingLeft: `${depth * 1.25}rem` }} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {depth > 0 && <span className="text-td-muted">└</span>}
                  <span className={`font-semibold ${d.active ? 'text-td-blue-dark' : 'text-slate-400 line-through'}`}>{d.name}</span>
                  <span className="mono-case text-xs">{d.code}</span>
                  {level && <span className="badge bg-slate-100 text-slate-700">{level.name}</span>}
                  {!d.active && <span className="badge-withdrawn">已停用</span>}
                  <InUseNote forms={inUse.departments[d.id]} />
                </span>
                <span className="text-xs text-td-muted">
                  主管：{manager ? employeeLabel(manager, departments) : <span className="text-amber-700">未設定</span>} · {d.employeeCount} 人
                </span>
                <span className="flex gap-1">
                  <button type="button" className={smallBtn} onClick={() => edit(d)}>
                    編輯
                  </button>
                  {d.active && (
                    <button type="button" className={smallBtn} onClick={() => setDraft(blank(d.id))}>
                      新增下層
                    </button>
                  )}
                </span>
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-td-muted">尚無部門</li>}
        </ul>
      </Section>

      {draft && (
        <Section title={draft.id ? `編輯：${editing?.name ?? ''}` : '新增部門'}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-td-blue-dark">部門代號</span>
              <input className={smallInput} value={draft.code} disabled={!!draft.id} maxLength={20} onChange={(e) => set({ code: e.target.value })} />
              {!draft.id && <span className="text-xs text-td-muted">英數字、底線或連字號，建立後不能修改</span>}
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-td-blue-dark">部門名稱</span>
              <input className={smallInput} value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-td-blue-dark">上層部門</span>
              <select className={smallInput} value={draft.parentId} onChange={(e) => set({ parentId: e.target.value })}>
                <option value="">（最上層）</option>
                {parentChoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.active ? '' : '【已停用】'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-td-blue-dark">組織層級</span>
              <select className={smallInput} value={draft.orgLevelId} onChange={(e) => set({ orgLevelId: e.target.value })}>
                <option value="">（未設定）</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}（{l.rank}）
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="text-xs font-semibold text-td-blue-dark">部門主管</span>
              <EmployeeSelect
                employees={employees}
                departments={departments}
                value={draft.managerId}
                onChange={(managerId) => set({ managerId })}
                placeholder="（未設定）"
                label="部門主管"
              />
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-td-blue-dark">排序</span>
              <input className={smallInput} type="number" min={0} max={9999} value={draft.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className="btn-primary !py-1.5" disabled={pending} onClick={save}>
                {pending ? '處理中…' : '儲存'}
              </button>
              <button type="button" className="btn-ghost !py-1.5" onClick={() => setDraft(null)}>
                取消
              </button>
              {editing &&
                (editing.active ? (
                  <button
                    type="button"
                    className={dangerBtn}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`停用部門「${editing.name}」？`)) run(() => setDepartmentActiveAction(editing.id, false), '部門已停用', () => setDraft(null));
                    }}
                  >
                    停用部門
                  </button>
                ) : (
                  <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => setDepartmentActiveAction(editing.id, true), '部門已啟用')}>
                    啟用部門
                  </button>
                ))}
            </div>
            {editing && <p className="text-xs text-td-muted">停用前需先移走在職員工與啟用中的下層部門，且不能被簽核流程使用。</p>}
          </div>
        </Section>
      )}
    </div>
    </div>
  );
}
