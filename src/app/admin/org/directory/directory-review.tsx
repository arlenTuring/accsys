'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ACCOUNT_ERRORS } from '@/app/admin/accounts/messages';
import { setEmployeeAccessAction } from '@/lib/admin/accounts/actions';
import type { DirectoryPageData, LeaverWithHandover } from '@/lib/admin/directory/queries';
import { applyDirectoryChangesAction, createEmployeeFromDirectoryAction } from '@/lib/admin/employees/actions';
import type { ChangeField, NewHire, ProfileChange } from '@/lib/directory/review';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { ActionMessage, dangerBtn, Section, smallBtn, smallInput, useOrgAction } from '../org-ui';

type ServiceResult = { ok: true } | { ok: false; error: string; detail?: string };
type Departments = DirectoryPageData['departments'];

/** Account / employee services answer with an error code; the org helpers expect a message. */
async function adapt(promise: Promise<ServiceResult>) {
  const r = await promise;
  if (r.ok) return { ok: true as const };
  const text = ACCOUNT_ERRORS[r.error] ?? '操作失敗。';
  return { ok: false as const, code: r.error, error: r.detail ? `${text}（${r.detail}）` : text };
}

const FIELD_LABELS: Record<ChangeField, string> = { name: '姓名', email: 'Email', phone: '電話', title: '職稱' };
const LEAVER_REASONS: Record<LeaverWithHandover['reason'], string> = {
  suspended: 'Workspace 帳號已停權',
  archived: 'Workspace 帳號已封存',
  removed: '已從 Workspace 目錄移除',
  missing: '目錄中找不到綁定的帳號',
};
const STATUS_LABELS = { succeeded: '成功', blocked: '已阻擋', failed: '失敗' } as const;
const stamp = (iso: string) => new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
const th = 'px-2 py-1.5 text-left text-xs font-semibold text-td-muted';
const td = 'px-2 py-1.5 align-top';

export function DirectoryReview({ data, currentEmployeeId }: { data: DirectoryPageData; currentEmployeeId: string }) {
  const { pending, msg, run } = useOrgAction();
  const idMismatch = data.snapshotCount > 0 && data.activeBindings > 0 && data.matchedBindings === 0;
  return (
    <div className="space-y-5">
      <ActionMessage msg={msg} />
      <SyncStatus data={data} idMismatch={idMismatch} />
      <NewHires items={data.newHires} departments={data.departments} pending={pending} run={run} />
      <Changes items={data.changes} pending={pending} run={run} />
      <Leavers items={data.leavers} currentEmployeeId={currentEmployeeId} pending={pending} run={run} />
    </div>
  );
}

type Run = ReturnType<typeof useOrgAction>['run'];

