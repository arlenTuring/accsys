'use client';

import { useState } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import { saveGroupAction, setGroupActiveAction, setGroupMembersAction } from '@/lib/admin/org/actions';
import type { OrgDirectory, OrgGroupRow } from '@/lib/admin/org/queries';
import { ActionMessage, EmployeeSelect, InUseNote, Section, dangerBtn, employeeLabel, smallBtn, smallInput, useOrgAction } from '../org-ui';

type Run = ReturnType<typeof useOrgAction>['run'];

export function GroupsManager({ data }: { data: OrgDirectory }) {
  const { pending, msg, run } = useOrgAction();
  const [draft, setDraft] = useState({ name: '', description: '' });
  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <Section title="新增員工群組" description="關卡依成員順序簽核；停用者略過。">
        <form
          className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveGroupAction(null, draft), '群組已新增', () => setDraft({ name: '', description: '' }));
          }}
        >
          <input aria-label="群組名稱" className={smallInput} placeholder="名稱，例如 財務覆核" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input aria-label="群組說明" className={smallInput} placeholder="說明（選填）" value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button type="submit" className="btn-secondary !py-1.5" disabled={pending}>
            新增
          </button>
        </form>
      </Section>
      {data.groups.map((g) => (
        <GroupCard key={`${g.id}:${g.memberIds.join(',')}`} group={g} data={data} pending={pending} run={run} />
      ))}
    </div>
  );
}

function GroupCard({ group, data, pending, run }: { group: OrgGroupRow; data: OrgDirectory; pending: boolean; run: Run }) {
  const [members, setMembers] = useState(group.memberIds);
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const dirty = members.join(',') !== group.memberIds.join(',');
  const move = (i: number, d: -1 | 1) =>
    setMembers((m) => {
      const next = [...m];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  return (
    <Section
      title={group.name}
      description={group.description || undefined}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {!group.active && <span className="badge-withdrawn">已停用</span>}
          <InUseNote forms={data.inUse.groups[group.id]} />
          <button type="button" className={smallBtn} onClick={() => setEditing({ name: group.name, description: group.description })}>
            編輯
          </button>
          {group.active ? (
            <button
              type="button"
              className={dangerBtn}
              disabled={pending}
              onClick={async () => {
                if (await confirmDialog({ title: `停用群組「${group.name}」？`, confirmLabel: '停用', tone: 'danger' })) run(() => setGroupActiveAction(group.id, false), '群組已停用');
              }}
            >
              停用
            </button>
          ) : (
            <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => setGroupActiveAction(group.id, true), '群組已啟用')}>
              啟用
            </button>
          )}
        </div>
      }
    >
      {editing && (
        <form
          className="grid gap-2 rounded border border-dashed border-td-border p-3 sm:grid-cols-[1fr_2fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveGroupAction(group.id, editing), '群組已更新', () => setEditing(null));
          }}
        >
          <input aria-label="群組名稱" className={smallInput} value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input aria-label="群組說明" className={smallInput} value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <button type="submit" className={smallBtn} disabled={pending}>
            儲存
          </button>
          <button type="button" className="text-xs text-td-muted" onClick={() => setEditing(null)}>
            取消
          </button>
        </form>
      )}

      <ol className="divide-y divide-td-border rounded border border-td-border text-sm">
        {members.map((id, i) => (
          <li key={id} className="flex items-center gap-2 px-3 py-2">
            <span className="w-6 text-xs text-td-muted">{i + 1}.</span>
            <span className="flex-1">
              {employeeLabel(
                data.employees.find((e) => e.id === id),
                data.departments
              )}
            </span>
            <button type="button" className={smallBtn} aria-label="往上" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button type="button" className={smallBtn} aria-label="往下" disabled={i === members.length - 1} onClick={() => move(i, 1)}>
              ↓
            </button>
            <button type="button" className={dangerBtn} aria-label="移出群組" onClick={() => setMembers((m) => m.filter((x) => x !== id))}>
              ✕
            </button>
          </li>
        ))}
        {members.length === 0 && <li className="px-3 py-3 text-td-muted">尚無成員</li>}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[16rem] flex-1">
          <EmployeeSelect
            employees={data.employees}
            departments={data.departments}
            value={adding}
            exclude={members}
            onChange={(id) => {
              if (id) setMembers((m) => [...m, id]);
              setAdding('');
            }}
            placeholder="加入成員…"
            label={`${group.name} 加入成員`}
          />
        </div>
        {dirty && (
          <>
            <button type="button" className="btn-primary !py-1.5" disabled={pending} onClick={() => run(() => setGroupMembersAction(group.id, members), '成員已儲存')}>
              儲存成員與順序
            </button>
            <button type="button" className="btn-ghost !py-1.5" onClick={() => setMembers(group.memberIds)}>
              還原
            </button>
          </>
        )}
      </div>
    </Section>
  );
}
