'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import { saveAccessRoleAction, setAccessRoleActiveAction } from '@/lib/admin/access-roles/actions';
import type { AccessRoleListItem } from '@/lib/admin/access-roles/queries';
import { permissionsByGroup, type Permission } from '@/lib/authz/permissions';
import { ActionMessage, dangerBtn, smallBtn, smallInput, useOrgAction } from '../org/org-ui';

type Draft = { code: string; name: string; description: string; permissions: Permission[] };

const emptyDraft = (): Draft => ({ code: '', name: '', description: '', permissions: [] });
const groups = permissionsByGroup();
const permissionLabel = (key: Permission) => groups.flatMap((g) => g.items).find((i) => i.key === key)?.label ?? key;

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
                <label
                  className={`flex gap-2 rounded border border-td-border bg-white px-3 py-2 ${
                    locked ? 'opacity-70' : 'hover:bg-td-blue-light/40'
                  }`}
                >
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

type EditorMode =
  | { kind: 'create'; draft: Draft }
  | { kind: 'edit'; role: AccessRoleListItem; draft: Draft };

export function AccessRolesManager({ roles }: { roles: AccessRoleListItem[] }) {
  const { pending, msg, run } = useOrgAction();
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <section className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-td-blue-dark">權限角色</h2>
            <p className="mt-1 text-xs leading-5 text-td-muted">點列展開權限；右上新增。規則見系統操作教學。</p>
          </div>
          <button type="button" className="btn-primary !py-1.5" disabled={pending} onClick={() => setEditor({ kind: 'create', draft: emptyDraft() })}>
            新增角色
          </button>
        </div>

        {roles.length === 0 ? (
          <p className="text-sm text-td-muted">尚無權限角色。</p>
        ) : (
          <ul className="divide-y divide-td-border rounded-lg border border-td-border">
            {roles.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                open={expanded.has(role.id)}
                onToggle={() => toggleExpanded(role.id)}
                pending={pending}
                onEdit={() =>
                  setEditor({
                    kind: 'edit',
                    role,
                    draft: {
                      code: role.code,
                      name: role.name,
                      description: role.description,
                      permissions: [...role.permissions],
                    },
                  })
                }
                onDelete={async () => {
                  if (
                    await confirmDialog({
                      title: `刪除權限角色「${role.name}」？`,
                      message:
                        role.memberCount > 0
                          ? `仍有 ${role.memberCount} 人使用，需先改派才能刪除。`
                          : '刪除後不能再指派給員工（可之後再啟用已停用角色）。',
                      confirmLabel: '刪除',
                      tone: 'danger',
                    })
                  ) {
                    run(() => setAccessRoleActiveAction(role.id, false, role.version), '權限角色已刪除');
                  }
                }}
                onActivate={() => run(() => setAccessRoleActiveAction(role.id, true, role.version), '權限角色已啟用')}
              />
            ))}
          </ul>
        )}
      </section>

      {editor && (
        <RoleEditorDialog
          mode={editor}
          pending={pending}
          onClose={() => setEditor(null)}
          onChange={(draft) => setEditor((cur) => (cur ? { ...cur, draft } : cur))}
          onSave={() => {
            if (editor.kind === 'create') {
              run(() => saveAccessRoleAction(null, editor.draft), '權限角色已新增', () => setEditor(null));
            } else {
              run(() => saveAccessRoleAction(editor.role.id, editor.draft, editor.role.version), '權限角色已更新', () => setEditor(null));
            }
          }}
        />
      )}
    </div>
  );
}

