'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { createAnnouncementAction } from '@/lib/announcements/actions';

type Dept = { id: string; code: string; name: string };
type Emp = { id: string; employeeCode: string; name: string; departmentId: string };

export function AnnouncementCreateForm(props: { departments: Dept[]; employees: Emp[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [publishAt, setPublishAt] = useState('');
  const [audienceType, setAudienceType] = useState<'company' | 'department' | 'employees'>('company');
  const [deptIds, setDeptIds] = useState<string[]>([]);
  const [empIds, setEmpIds] = useState<string[]>([]);
  const [empFilter, setEmpFilter] = useState('');

  const filteredEmployees = useMemo(() => {
    const q = empFilter.trim().toLowerCase();
    if (!q) return props.employees.slice(0, 80);
    return props.employees
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.employeeCode.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [empFilter, props.employees]);

  function toggle(list: string[], id: string, set: (v: string[]) => void) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const created = await createAnnouncementAction({
            title,
            body,
            priority,
            publishAt: publishAt || null,
            audienceType,
            audienceDepartmentIds: audienceType === 'department' ? deptIds : [],
            audienceEmployeeIds: audienceType === 'employees' ? empIds : [],
          });
          if (!created.ok) {
            setError(created.error);
            return;
          }
          router.push(`/admin/announcements/${created.announcement.id}/edit`);
          router.refresh();
        });
      }}
    >
      <h2 className="text-sm font-semibold">公告內容</h2>
      <input
        className="w-full rounded border px-3 py-2 text-sm"
        placeholder="標題"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={200}
      />
      <textarea
        className="min-h-[8rem] w-full rounded border px-3 py-2 text-sm"
        placeholder="內文（純文字）"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <fieldset className="space-y-2 text-sm">
        <legend className="font-medium">受眾</legend>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ['company', '全公司'],
              ['department', '指定部門'],
              ['employees', '指定員工'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="audience"
                checked={audienceType === value}
                onChange={() => setAudienceType(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {audienceType === 'department' && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
            {props.departments.map((d) => (
              <label key={d.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={deptIds.includes(d.id)}
                  onChange={() => toggle(deptIds, d.id, setDeptIds)}
                />
                <span>
                  {d.name} <span className="text-td-muted">({d.code})</span>
                </span>
              </label>
            ))}
            {props.departments.length === 0 && <p className="text-td-muted">沒有可用部門。</p>}
          </div>
        )}
        {audienceType === 'employees' && (
          <div className="space-y-2">
            <input
              className="w-full rounded border px-2 py-1 text-sm"
              placeholder="搜尋姓名或工號"
              value={empFilter}
              onChange={(e) => setEmpFilter(e.target.value)}
            />
            <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
              {filteredEmployees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={empIds.includes(emp.id)}
                    onChange={() => toggle(empIds, emp.id, setEmpIds)}
                  />
                  <span>
                    {emp.name} <span className="text-td-muted">({emp.employeeCode})</span>
                  </span>
                </label>
              ))}
              {filteredEmployees.length === 0 && <p className="text-td-muted">沒有符合的員工。</p>}
            </div>
            {empIds.length > 0 && (
              <p className="text-xs text-td-muted">已選 {empIds.length} 人</p>
            )}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          重要程度
          <select
            className="rounded border px-2 py-1"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
          >
            <option value="normal">一般</option>
            <option value="important">重要</option>
            <option value="urgent">緊急</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          排程發布（可空＝立即）
          <input
            type="datetime-local"
            className="rounded border px-2 py-1"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="text-sm text-amber-800">{error}</p>}
      <button type="submit" className="btn-primary text-sm" disabled={pending}>
        {pending ? '處理中…' : '建立並繼續編輯'}
      </button>
    </form>
  );
}
