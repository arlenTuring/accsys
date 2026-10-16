'use client';

import { useState } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import {
  addRoleHolderAction,
  removeRoleHolderAction,
  saveJobRoleAction,
  setJobRoleActiveAction,
  setPrimaryHolderAction,
} from '@/lib/admin/org/actions';
import type { OrgDirectory, OrgJobRoleRow } from '@/lib/admin/org/queries';
import { ActionMessage, EmployeeSelect, InUseNote, Section, dangerBtn, employeeLabel, smallBtn, smallInput, useOrgAction } from '../org-ui';

type Run = ReturnType<typeof useOrgAction>['run'];

export function RolesManager({ data }: { data: OrgDirectory }) {
  const { pending, msg, run } = useOrgAction();
  const [draft, setDraft] = useState({ code: '', name: '', description: '' });
  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <Section
        title="新增職務類別"
        description="簽核關卡找職務擔任者；同範圍以「主要」為準。"
      >
        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveJobRoleAction(null, draft), '職務類別已新增', () => setDraft({ code: '', name: '', description: '' }));
          }}
        >
          <input aria-label="職務代號" className={smallInput} placeholder="代號，例如 it_admin" value={draft.code} maxLength={40} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
          <input aria-label="職務名稱" className={smallInput} placeholder="名稱，例如 資訊管理員" value={draft.name} maxLength={30} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input aria-label="職務說明" className={smallInput} placeholder="說明（選填）" value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button type="submit" className="btn-secondary !py-1.5" disabled={pending}>
            新增
          </button>
        </form>
      </Section>
      {data.jobRoles.map((role) => (
        <RoleCard key={role.id} role={role} data={data} pending={pending} run={run} />
      ))}
    </div>
  );
}

function RoleCard({ role, data, pending, run }: { role: OrgJobRoleRow; data: OrgDirectory; pending: boolean; run: Run }) {
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const [holder, setHolder] = useState({ employeeId: '', departmentId: '' });
  const { employees, departments } = data;
  const scopeName = (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? '（已刪除的部門）') : '全公司');

  return (
    <Section
      title={role.name}
      description={
        <>
          <span className="mono-case text-xs">{role.code}</span>
          {role.description && <> · {role.description}</>}
          {role.isSystem && <> · 系統內建：由員工的總經理／董事長設定同步，舊版表單的簽核也使用它</>}
        </>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {role.isSystem && <span className="badge bg-slate-100 text-slate-700">系統</span>}
          {!role.active && <span className="badge-withdrawn">已停用</span>}
          <InUseNote forms={data.inUse.roles[role.code]} />
          {!role.isSystem && (
            <>
              <button type="button" className={smallBtn} onClick={() => setEditing({ name: role.name, description: role.description })}>
                編輯
              </button>
              {role.active ? (
                <button
                  type="button"
                  className={dangerBtn}
                  disabled={pending}
                  onClick={async () => {
                    if (await confirmDialog({ title: `停用職務類別「${role.name}」？`, confirmLabel: '停用', tone: 'danger' })) {
                      run(() => setJobRoleActiveAction(role.id, false), '職務類別已停用');
                    }
                  }}
                >
                  停用
                </button>
              ) : (
                <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => setJobRoleActiveAction(role.id, true), '職務類別已啟用')}>
                  啟用
                </button>
              )}
            </>
          )}
        </div>
      }
    >
      {editing && (
        <form
          className="grid gap-2 rounded border border-dashed border-td-border p-3 sm:grid-cols-[1fr_2fr_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveJobRoleAction(role.id, editing), '職務類別已更新', () => setEditing(null));
          }}
        >
          <input aria-label="職務名稱" className={smallInput} value={editing.name} maxLength={30} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <input aria-label="職務說明" className={smallInput} value={editing.description} maxLength={200} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          <button type="submit" className={smallBtn} disabled={pending}>
            儲存
          </button>
          <button type="button" className="text-xs text-td-muted" onClick={() => setEditing(null)}>
            取消
          </button>
        </form>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-td-muted">
          <tr>
            <th className="py-1">擔任者</th>
            <th>範圍</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {role.holders.map((h) => (
            <tr key={h.bindingId} className="border-t border-td-border">
              <td className="py-2">
                {employeeLabel(
                  employees.find((e) => e.id === h.employeeId),
                  departments
                )}
                {h.isPrimary && <span className="badge-pending ml-2">主要</span>}
              </td>
              <td className="py-2">{scopeName(h.departmentId)}</td>
              <td className="space-x-1 py-2 text-right">
                {!h.isPrimary && !role.isSystem && (
                  <button type="button" className={smallBtn} disabled={pending} onClick={() => run(() => setPrimaryHolderAction(h.bindingId), '已設為主要')}>
                    設為主要
                  </button>
                )}
                <button
                  type="button"
                  className={dangerBtn}
                  disabled={pending}
                  onClick={async () => {
                    if (await confirmDialog({ title: '移除這位擔任者？', confirmLabel: '移除', tone: 'danger' })) run(() => removeRoleHolderAction(h.bindingId), '已移除');
                  }}
                >
                  移除
                </button>
              </td>
            </tr>
          ))}
          {role.holders.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-td-muted">
                尚無擔任者
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {role.active && (
        <form
          className="grid gap-2 border-t border-dashed border-td-border pt-3 sm:grid-cols-[2fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => addRoleHolderAction({ jobRoleId: role.id, employeeId: holder.employeeId, departmentId: holder.departmentId || null }),
              '已加入擔任者',
              () => setHolder({ employeeId: '', departmentId: '' })
            );
          }}
        >
          <EmployeeSelect
            employees={employees}
            departments={departments}
            value={holder.employeeId}
            onChange={(employeeId) => setHolder({ ...holder, employeeId })}
            label={`${role.name} 擔任者`}
          />
          <select
            aria-label={`${role.name} 範圍`}
            className={smallInput}
            value={holder.departmentId}
            disabled={role.isSystem}
            onChange={(e) => setHolder({ ...holder, departmentId: e.target.value })}
          >
            <option value="">全公司</option>
            {departments
              .filter((d) => d.active)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
          <button type="submit" className="btn-secondary !py-1.5" disabled={pending || !holder.employeeId}>
            加入
          </button>
        </form>
      )}
    </Section>
  );
}
