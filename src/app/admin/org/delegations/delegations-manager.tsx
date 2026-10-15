'use client';

import { useState } from 'react';
import { confirmDialog } from '@/app/components/dialog';
import { createDelegationAction, revokeDelegationAction } from '@/lib/admin/org/actions';
import type { DelegationStatus, OrgDirectory } from '@/lib/admin/org/queries';
import { ActionMessage, EmployeeSelect, Section, dangerBtn, employeeLabel, smallInput, useOrgAction } from '../org-ui';

const STATUS: Record<DelegationStatus, { label: string; cls: string }> = {
  active: { label: '生效中', cls: 'badge-approved' },
  scheduled: { label: '尚未開始', cls: 'badge-pending' },
  ended: { label: '已結束', cls: 'badge-withdrawn' },
  revoked: { label: '已撤銷', cls: 'badge-withdrawn' },
};

export function DelegationsManager({ data }: { data: OrgDirectory }) {
  const { pending, msg, run } = useOrgAction();
  const empty = { delegatorId: '', delegateId: '', startsOn: data.today, endsOn: '', allForms: true, formKeys: [] as string[], reason: '' };
  const [draft, setDraft] = useState(empty);
  const name = (id: string) =>
    employeeLabel(
      data.employees.find((e) => e.id === id),
      data.departments
    );
  const formName = (key: string) => data.forms.find((f) => f.key === key)?.name ?? key;

  return (
    <div className="space-y-4">
      <ActionMessage msg={msg} />
      <Section
        title="新增代理人"
        description={
          <>
            代理期間內，輪到被代理人簽核的關卡會改由代理人簽核（只轉一次：代理人自己的代理設定不會再往下轉）。代理在產生簽核關卡時套用，已經在等待簽核的關卡不會自動改派。
            目前只有表單設計器建立的表單會套用；舊版內建表單（請購、請款、用印等）改用新流程後才會套用。
          </>
        }
      >
        <form
          className="grid gap-3 text-sm sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createDelegationAction({
                  delegatorId: draft.delegatorId,
                  delegateId: draft.delegateId,
                  startsOn: draft.startsOn,
                  endsOn: draft.endsOn,
                  formKeys: draft.allForms ? null : draft.formKeys,
                  reason: draft.reason,
                }),
              '代理設定已新增',
              () => setDraft(empty)
            );
          }}
        >
          <div>
            <span className="text-xs font-semibold text-td-blue-dark">被代理人（請假的人）</span>
            <EmployeeSelect employees={data.employees} departments={data.departments} value={draft.delegatorId} onChange={(delegatorId) => setDraft({ ...draft, delegatorId })} label="被代理人" />
          </div>
          <div>
            <span className="text-xs font-semibold text-td-blue-dark">代理人</span>
            <EmployeeSelect
              employees={data.employees}
              departments={data.departments}
              value={draft.delegateId}
              exclude={draft.delegatorId ? [draft.delegatorId] : []}
              onChange={(delegateId) => setDraft({ ...draft, delegateId })}
              label="代理人"
            />
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-td-blue-dark">開始日期</span>
            <input className={smallInput} type="date" value={draft.startsOn} onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-td-blue-dark">結束日期（含當天）</span>
            <input className={smallInput} type="date" min={draft.startsOn || data.today} value={draft.endsOn} onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-semibold text-td-blue-dark">代理範圍</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={draft.allForms} onChange={() => setDraft({ ...draft, allForms: true })} />
                全部表單
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!draft.allForms} onChange={() => setDraft({ ...draft, allForms: false })} />
                只代理部分表單
              </label>
            </div>
            {!draft.allForms && (
              <div className="mt-2 flex flex-wrap gap-3 rounded border border-dashed border-td-border p-2">
                {data.forms.length === 0 && <span className="text-td-muted">尚無設計器表單</span>}
                {data.forms.map((f) => (
                  <label key={f.key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={draft.formKeys.includes(f.key)}
                      onChange={(e) =>
                        setDraft({ ...draft, formKeys: e.target.checked ? [...draft.formKeys, f.key] : draft.formKeys.filter((k) => k !== f.key) })
                      }
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <label className="block sm:col-span-2">
            <span className="text-xs font-semibold text-td-blue-dark">原因（選填）</span>
            <input className={smallInput} value={draft.reason} maxLength={200} placeholder="例如：出國洽公" onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary !py-1.5" disabled={pending || !draft.delegatorId || !draft.delegateId || !draft.endsOn}>
              {pending ? '處理中…' : '新增代理'}
            </button>
          </div>
        </form>
      </Section>

      <Section title="代理設定" description="顯示生效中、尚未開始，以及 90 天內結束或撤銷的設定。">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-td-muted">
              <tr>
                <th className="py-1">被代理人</th>
                <th>代理人</th>
                <th>期間</th>
                <th>範圍</th>
                <th>狀態</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.delegations.map((d) => (
                <tr key={d.id} className="border-t border-td-border align-top">
                  <td className="py-2">{name(d.delegatorId)}</td>
                  <td className="py-2">{name(d.delegateId)}</td>
                  <td className="whitespace-nowrap py-2">
                    {d.startsOn} ～ {d.endsOn}
                  </td>
                  <td className="py-2">
                    {d.formKeys ? d.formKeys.map(formName).join('、') : '全部表單'}
                    {d.reason && <div className="text-xs text-td-muted">{d.reason}</div>}
                    <div className="text-xs text-td-muted">由 {d.createdByName} 設定</div>
                  </td>
                  <td className="py-2">
                    <span className={STATUS[d.status].cls}>{STATUS[d.status].label}</span>
                  </td>
                  <td className="py-2 text-right">
                    {(d.status === 'active' || d.status === 'scheduled') && (
                      <button
                        type="button"
                        className={dangerBtn}
                        disabled={pending}
                        onClick={async () => {
                          if (await confirmDialog({ title: '撤銷這筆代理設定？', message: '已經產生的簽核關卡不會改回。', confirmLabel: '撤銷', tone: 'danger' })) {
                            run(() => revokeDelegationAction(d.id), '代理設定已撤銷');
                          }
                        }}
                      >
                        撤銷
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.delegations.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-td-muted">
                    目前沒有代理設定
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
