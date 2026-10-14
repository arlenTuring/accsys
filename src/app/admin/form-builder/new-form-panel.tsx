'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createDefinitionAction } from '@/lib/form-builder/actions';
import type { BuilderCategory } from '@/lib/form-builder/queries';
import { ActionMessage, smallInput } from '../org/org-ui';
import { Field } from './builder-ui';

export function NewFormPanel({ categories, sources }: { categories: BuilderCategory[]; sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', categoryKey: categories[0]?.key ?? '', numberPrefix: '', copyFrom: '' });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string; reauth?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = () => {
    setMsg(null);
    start(async () => {
      try {
        const r = await createDefinitionAction({ ...form, numberPrefix: form.numberPrefix.toUpperCase(), copyFrom: form.copyFrom || null });
        if (r.ok) router.push(`/admin/form-builder/${r.id}`);
        else setMsg({ kind: 'error', text: r.error, reauth: r.code === 'reauth_required' });
      } catch {
        setMsg({ kind: 'error', text: '連線失敗，請稍後再試' });
      }
    });
  };

  if (!open) {
    return (
      <div>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          ＋ 新增表單
        </button>
      </div>
    );
  }

  return (
    <section className="card space-y-4">
      <h2 className="text-base font-semibold text-td-blue-dark">新增表單</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="表單名稱">
          <input className={smallInput} value={form.name} onChange={set('name')} maxLength={60} placeholder="例如 用印申請單（非合約類）" />
        </Field>
        <Field label="表單代號（網址用，發佈後不能修改）" hint="2–40 個小寫英數字或連字號，例如 general-seal">
          <input className={`${smallInput} font-mono`} value={form.key} onChange={set('key')} maxLength={40} placeholder="general-seal" />
        </Field>
        <Field label="入口分類">
          <select className={smallInput} value={form.categoryKey} onChange={set('categoryKey')}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="表單編號字首" hint="1–6 個大寫英數字；編號為 日期＋字首＋流水號，例如 20261014SA0001">
          <input className={`${smallInput} font-mono uppercase`} value={form.numberPrefix} onChange={set('numberPrefix')} maxLength={6} placeholder="SA" />
        </Field>
        <Field label="從哪裡開始">
          <select className={smallInput} value={form.copyFrom} onChange={set('copyFrom')}>
            <option value="">空白表單</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                複製「{s.name}」
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ActionMessage msg={msg} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary !py-1.5" disabled={pending} onClick={create}>
          {pending ? '建立中…' : '建立並開始設計'}
        </button>
        <button type="button" className="btn-secondary !py-1.5" disabled={pending} onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </section>
  );
}
