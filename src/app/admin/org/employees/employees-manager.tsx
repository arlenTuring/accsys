'use client';

import { useRef, useState, useTransition, type InputHTMLAttributes } from 'react';
import { useRouter } from 'next/navigation';
import { ACCOUNT_ERRORS } from '@/app/admin/accounts/messages';
import type { ImportField, ImportPlan } from '@/lib/admin/employees/import';
import {
  applyEmployeeImportAction,
  createEmployeeAction,
  previewEmployeeImportAction,
  updateEmployeeAction,
} from '@/lib/admin/employees/actions';
import { setEmployeeRoleAction } from '@/lib/admin/accounts/actions';
import type { EmployeeAdminRow, JobRoleOption } from '@/lib/admin/employees/queries';
import { addRoleHolderAction, removeRoleHolderAction } from '@/lib/admin/org/actions';
import { ActionMessage, dangerBtn, Section, smallBtn, smallInput, useOrgAction } from '../org-ui';

type Data = { employees: EmployeeAdminRow[]; departments: { id: string; code: string; name: string }[]; jobRoles: JobRoleOption[] };
type Run = ReturnType<typeof useOrgAction>['run'];
type StatusFilter = '' | 'enabled' | 'unbound' | 'disabled';
type ServiceResult = { ok: true } | { ok: false; error: string; detail?: string };

const errorText = (r: { error: string; detail?: string }) => {
  const text = ACCOUNT_ERRORS[r.error] ?? '操作失敗。';
  return r.detail ? `${text}（${r.detail}）` : text;
};
async function adapt(promise: Promise<ServiceResult>) {
  const r = await promise;
  return r.ok ? { ok: true as const } : { ok: false as const, code: r.error, error: errorText(r) };
}

const ROLE_LABELS: Record<string, string> = { staff: '一般員工', finance: '財會', admin: '系統管理員' };
const IMPORT_FIELDS: Record<ImportField, string> = { name: '姓名', department: '部門', title: '職稱' };
const th = 'px-2 py-1.5 text-left text-xs font-semibold text-td-muted';
const td = 'px-2 py-1.5 align-top';

type FormValues = { employeeCode: string; name: string; departmentId: string; title: string; googleEmail: string; phone: string; extension: string; role: string };
const EMPTY: FormValues = { employeeCode: '', name: '', departmentId: '', title: '', googleEmail: '', phone: '', extension: '', role: 'staff' };
const valuesOf = (e: EmployeeAdminRow): FormValues => ({
  employeeCode: e.employeeCode,
  name: e.name,
  departmentId: e.departmentId,
  title: e.title ?? '',
  googleEmail: e.googleEmail ?? '',
  phone: e.phone ?? '',
  extension: e.extension ?? '',
  role: e.role,
});