function SyncStatus({ data, idMismatch }: { data: DirectoryPageData; idMismatch: boolean }) {
  return (
    <Section
      title="同步狀態"
      description="由伺服器排程（systemd timer）從 Google Workspace 讀取人員清單，網站本身不持有 Workspace 憑證。同步只會撤銷停權帳號的登入綁定並更新目錄快照；建立員工、更新資料與停用帳號都要在本頁由管理員確認（需 15 分鐘內登入過，並記錄稽核）。"
    >
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-td-muted">最近一次成功同步</dt>
          <dd className="font-semibold">{data.lastSuccessAt ? stamp(data.lastSuccessAt) : '尚未同步'}</dd>
        </div>
        <div>
          <dt className="text-xs text-td-muted">目錄快照帳號數</dt>
          <dd className="font-semibold">{data.snapshotCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-td-muted">已對應的登入綁定</dt>
          <dd className="font-semibold">
            {data.matchedBindings} / {data.activeBindings}
          </dd>
        </div>
      </dl>
      {data.snapshotCount === 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          尚無目錄快照。Workspace 授權完成並執行同步後，這裡才會列出新進、異動與離職人員。授權前請用員工資料頁手動維護或匯入 Excel。
        </p>
      )}
      {idMismatch && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          目前沒有任何登入綁定能對應到目錄帳號，目錄帳號 ID 可能與 Google 登入的帳號 ID 不同。在確認之前，請勿依本頁的新進或離職清單操作，並先檢查同步設定。
        </p>
      )}
      {data.runs.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>完成時間</th>
              <th className={th}>來源</th>
              <th className={th}>結果</th>
              <th className={th}>帳號（啟用中）</th>
              <th className={th}>說明</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <tr key={r.id} className="border-t border-td-border">
                <td className={td}>{stamp(r.finishedAt)}</td>
                <td className={td}>{r.source === 'directory' ? 'Workspace' : '測試資料'}</td>
                <td className={`${td} ${r.status === 'succeeded' ? 'text-emerald-700' : 'text-red-700'}`}>{STATUS_LABELS[r.status]}</td>
                <td className={td}>{r.directoryCount === null ? '—' : `${r.directoryCount}（${r.activeCount ?? 0}）`}</td>
                <td className={`${td} text-xs text-td-muted`}>{r.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function NewHires({ items, departments, pending, run }: { items: NewHire[]; departments: Departments; pending: boolean; run: Run }) {
  return (
    <Section
      title={`新進人員（${items.length}）`}
      description="Workspace 中啟用、但尚未綁定任何員工的帳號。建立員工時姓名、Email、電話、職稱取自目錄；目錄的部門與職稱只供參考，部門請自行選擇。建立後不會自動綁定登入：本人首次以 Google 登入後，請到「帳號與登入綁定」核准。"
    >
      {items.length === 0 ? (
        <p className="text-sm text-td-muted">沒有待處理的新進人員。</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>Workspace 帳號</th>
              <th className={th}>目錄資料（參考）</th>
              <th className={th}>處理</th>
            </tr>
          </thead>
          <tbody>
            {items.map((h) => (
              <NewHireRow key={h.directoryUserId} hire={h} departments={departments} pending={pending} run={run} />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function NewHireRow({ hire, departments, pending, run }: { hire: NewHire; departments: Departments; pending: boolean; run: Run }) {
  const [code, setCode] = useState(hire.employeeCode ?? '');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState('staff');
  const m = hire.match;
  return (
    <tr className="border-t border-td-border">
      <td className={td}>
        <div className="font-semibold">{hire.fullName || '（未填姓名）'}</div>
        <div className="text-xs text-td-muted">{hire.email}</div>
      </td>
      <td className={`${td} text-xs text-td-muted`}>
        {[hire.employeeCode && `員工編號 ${hire.employeeCode}`, hire.department, hire.title, hire.phone].filter(Boolean).join('・') || '—'}
      </td>
      <td className={`${td} space-y-1.5`}>
        {m ? (
          <>
            <div>
              對應員工 {m.employeeCode} {m.name}
              <span className="text-xs text-td-muted">（依{m.by === 'email' ? ' Email' : '員工編號'}比對，僅供參考）</span>
            </div>
            {m.changes.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-td-muted">
                  {m.changes.map((c) => `${FIELD_LABELS[c.field]}：${c.current ?? '（空）'} → ${c.next}`).join('；')}
                </span>
                <button
                  type="button"
                  className={smallBtn}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => adapt(applyDirectoryChangesAction([{ employeeId: m.employeeId, directoryUserId: hire.directoryUserId, fields: m.changes.map((c) => c.field) }])),
                      '已更新員工資料'
                    )
                  }
                >
                  以目錄資料更新
                </button>
              </div>
            )}
            <div className="text-xs text-td-muted">
              {hire.linkRequestId ? (
                <Link className="font-semibold text-td-blue underline" href="/admin/accounts">
                  本人已登入申請，前往核准綁定
                </Link>
              ) : (
                '等待本人首次登入後核准綁定'
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className={`${smallInput} w-28`}
              aria-label={`${hire.email} 員工編號`}
              placeholder="員工編號"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <select className={smallInput} aria-label={`${hire.email} 部門`} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">選擇部門…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} {d.name}
                </option>
              ))}
            </select>
            <select className={smallInput} aria-label={`${hire.email} 系統角色`} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">一般員工</option>
              <option value="finance">財會</option>
            </select>
            <button
              type="button"
              className={smallBtn}
              disabled={pending || !code.trim() || !departmentId}
              onClick={() =>
                run(
                  () => adapt(createEmployeeFromDirectoryAction({ directoryUserId: hire.directoryUserId, employeeCode: code.trim(), departmentId, role })),
                  `已建立員工 ${code.trim()}`
                )
              }
            >
              建立員工
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function Changes({ items, pending, run }: { items: ProfileChange[]; pending: boolean; run: Run }) {
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const key = (employeeId: string, field: ChangeField) => `${employeeId}:${field}`;
  const selected = (c: ProfileChange) => c.changes.filter((f) => !skipped[key(c.employeeId, f.field)]).map((f) => f.field);
  const batch = items.filter((c) => selected(c).length > 0).map((c) => ({ employeeId: c.employeeId, directoryUserId: c.directoryUserId, fields: selected(c) }));
  return (
    <Section
      title={`資料異動（${items.length}）`}
      description="已綁定員工的 Workspace 資料與系統紀錄不同。勾選要套用的欄位；套用時伺服器會重新讀取目錄快照的值。目錄部門只是提示，部門與主管請到「部門」頁調整。"
      actions={
        items.length > 0 && (
          <button type="button" className={smallBtn} disabled={pending || batch.length === 0} onClick={() => run(() => adapt(applyDirectoryChangesAction(batch)), `已套用 ${batch.length} 位員工的異動`)}>
            套用全部勾選項目（{batch.length}）
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-td-muted">沒有資料異動。</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>員工</th>
              <th className={th}>異動</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.employeeId} className="border-t border-td-border">
                <td className={td}>
                  {c.employeeCode} {c.name}
                </td>
                <td className={`${td} space-y-1`}>
                  {c.changes.map((f) => (
                    <label key={f.field} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!skipped[key(c.employeeId, f.field)]}
                        onChange={(e) => setSkipped((s) => ({ ...s, [key(c.employeeId, f.field)]: !e.target.checked }))}
                      />
                      <span>
                        {FIELD_LABELS[f.field]}：<span className="text-td-muted">{f.current ?? '（空）'}</span> → <span className="font-semibold">{f.next}</span>
                      </span>
                    </label>
                  ))}
                  {c.departmentHint && (
                    <p className="text-xs text-amber-800">
                      目錄部門「{c.departmentHint}」，系統部門「{c.departmentName}」（僅提示）
                    </p>
                  )}
                </td>
                <td className={td}>
                  {selected(c).length > 0 && (
                    <button
                      type="button"
                      className={smallBtn}
                      disabled={pending}
                      onClick={() => run(() => adapt(applyDirectoryChangesAction([{ employeeId: c.employeeId, directoryUserId: c.directoryUserId, fields: selected(c) }])), `已更新 ${c.employeeCode}`)}
                    >
                      套用
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Leavers({ items, currentEmployeeId, pending, run }: { items: LeaverWithHandover[]; currentEmployeeId: string; pending: boolean; run: Run }) {
  return (
    <Section
      title={`離職／停權（${items.length}）`}
      description="Workspace 已停權、封存或移除，但系統內仍可使用的員工。同步已撤銷其 Google 登入綁定；停用會再撤銷所有工作階段。停用前請先處理下列待簽關卡（例如設定代理人），員工資料與歷史表單都會保留。"
    >
      {items.length === 0 ? (
        <p className="text-sm text-td-muted">沒有待處理的離職或停權人員。</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>員工</th>
              <th className={th}>原因</th>
              <th className={th}>待交接簽核</th>
              <th className={th}>停用</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <LeaverRow key={l.employeeId} leaver={l} self={l.employeeId === currentEmployeeId} pending={pending} run={run} />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function LeaverRow({ leaver, self, pending, run }: { leaver: LeaverWithHandover; self: boolean; pending: boolean; run: Run }) {
  const [reason, setReason] = useState(LEAVER_REASONS[leaver.reason]);
  return (
    <tr className="border-t border-td-border">
      <td className={td}>
        <div>
          {leaver.employeeCode} {leaver.name}
        </div>
        <div className="text-xs text-td-muted">{leaver.email ?? ''}</div>
      </td>
      <td className={td}>{LEAVER_REASONS[leaver.reason]}</td>
      <td className={td}>
        {leaver.pendingSteps.length === 0 ? (
          <span className="text-xs text-td-muted">無</span>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {leaver.pendingSteps.map((s) => {
              const type = s.formType as FormType;
              return (
                <li key={s.id}>
                  <Link className="text-td-blue underline" href={`${FORM_ROUTE_PREFIX[type] ?? ''}/${s.formId}`}>
                    {FORM_LABELS[type] ?? s.formType}
                  </Link>
                  {s.stepLabel ? `・${s.stepLabel}` : ''}
                </li>
              );
            })}
          </ul>
        )}
      </td>
      <td className={td}>
        {self ? (
          <span className="text-xs text-td-muted">不能停用自己的帳號</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <input className={`${smallInput} w-48`} aria-label={`${leaver.employeeCode} 停用原因`} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button
              type="button"
              className={dangerBtn}
              disabled={pending || !reason.trim()}
              onClick={() => {
                if (!window.confirm(`停用 ${leaver.employeeCode} ${leaver.name} 的系統存取？`)) return;
                run(() => adapt(setEmployeeAccessAction(leaver.employeeId, false, reason.trim())), `已停用 ${leaver.employeeCode}`);
              }}
            >
              停用
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
