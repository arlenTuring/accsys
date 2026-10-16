'use client';

import { useMemo, useState } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import { saveAccessRoleAction, setAccessRoleActiveAction } from '@/lib/admin/access-roles/actions';
import type { AccessRoleListItem } from '@/lib/admin/access-roles/queries';
import { permissionsByGroup, type Permission } from '@/lib/authz/permissions';
import { ActionMessage, Section, dangerBtn, smallBtn, smallInput, useOrgAction } from '../org/org-ui';

type Draft = { code: string; name: string; description: string; permissions: Permission[] };

const emptyDraft = (): Draft => ({ code: '', name: '', description: '', permissions: [] });
const groups = permissionsByGroup();

function PermissionPicker({
  value,
  onChange,
  locked,
}: {
  value: Permission[];
  onChange: (next: Permission[]) => void;
  locked?: boolean;
}) {
  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (key: Permission) => {
    if (locked) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };
  return (
    <div className="space-y-4">
      {groups.map(({ group, items }) => (
        <fieldset key={group.id} className="space-y-2">
          <legend className="text-sm font-semibold text-td-blue-dark">{group.label}</legend>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.key}>
                <label className={`flex gap-2 rounded border border-td-border bg-white px-3 py-2 ${locked ? 'opacity-70' : 'hover:bg-td-blue-light/40'}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(item.key)}
                    disabled={locked}
                    onChange={() => toggle(item.key)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-td-blue-dark">{item.label}</span>
                    <span className="block text-xs text-td-muted">{item.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

export function AccessRolesManager({ roles }: { roles: AccessRoleListItem[] }) {
  const { pending, msg, run } = useOrgAction();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <Section
        title="新增權限角色"
        description="權限角色決定員工能進哪些管理／財會功能。與「職務類別」不同：職務類別只用於簽核關卡與表單可填寫範圍。"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveAccessRoleAction(null, draft), '權限角色已新增', () => setDraft(emptyDraft()));
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              aria-label="角色代號"
              className={smallInput}
              placeholder="代號，例如 form_owner"
              value={draft.code}
              maxLength={40}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
            <input
              aria-label="角色名稱"
              className={smallInput}
              placeholder="名稱，例如 表單負責人"
              value={draft.name}
              maxLength={30}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              aria-label="角色說明"
              className={smallInput}
              placeholder="說明（選填）"
              value={draft.description}
              maxLength={200}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <PermissionPicker value={draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} />
          <button type="submit" className="btn-primary !py-1.5" disabled={pending}>
            建立角色
          </button>
        </form>
      </Section>

      {roles.map((role) => (
        <RoleCard key={role.id} role={role} pending={pending} run={run} />
      ))}
    </div>
  );
}

function RoleCard({
  role,
  pending,
  run,
}: {
  role: AccessRoleListItem;
  pending: boolean;
  run: ReturnType<typeof useOrgAction>['run'];
}) {
  const locked = role.code === 'admin';
  const [editing, setEditing] = useState<Draft | null>(null);

  return (
    <Section
      title={role.name}
      description={
        <>
          <span className="mono-case text-xs">{role.code}</span>
          {role.description ? <> · {role.description}</> : null}
          <> · {role.memberCount} 人</>
          {role.isSystem ? <> · 系統內建</> : null}
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {role.isSystem && <span className="badge bg-slate-100 text-slate-700">系統</span>}
          {!role.active && <span className="badge-withdrawn">已停用</span>}
          {!locked && (
            <button
              type="button"
              className={smallBtn}
              onClick={() => setEditing({ code: role.code, name: role.name, description: role.description, permissions: [...role.permissions] })}
            >
              編輯權限
            </button>
          )}
          {!role.isSystem &&
            (role.active ? (
              <button
                type="button"
                className={dangerBtn}
                disabled={pending}
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: `停用權限角色「${role.name}」？`,
                      message: role.memberCount > 0 ? `仍有 ${role.memberCount} 人使用，需先改派才能停用。` : '停用後不能再指派給員工。',
                      confirmLabel: '停用',
                      tone: 'danger',
                    })
                  ) {
                    run(() => setAccessRoleActiveAction(role.id, false, role.version), '權限角色已停用');
                  }
                }}
              >
                停用
              </button>
            ) : (
              <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => setAccessRoleActiveAction(role.id, true, role.version), '權限角色已啟用')}>
                啟用
              </button>
            ))}
        </div>
      }
    >
      {editing ? (
        <form
          className="space-y-3 rounded border border-dashed border-td-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveAccessRoleAction(role.id, editing, role.version), '權限角色已更新', () => setEditing(null));
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="角色名稱" className={smallInput} value={editing.name} maxLength={30} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input
              aria-label="角色說明"
              className={smallInput}
              value={editing.description}
              maxLength={200}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>
          <PermissionPicker value={editing.permissions} onChange={(permissions) => setEditing({ ...editing, permissions })} locked={locked} />
          <div className="flex gap-2">
            <button type="submit" className={smallBtn} disabled={pending}>
              儲存
            </button>
            <button type="button" className="text-xs text-td-muted" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {role.permissions.length === 0 ? (
            <li className="text-td-muted">沒有額外系統權限（僅一般填單與簽核）</li>
          ) : (
            role.permissions.map((p) => (
              <li key={p} className="rounded-full border border-td-border bg-td-surface px-2 py-0.5 text-td-blue-dark">
                {groups.flatMap((g) => g.items).find((i) => i.key === p)?.label ?? p}
              </li>
            ))
          )}
        </ul>
      )}
    </Section>
  );
}
