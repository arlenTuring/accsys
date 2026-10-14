'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  approveLinkRequestAction,
  rejectLinkRequestAction,
  revokeIdentityAction,
  setEmployeeAccessAction,
  setEmployeeRoleAction,
} from '@/lib/admin/accounts/actions';
import type { AccountRow, LinkRequestRow } from '@/lib/admin/accounts/queries';
import type { AccountActionResult } from '@/lib/admin/accounts/service';
import { ACCOUNT_ERRORS } from './messages';

const ERRORS = ACCOUNT_ERRORS;
const ROLE_LABELS = { staff: '一般員工', finance: '財會', admin: '系統管理員' } as const;

export function AccountsManager({
  currentEmployeeId,
  requests,
  accounts,
}: {
  currentEmployeeId: string;
  requests: LinkRequestRow[];
  accounts: AccountRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: string } | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});

  const run = (action: () => Promise<AccountActionResult>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setMessage({ error: result.error });
    });
  };

  const unbound = accounts.filter((a) => !a.boundEmail && a.accessEnabled);

  return (
    <div className="space-y-8">
      {message && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {ERRORS[message.error] ?? '操作失敗。'}
          {message.error === 'reauth_required' && (
            <>
              {' '}
              <a className="underline" href="/auth/google?returnTo=/admin/accounts">
                重新登入
              </a>
            </>
          )}
        </p>
      )}

      <section className="rounded border p-4">
        <h2 className="mb-3 font-semibold">待處理的 Google 帳號（{requests.length}）</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-gray-500">目前沒有申請。</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="py-1">Google 帳號</th>
                <th>狀態</th>
                <th>綁定到員工</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const chosen = selection[r.id] ?? r.suggestedEmployeeId ?? '';
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2">
                      <div>{r.email}</div>
                      <div className="text-xs text-gray-500">
                        {r.displayName ?? '—'} · 嘗試 {r.attemptCount} 次 ·{' '}
                        {new Date(r.lastAttemptAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                      </div>
                      {r.conflictReason && (
                        <div className="mt-1 text-xs font-medium text-red-700">
                          警告：此電子郵件已綁定到另一個 Google 帳號（可能是信箱被重新指派），請先確認本人身分。
                        </div>
                      )}
                    </td>
                    <td className="py-2">{r.status === 'pending' ? '待核准' : '已拒絕'}</td>
                    <td className="py-2">
                      <select
                        className="rounded border px-2 py-1"
                        value={chosen}
                        onChange={(e) => setSelection((s) => ({ ...s, [r.id]: e.target.value }))}
                      >
                        <option value="">選擇員工…</option>
                        {unbound
                          .filter((a) => a.id !== currentEmployeeId)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.employeeCode} {a.name}（{a.departmentName}）
                              {a.id === r.suggestedEmployeeId ? ' ← 員工資料信箱相同' : ''}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="space-x-2 py-2 text-right">
                      <button
                        type="button"
                        disabled={pending || !chosen}
                        onClick={() => run(() => approveLinkRequestAction(r.id, chosen))}
                        className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
                      >
                        核准綁定
                      </button>
                      {r.status === 'pending' && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => rejectLinkRequestAction(r.id))}
                          className="rounded border px-3 py-1 disabled:opacity-50"
                        >
                          拒絕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="mb-3 font-semibold">員工帳號（{accounts.length}）</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="py-1">員工</th>
              <th>Google 綁定</th>
              <th>角色</th>
              <th>狀態</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const self = a.id === currentEmployeeId;
              return (
                <tr key={a.id} className="border-t">
                  <td className="py-2">
                    {a.employeeCode} {a.name}
                    <div className="text-xs text-gray-500">{a.departmentName}</div>
                  </td>
                  <td className="py-2">{a.boundEmail ?? <span className="text-gray-400">未綁定</span>}</td>
                  <td className="py-2">
                    <select
                      className="rounded border px-2 py-1"
                      value={a.role}
                      disabled={pending || self}
                      onChange={(e) => run(() => setEmployeeRoleAction(a.id, e.target.value))}
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    {a.accessEnabled ? '啟用' : <span className="text-red-700">停用（{a.disabledReason}）</span>}
                  </td>
                  <td className="space-x-2 py-2 text-right">
                    {!self && a.boundEmail && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`撤銷 ${a.name} 的 Google 綁定並登出所有裝置？`)) {
                            run(() => revokeIdentityAction(a.id));
                          }
                        }}
                        className="rounded border px-3 py-1 disabled:opacity-50"
                      >
                        撤銷綁定
                      </button>
                    )}
                    {!self &&
                      (a.accessEnabled ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            const reason = window.prompt(`停用 ${a.name} 的原因（必填）`);
                            if (reason?.trim()) run(() => setEmployeeAccessAction(a.id, false, reason));
                          }}
                          className="rounded border border-red-300 px-3 py-1 text-red-700 disabled:opacity-50"
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => setEmployeeAccessAction(a.id, true))}
                          className="rounded border px-3 py-1 disabled:opacity-50"
                        >
                          啟用
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
