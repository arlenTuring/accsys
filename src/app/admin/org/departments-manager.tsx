'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import { moveDepartmentAction, saveDepartmentAction, setDepartmentActiveAction } from '@/lib/admin/org/actions';
import type { OrgDepartmentRow, OrgDirectory } from '@/lib/admin/org/queries';
import { ActionMessage, EmployeeSelect, InUseNote, Section, dangerBtn, employeeLabel, smallBtn, smallInput, useOrgAction } from './org-ui';

type Draft = { id: string | null; code: string; name: string; parentId: string; orgLevelId: string; managerId: string; sortOrder: string };
type DropMode = 'before' | 'inside' | 'after';
type DropHint = { targetId: string; mode: DropMode } | { targetId: 'root'; mode: 'after' };

const DROP_STYLES: Record<DropMode, string> = {
  before: 'border-t-2 border-t-td-blue',
  inside: 'ring-2 ring-inset ring-td-blue',
  after: 'border-b-2 border-b-td-blue',
};

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

function DepartmentDetail({ department, data }: { department: OrgDepartmentRow; data: OrgDirectory }) {
  const members = data.employees.filter((e) => e.active && e.departmentId === department.id);
  const manager = data.employees.find((e) => e.id === department.managerId);
  const bindings = data.jobRoles.flatMap((r) =>
    r.holders.filter((h) => h.departmentId === department.id).map((h) => ({ ...h, role: r, employee: data.employees.find((e) => e.id === h.employeeId) }))
  );
  return (
    <div className="mt-4 space-y-3 border-t border-td-border pt-3 text-sm">
      <div>
        <h3 className="text-xs font-semibold text-td-blue-dark">主管</h3>
        <p>{manager ? `${manager.code} ${manager.name}` : <span className="text-amber-700">未設定</span>}</p>
      </div>
      <div>
        <h3 className="text-xs font-semibold text-td-blue-dark">成員（{members.length}）</h3>
        {members.length === 0 ? (
          <p className="text-xs text-td-muted">沒有在職員工。</p>
        ) : (
          <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
            {members.map((e) => (
              <li key={e.id}>
                {e.code} {e.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-xs font-semibold text-td-blue-dark">本部門範圍的職務（{bindings.length}）</h3>
        {bindings.length === 0 ? (
          <p className="text-xs text-td-muted">沒有綁定在本部門的職務；全公司範圍的職務請看「職務類別」頁。</p>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {bindings.map((b) => (
              <li key={b.bindingId}>
                {b.role.name}：{b.employee ? `${b.employee.code} ${b.employee.name}` : '（已不存在）'}
                {b.isPrimary ? '・主要' : ''}
                {b.employee && !b.employee.active ? <span className="text-red-700">・已停用</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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

  const [dragId, setDragId] = useState<string | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const dragBlocked = useMemo(() => (dragId ? subtree(dragId, departments) : new Set<string>()), [dragId, departments]);
  const byId = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const parentOf = (d: OrgDepartmentRow) => (d.parentId && byId.has(d.parentId) ? d.parentId : null);

  const dropMode = (e: DragEvent<HTMLElement>, target: OrgDepartmentRow): DropMode => {
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    if (y < 0.25) return 'before';
    if (y > 0.75) return 'after';
    return target.active ? 'inside' : 'after';
  };
  const onDragOver = (e: DragEvent<HTMLElement>, target: OrgDepartmentRow) => {
    if (!dragId || dragBlocked.has(target.id)) return;
    e.preventDefault();
    const mode = dropMode(e, target);
    if (hint?.targetId !== target.id || hint.mode !== mode) setHint({ targetId: target.id, mode });
  };
  const endDrag = () => {
    setDragId(null);
    setHint(null);
  };
  const move = (moving: OrgDepartmentRow, parentId: string | null, beforeId: string | null) =>
    run(() => moveDepartmentAction({ id: moving.id, parentId, beforeId }), `已移動「${moving.name}」`);
  const onDrop = (e: DragEvent<HTMLElement>, target: OrgDepartmentRow) => {
    e.preventDefault();
    const moving = dragId ? byId.get(dragId) : undefined;
    endDrag();
    if (!moving || dragBlocked.has(target.id)) return;
    const mode = dropMode(e, target);
    if (mode === 'inside') return move(moving, target.id, null);
    const parentId = parentOf(target);
    if (mode === 'before') return move(moving, parentId, target.id);
    const level = departments.filter((d) => parentOf(d) === parentId && d.id !== moving.id);
    move(moving, parentId, level[level.findIndex((d) => d.id === target.id) + 1]?.id ?? null);
  };
  const onDropRoot = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const moving = dragId ? byId.get(dragId) : undefined;
    endDrag();
    if (moving) move(moving, null, null);
  };

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
        description="設定主管與層級；可拖拉調整上下層與排序。"
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
              <li
                key={d.id}
                draggable={d.active && !pending}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', d.id);
                  setDragId(d.id);
                }}
                onDragOver={(e) => onDragOver(e, d)}
                onDrop={(e) => onDrop(e, d)}
                onDragEnd={endDrag}
                className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${draft?.id === d.id ? 'bg-td-blue-light/60' : ''} ${
                  hint?.targetId === d.id ? DROP_STYLES[hint.mode] : ''
                } ${dragId === d.id ? 'opacity-50' : ''}`}
              >
                <span style={{ paddingLeft: `${depth * 1.25}rem` }} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  {d.active && (
                    <span className="cursor-grab select-none text-td-muted" title="拖拉調整位置" aria-hidden>
                      ⋮⋮
                    </span>
                  )}
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
        {dragId && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (hint?.targetId !== 'root') setHint({ targetId: 'root', mode: 'after' });
            }}
            onDrop={onDropRoot}
            className={`rounded border-2 border-dashed px-3 py-3 text-center text-xs text-td-muted ${hint?.targetId === 'root' ? 'border-td-blue bg-td-blue-light/40' : 'border-td-border'}`}
          >
            拖到這裡：移到最上層（排在最後）
          </div>
        )}
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
                    onClick={async () => {
                      if (await confirmDialog({ title: `停用部門「${editing.name}」？`, confirmLabel: '停用', tone: 'danger' })) {
                        run(() => setDepartmentActiveAction(editing.id, false), '部門已停用', () => setDraft(null));
                      }
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
          {editing && <DepartmentDetail department={editing} data={data} />}
        </Section>
      )}
    </div>
    </div>
  );
}