function RoleRow({
  role,
  open,
  onToggle,
  pending,
  onEdit,
  onDelete,
  onActivate,
}: {
  role: AccessRoleListItem;
  open: boolean;
  onToggle: () => void;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onActivate: () => void;
}) {
  const locked = role.code === 'admin';
  const panelId = useId();
  const summary =
    role.permissions.length === 0
      ? '僅一般填單與簽核'
      : role.permissions.length <= 4
        ? role.permissions.map(permissionLabel).join('、')
        : `${role.permissions.slice(0, 3).map(permissionLabel).join('、')} 等 ${role.permissions.length} 項`;

  return (
    <li className={!role.active ? 'bg-slate-50/80' : undefined}>
      <div className="flex flex-wrap items-start gap-2 px-3 py-3 sm:flex-nowrap">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <div className="flex items-center gap-2">
            <Chevron open={open} />
            <span className="text-sm font-semibold text-td-blue-dark">{role.name}</span>
            <span className="mono-case text-xs text-td-muted">{role.code}</span>
            {role.isSystem && <span className="badge bg-slate-100 text-slate-700">系統</span>}
            {!role.active && <span className="badge-withdrawn">已停用</span>}
          </div>
          <p className="mt-1 pl-6 text-xs text-td-muted">
            {role.memberCount} 人 · {summary}
          </p>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
          {!locked && (
            <button type="button" className={smallBtn} disabled={pending} onClick={onEdit}>
              修改
            </button>
          )}
          {!role.isSystem &&
            (role.active ? (
              <button type="button" className={dangerBtn} disabled={pending} onClick={onDelete}>
                刪除
              </button>
            ) : (
              <button type="button" className={smallBtn} disabled={pending} onClick={onActivate}>
                啟用
              </button>
            ))}
        </div>
      </div>

      {open && (
        <div id={panelId} className="space-y-3 border-t border-td-border bg-td-surface/40 px-3 py-3 sm:px-9">
          {role.description ? <p className="text-sm text-td-muted">{role.description}</p> : null}
          {role.permissions.length === 0 ? (
            <p className="text-sm text-td-muted">沒有額外系統權限（僅一般填單與簽核）。</p>
          ) : (
            <div className="space-y-3">
              {groups.map(({ group, items }) => {
                const held = items.filter((i) => role.permissions.includes(i.key));
                if (held.length === 0) return null;
                return (
                  <div key={group.id}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-td-muted">{group.label}</h3>
                    <ul className="mt-1.5 space-y-1.5">
                      {held.map((item) => (
                        <li key={item.key} className="text-sm">
                          <span className="font-medium text-td-blue-dark">{item.label}</span>
                          <span className="mt-0.5 block text-xs text-td-muted">{item.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-td-muted transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function RoleEditorDialog({
  mode,
  pending,
  onClose,
  onChange,
  onSave,
}: {
  mode: EditorMode;
  pending: boolean;
  onClose: () => void;
  onChange: (draft: Draft) => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const creating = mode.kind === 'create';
  const locked = mode.kind === 'edit' && mode.role.code === 'admin';
  const draft = mode.draft;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-keep-selection=""
      onKeyDown={(e) => e.stopPropagation()}
      className="w-[calc(100%-2rem)] max-w-3xl rounded-card border border-td-border bg-white p-0 text-td-blue-dark shadow-lg backdrop:bg-td-blue-dark/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="flex max-h-[min(90vh,52rem)] flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <div className="border-b border-td-border px-5 py-4">
          <h2 id={titleId} className="text-lg font-bold text-td-blue-dark">
            {creating ? '新增權限角色' : `修改「${mode.role.name}」`}
          </h2>
          <p className="mt-1 text-xs text-td-muted">勾選此角色需要的系統權限；儲存後可在帳號綁定頁指派給員工。</p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className={`grid gap-3 ${creating ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {creating && (
              <Field label="角色代號">
                <input
                  aria-label="角色代號"
                  className={smallInput}
                  placeholder="例如 form_owner"
                  value={draft.code}
                  maxLength={40}
                  required
                  onChange={(e) => onChange({ ...draft, code: e.target.value })}
                />
              </Field>
            )}
            <Field label="角色名稱">
              <input
                aria-label="角色名稱"
                className={smallInput}
                placeholder="例如 表單負責人"
                value={draft.name}
                maxLength={30}
                required
                disabled={locked}
                onChange={(e) => onChange({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="說明（選填）">
              <input
                aria-label="角色說明"
                className={smallInput}
                placeholder="簡短說明用途"
                value={draft.description}
                maxLength={200}
                disabled={locked}
                onChange={(e) => onChange({ ...draft, description: e.target.value })}
              />
            </Field>
          </div>
          <PermissionPicker value={draft.permissions} onChange={(permissions) => onChange({ ...draft, permissions })} locked={locked} />
        </div>

        <div className="flex justify-end gap-2 border-t border-td-border px-5 py-3">
          <button type="button" className="btn-secondary !py-2" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn-primary !py-2" disabled={pending || locked}>
            {creating ? '儲存新角色' : '儲存修改'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-td-blue-dark">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