export function EmployeesManager({ data, currentEmployeeId }: { data: Data; currentEmployeeId: string }) {
  const { pending, msg, run } = useOrgAction();
  const [filter, setFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [jobRoleFilter, setJobRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const q = filter.trim().toLowerCase();
  const rows = data.employees.filter(
    (e) =>
      (!q || [e.employeeCode, e.name, e.departmentName, e.googleEmail ?? '', e.title ?? ''].some((v) => v.toLowerCase().includes(q))) &&
      (!departmentFilter || e.departmentId === departmentFilter) &&
      (!jobRoleFilter || e.jobRoles.some((b) => b.jobRoleId === jobRoleFilter)) &&
      (statusFilter === '' ||
        (statusFilter === 'enabled' && e.accessEnabled) ||
        (statusFilter === 'unbound' && e.accessEnabled && !e.bound) ||
        (statusFilter === 'disabled' && !e.accessEnabled))
  );

  return (
    <div className="space-y-5">
      <ActionMessage msg={msg} />
      <Section
        title={`員工資料（${data.employees.length}）`}
        description="Workspace 同步授權前，用這裡手動新增、修改員工，或匯入 Excel。編輯時可調整系統角色與職務類別；停用與登入綁定請到「帳號與登入綁定」頁處理，修改 Email 不會變更已綁定的 Google 帳號。基本資料與系統角色需 15 分鐘內登入過，職務需 1 小時內登入過，全部記錄稽核。"
        actions={
          <button type="button" className={smallBtn} onClick={() => setAdding((v) => !v)}>
            {adding ? '取消新增' : '新增員工'}
          </button>
        }
      >
        {adding && (
          <EmployeeForm
            initial={EMPTY}
            departments={data.departments}
            withRole
            pending={pending}
            submitLabel="建立員工"
            onSubmit={(v) => {
              let createdId: string | undefined;
              run(
                async () => {
                  const r = await createEmployeeAction(v);
                  if (r.ok) createdId = r.employeeId;
                  return adapt(Promise.resolve(r));
                },
                `已建立員工 ${v.employeeCode.trim()}，可在下方指定職務`,
                () => {
                  setAdding(false);
                  setFilter('');
                  setDepartmentFilter('');
                  setJobRoleFilter('');
                  setStatusFilter('');
                  if (createdId) setEditing(createdId);
                }
              );
            }}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${smallInput} w-64`} aria-label="搜尋員工" placeholder="搜尋編號、姓名、部門、Email" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className={smallInput} aria-label="依部門篩選" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">全部部門</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
          <select className={smallInput} aria-label="依職務篩選" value={jobRoleFilter} onChange={(e) => setJobRoleFilter(e.target.value)}>
            <option value="">全部職務</option>
            {data.jobRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select className={smallInput} aria-label="依狀態篩選" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="">全部狀態</option>
            <option value="enabled">啟用中</option>
            <option value="unbound">未綁定登入</option>
            <option value="disabled">已停用</option>
          </select>
          <span className="text-xs text-td-muted">顯示 {rows.length} 位</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>編號</th>
              <th className={th}>姓名</th>
              <th className={th}>部門</th>
              <th className={th}>職稱</th>
              <th className={th}>職務</th>
              <th className={th}>Email</th>
              <th className={th}>電話／分機</th>
              <th className={th}>狀態</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) =>
              editing === e.id ? (
                <tr key={e.id} className="border-t border-td-border">
                  <td className={`${td} space-y-3`} colSpan={9}>
                    <EmployeeForm
                      initial={valuesOf(e)}
                      departments={data.departments}
                      pending={pending}
                      submitLabel="儲存基本資料"
                      onCancel={() => setEditing(null)}
                      onSubmit={(v) => run(() => adapt(updateEmployeeAction({ employeeId: e.id, ...v })), `已更新 ${v.employeeCode.trim()}`, () => setEditing(null))}
                    />
                    <RoleEditor employee={e} self={e.id === currentEmployeeId} pending={pending} run={run} />
                    <JobRoleEditor employee={e} departments={data.departments} jobRoles={data.jobRoles} pending={pending} run={run} />
                  </td>
                </tr>
              ) : (
                <tr key={e.id} className="border-t border-td-border">
                  <td className={td}>{e.employeeCode}</td>
                  <td className={td}>{e.name}</td>
                  <td className={td}>{e.departmentName}</td>
                  <td className={td}>{e.title ?? ''}</td>
                  <td className={`${td} text-xs`}>{e.jobRoles.map((b) => bindingLabel(b)).join('、')}</td>
                  <td className={`${td} text-xs`}>{e.googleEmail ?? ''}</td>
                  <td className={`${td} text-xs`}>{[e.phone, e.extension && `#${e.extension}`].filter(Boolean).join(' ')}</td>
                  <td className={`${td} text-xs`}>
                    {!e.accessEnabled ? <span className="text-red-700">已停用</span> : e.bound ? '已綁定登入' : <span className="text-amber-700">未綁定登入</span>}
                    {e.role !== 'staff' && <span className="ml-1 text-td-muted">・{ROLE_LABELS[e.role] ?? e.role}</span>}
                  </td>
                  <td className={td}>
                    <button type="button" className={smallBtn} onClick={() => setEditing(e.id)}>
                      編輯
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </Section>
      <ExcelImport />
    </div>
  );
}

function EmployeeForm({
  initial,
  departments,
  withRole = false,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  departments: Data['departments'];
  withRole?: boolean;
  pending: boolean;
  submitLabel: string;
  onSubmit: (v: FormValues) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(initial);
  const field = (key: keyof FormValues, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="flex flex-col gap-0.5 text-xs text-td-muted">
      {label}
      <input className={smallInput} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <form
      className="grid gap-2 rounded border border-td-border bg-td-blue-light/30 p-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      {field('employeeCode', '員工編號 *', { required: true, maxLength: 32 })}
      {field('name', '姓名 *', { required: true, maxLength: 100 })}
      <label className="flex flex-col gap-0.5 text-xs text-td-muted">
        部門 *
        <select className={smallInput} required value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}>
          <option value="">選擇部門…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} {d.name}
            </option>
          ))}
        </select>
      </label>
      {field('title', '職稱', { maxLength: 100 })}
      {field('googleEmail', '公司 Email', { type: 'email', maxLength: 200 })}
      {field('phone', '電話', { maxLength: 40 })}
      {field('extension', '分機', { maxLength: 20 })}
      {withRole && (
        <label className="flex flex-col gap-0.5 text-xs text-td-muted">
          系統角色
          <select className={smallInput} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            <option value="staff">一般員工</option>
            <option value="finance">財會</option>
          </select>
        </label>
      )}
      <div className="flex items-end gap-2 sm:col-span-4">
        <button type="submit" className={smallBtn} disabled={pending}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={smallBtn} onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </form>
  );
}

