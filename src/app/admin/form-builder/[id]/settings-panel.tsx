'use client';

import { useState, useTransition } from 'react';
import { createCategoryAction, saveSettingsAction } from '@/lib/form-builder/actions';
import type { BuilderCategory, BuilderOrg, DesignerData } from '@/lib/form-builder/queries';
import { CATEGORY_LIMITS } from '@/lib/form-builder/blank';
import { ActionMessage, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { StepNav, type Tab } from './step-nav';

type Settings = DesignerData['settings'];
type Msg = { kind: 'ok' | 'error'; text: string; reauth?: boolean } | null;

function toggle(list: string[] | undefined, v: string, on: boolean): string[] {
  const set = new Set(list ?? []);
  if (on) set.add(v);
  else set.delete(v);
  return [...set];
}

export function SettingsPanel({
  id,
  initial,
  keyEditable,
  published,
  categories,
  org,
  rowVersion,
  onSaved,
  goTo,
}: {
  id: string;
  initial: Settings;
  keyEditable: boolean;
  published: boolean;
  categories: BuilderCategory[];
  org: BuilderOrg;
  rowVersion: number;
  onSaved: (version: number, settings: Settings) => void;
  goTo: (t: Tab) => void;
}) {
  const [s, setS] = useState<Settings>(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [added, setAdded] = useState<BuilderCategory[]>([]);
  const [adding, setAdding] = useState<{ title: string; description: string } | null>(null);
  const [addMsg, setAddMsg] = useState<Msg>(null);
  const [addPending, startAdd] = useTransition();
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const restricted = (s.visibility.departmentIds?.length ?? 0) + (s.visibility.jobRoles?.length ?? 0) > 0;
  const allCategories = [...categories, ...added.filter((a) => !categories.some((c) => c.key === a.key))];
  const blocked = !s.name.trim() ? '請填寫表單名稱' : !s.key.trim() ? '請填寫表單代號' : null;

  const save = (then?: () => void) => {
    setMsg(null);
    start(async () => {
      try {
        const next = { ...s, numberPrefix: s.numberPrefix.toUpperCase() };
        const r = await saveSettingsAction(id, next, rowVersion);
        if (r.ok) {
          setMsg({ kind: 'ok', text: published ? '設定已儲存並立即生效' : '設定已儲存' });
          onSaved(r.version, next);
          then?.();
        } else {
          setMsg({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
        }
      } catch {
        setMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
      }
    });
  };

  const addCategory = () => {
    if (!adding) return;
    setAddMsg(null);
    startAdd(async () => {
      try {
        const r = await createCategoryAction(adding);
        if (r.ok) {
          setAdded((list) => [...list, r.category]);
          setS((cur) => ({ ...cur, categoryKey: r.category.key }));
          setAdding(null);
          setMsg({ kind: 'ok', text: `已新增入口分類「${r.category.title}」並選取，按「儲存設定」後這張表單就會放在這個分類` });
        } else {
          setAddMsg({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
        }
      } catch {
        setAddMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
      }
    });
  };

  return (
    <div className="card max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-td-blue-dark">發佈設定</h2>
        <p className="mt-1 text-xs text-td-muted">
          這裡的設定按「儲存設定」後立即生效{published ? '（已發佈的表單會馬上更新選單名稱、分類與可填寫的人）' : ''}，不需要重新發佈；欄位與流程的修改則要發佈新版本才生效。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="表單名稱">
          <input className={smallInput} maxLength={60} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </Field>
        <Field label="表單代號（網址）" hint={keyEditable ? '發佈後不能再修改' : '已發佈，不能修改'}>
          <input className={`${smallInput} font-mono`} maxLength={40} value={s.key} disabled={!keyEditable} onChange={(e) => setS({ ...s, key: e.target.value })} />
        </Field>
        <Field label="說明（顯示在選單與填寫頁）">
          <textarea className={`${smallInput} resize-y`} rows={2} maxLength={300} value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="入口分類">
            <select className={smallInput} value={s.categoryKey} onChange={(e) => setS({ ...s, categoryKey: e.target.value })}>
              {!allCategories.some((c) => c.key === s.categoryKey) && <option value={s.categoryKey}>（已停用的分類）</option>}
              {allCategories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="分類內排序">
            <input className={smallInput} type="number" min={0} max={9999} value={s.sortOrder} onChange={(e) => setS({ ...s, sortOrder: Number(e.target.value) })} />
          </Field>
          {!adding && (
            <button
              type="button"
              className="col-span-2 -mt-1 justify-self-start text-xs font-semibold text-td-blue hover:underline"
              onClick={() => {
                setAddMsg(null);
                setAdding({ title: '', description: '' });
              }}
            >
              ＋ 新增入口分類
            </button>
          )}
        </div>
        <Field label="表單編號字首" hint="編號為 日期＋字首＋當日流水號，例如 20261014SA0001">
          <input className={`${smallInput} font-mono uppercase`} maxLength={6} value={s.numberPrefix} onChange={(e) => setS({ ...s, numberPrefix: e.target.value })} />
        </Field>
      </div>

      {adding && (
        <form
          className="space-y-3 rounded border border-td-border bg-slate-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            addCategory();
          }}
        >
          <div>
            <p className="text-sm font-semibold text-td-blue-dark">新增入口分類</p>
            <p className="mt-0.5 text-xs text-td-muted">新分類會出現在選單與「申請表單」頁，分類裡至少要有一張已發佈的表單才會顯示。</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={`分類名稱（最多 ${CATEGORY_LIMITS.title} 字）`}>
              <input
                className={smallInput}
                autoFocus
                maxLength={CATEGORY_LIMITS.title}
                placeholder="例如：人事申請"
                value={adding.title}
                onChange={(e) => setAdding({ ...adding, title: e.target.value })}
              />
            </Field>
            <Field label={`說明（選填，最多 ${CATEGORY_LIMITS.description} 字）`}>
              <input
                className={smallInput}
                maxLength={CATEGORY_LIMITS.description}
                value={adding.description}
                onChange={(e) => setAdding({ ...adding, description: e.target.value })}
              />
            </Field>
          </div>
          <ActionMessage msg={addMsg} />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !py-1.5" disabled={addPending || !adding.title.trim()}>
              {addPending ? '新增中…' : '新增並選取'}
            </button>
            <button type="button" className={smallBtn} disabled={addPending} onClick={() => setAdding(null)}>
              取消
            </button>
          </div>
        </form>
      )}

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-td-blue-dark">誰可以填寫</legend>
        <p className="text-xs text-td-muted">
          {restricted ? '只有所屬部門或職務類別符合任一勾選項目的員工看得到並可以填寫。' : '目前沒有勾選，所有員工都可以填寫。'}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="max-h-48 overflow-y-auto rounded border border-td-border p-2">
            <p className="mb-1 text-xs font-semibold text-td-muted">部門</p>
            {org.departments.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.visibility.departmentIds?.includes(d.id) ?? false}
                  onChange={(e) => setS({ ...s, visibility: { ...s.visibility, departmentIds: toggle(s.visibility.departmentIds, d.id, e.target.checked) } })}
                />
                {d.name}
              </label>
            ))}
          </div>
          <div className="max-h-48 overflow-y-auto rounded border border-td-border p-2">
            <p className="mb-1 text-xs font-semibold text-td-muted">職務類別</p>
            {org.jobRoles.map((r) => (
              <label key={r.code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.visibility.jobRoles?.includes(r.code) ?? false}
                  onChange={(e) => setS({ ...s, visibility: { ...s.visibility, jobRoles: toggle(s.visibility.jobRoles, r.code, e.target.checked) } })}
                />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <ActionMessage msg={msg} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary !py-1.5" disabled={pending || !dirty} onClick={() => save()}>
          {pending ? '儲存中…' : '儲存設定'}
        </button>
        <button type="button" className="btn-secondary !py-1.5" disabled={pending || !dirty} onClick={() => setS(initial)}>
          還原
        </button>
      </div>
      <div className="border-t border-td-border pt-4">
        <StepNav
          tab="settings"
          goTo={goTo}
          blocked={pending ? '儲存中…' : blocked}
          nextLabel={dirty ? '儲存設定並下一步：預覽' : undefined}
          onNext={dirty ? () => save(() => goTo('preview')) : undefined}
        />
      </div>
    </div>
  );
}