const bindingLabel = (b: EmployeeAdminRow['jobRoles'][number]) => `${b.jobRoleName}（${b.departmentName ?? '全公司'}${b.isPrimary ? '・主要' : ''}）`;

function RoleEditor({ employee, self, pending, run }: { employee: EmployeeAdminRow; self: boolean; pending: boolean; run: Run }) {
  const [role, setRole] = useState(employee.role);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-td-border p-3 text-xs">
      <span className="font-semibold text-td-muted">系統角色</span>
      {self ? (
        <span className="text-td-muted">{ROLE_LABELS[employee.role] ?? employee.role}（不能變更自己的角色）</span>
      ) : (
        <>
          <select className={smallInput} aria-label={`${employee.employeeCode} 系統角色`} value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={smallBtn}
            disabled={pending || role === employee.role}
            onClick={() => {
              if (role === 'admin' && !window.confirm(`將 ${employee.employeeCode} ${employee.name} 設為系統管理員？`)) return;
              run(() => adapt(setEmployeeRoleAction(employee.id, role)), `已將 ${employee.employeeCode} 設為${ROLE_LABELS[role]}`);
            }}
          >
            套用角色
          </button>
        </>
      )}
    </div>
  );
}

function JobRoleEditor({
  employee,
  departments,
  jobRoles,
  pending,
  run,
}: {
  employee: EmployeeAdminRow;
  departments: Data['departments'];
  jobRoles: JobRoleOption[];
  pending: boolean;
  run: Run;
}) {
  const [jobRoleId, setJobRoleId] = useState('');
  const [scope, setScope] = useState(employee.departmentId);
  const jobRole = jobRoles.find((r) => r.id === jobRoleId);
  const departmentId = jobRole?.isSystem || scope === '' ? null : scope;
  return (
    <div className="space-y-2 rounded border border-td-border p-3 text-xs">
      <div className="font-semibold text-td-muted">職務類別</div>
      {employee.jobRoles.length === 0 ? (
        <p className="text-td-muted">尚未擔任任何職務。</p>
      ) : (
        <ul className="space-y-1">
          {employee.jobRoles.map((b) => (
            <li key={b.bindingId} className="flex items-center gap-2">
              <span>{bindingLabel(b)}</span>
              <button
                type="button"
                className={dangerBtn}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(`移除 ${employee.name} 的職務「${b.jobRoleName}」？`)) return;
                  run(() => removeRoleHolderAction(b.bindingId), `已移除職務「${b.jobRoleName}」`);
                }}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className={smallInput} aria-label={`${employee.employeeCode} 新增職務`} value={jobRoleId} onChange={(e) => setJobRoleId(e.target.value)}>
          <option value="">選擇職務…</option>
          {jobRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {jobRole && !jobRole.isSystem && (
          <select className={smallInput} aria-label={`${employee.employeeCode} 職務範圍`} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">全公司</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={smallBtn}
          disabled={pending || !jobRole}
          onClick={() => {
            if (!jobRole) return;
            run(() => addRoleHolderAction({ jobRoleId: jobRole.id, employeeId: employee.id, departmentId }), `已指定職務「${jobRole.name}」`, () => setJobRoleId(''));
          }}
        >
          新增職務
        </button>
      </div>
    </div>
  );
}

function ExcelImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ plan: ImportPlan; sha256: string; file: File } | null>(null);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; reauth?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const doPreview = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setMessage(null);
    start(async () => {
      const form = new FormData();
      form.set('file', file);
      const r = await previewEmployeeImportAction(form);
      if (r.ok) {
        setPreview({ plan: r.plan, sha256: r.sha256, file });
        setSkipped({});
      } else {
        setPreview(null);
        setMessage({ kind: 'error', text: errorText(r), reauth: r.error === 'reauth_required' });
      }
    });
  };

  const include = preview ? [...preview.plan.creates, ...preview.plan.updates].map((r) => r.employeeCode).filter((c) => !skipped[c]) : [];
  const doApply = () => {
    if (!preview || include.length === 0) return;
    setMessage(null);
    start(async () => {
      const form = new FormData();
      form.set('file', preview.file);
      form.set('sha256', preview.sha256);
      form.set('include', JSON.stringify(include));
      const r = await applyEmployeeImportAction(form);
      if (r.ok) {
        setMessage({ kind: 'ok', text: `已匯入 ${'applied' in r ? (r.applied ?? 0) : 0} 筆` });
        setPreview(null);
        if (fileRef.current) fileRef.current.value = '';
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: errorText(r), reauth: r.error === 'reauth_required' });
      }
    });
  };

  const toggle = (code: string) => (
    <input type="checkbox" aria-label={`匯入 ${code}`} checked={!skipped[code]} onChange={(e) => setSkipped((s) => ({ ...s, [code]: !e.target.checked }))} />
  );

  return (
    <Section
      title="匯入 Excel"
      description="使用公司員工活頁簿的「link」工作表（與初始資料相同格式：B 員工編號、C 姓名、D 部門名稱、E 部門代碼、G 職稱）。先預覽，勾選要套用的列再匯入。部門依代碼比對、不會自動建立；空白欄位不會清除既有資料；工作表中沒有的員工不會被停用。新員工預設為一般員工、未綁定登入。"
    >
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" aria-label="員工 Excel 檔案" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="text-sm" onChange={() => setPreview(null)} />
        <button type="button" className={smallBtn} disabled={pending} onClick={doPreview}>
          預覽
        </button>
      </div>
      <ActionMessage msg={message} />
      {preview && (
        <div className="space-y-4 text-sm">
          <p className="text-td-muted">
            新增 {preview.plan.creates.length}、更新 {preview.plan.updates.length}、無變更 {preview.plan.unchanged}、錯誤 {preview.plan.errors.length}
          </p>
          {preview.plan.errors.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold text-red-700">無法匯入的列（不會套用）</h3>
              <ul className="space-y-0.5 text-xs text-red-700">
                {preview.plan.errors.map((e) => (
                  <li key={e.rowNumber}>
                    第 {e.rowNumber} 列 {e.employeeCode}：{e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.plan.creates.length > 0 && (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>新增</th>
                  <th className={th}>列</th>
                  <th className={th}>編號</th>
                  <th className={th}>姓名</th>
                  <th className={th}>部門</th>
                  <th className={th}>職稱</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.creates.map((c) => (
                  <tr key={c.employeeCode} className="border-t border-td-border">
                    <td className={td}>{toggle(c.employeeCode)}</td>
                    <td className={td}>{c.rowNumber}</td>
                    <td className={td}>{c.employeeCode}</td>
                    <td className={td}>{c.name}</td>
                    <td className={td}>{c.departmentLabel}</td>
                    <td className={td}>{c.title ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {preview.plan.updates.length > 0 && (
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>更新</th>
                  <th className={th}>列</th>
                  <th className={th}>員工</th>
                  <th className={th}>變更</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.updates.map((u) => (
                  <tr key={u.employeeCode} className="border-t border-td-border">
                    <td className={td}>{toggle(u.employeeCode)}</td>
                    <td className={td}>{u.rowNumber}</td>
                    <td className={td}>{u.employeeCode}</td>
                    <td className={`${td} text-xs`}>
                      {u.changes.map((c) => (
                        <div key={c.field}>
                          {IMPORT_FIELDS[c.field]}：<span className="text-td-muted">{c.current ?? '（空）'}</span> → <span className="font-semibold">{c.next}</span>
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button type="button" className={smallBtn} disabled={pending || include.length === 0} onClick={doApply}>
            套用勾選的 {include.length} 筆
          </button>
        </div>
      )}
    </Section>
  );
}
