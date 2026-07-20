'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteBudgetCode, upsertBudgetCode } from '@/lib/budget-codes/actions';
import type { BudgetCodeListItem } from '@/lib/budget-codes/queries';
import type { ProjectListItem } from '@/lib/projects/queries';
import { BudgetCodeImportForm } from './budget-code-import-form';
import { ProjectManager } from './project-manager';

type FormState = {
  code: string;
  departmentCode: string;
  projectCode: string;
  category: string;
  fiscalYear: string;
  annualBudgetAmount: string;
  ownerEmployeeCode: string;
};

const emptyForm: FormState = {
  code: '',
  departmentCode: '',
  projectCode: '',
  category: '',
  fiscalYear: '',
  annualBudgetAmount: '',
  ownerEmployeeCode: '',
};

function toFormState(item: BudgetCodeListItem): FormState {
  return {
    code: item.code,
    departmentCode: item.departmentCode ?? '',
    projectCode: item.projectCode ?? '',
    category: item.category,
    fiscalYear: item.fiscalYear,
    annualBudgetAmount: item.annualBudgetAmount != null ? String(item.annualBudgetAmount) : '',
    ownerEmployeeCode: item.ownerEmployeeCode ?? '',
  };
}

export function BudgetCodesManager({
  budgetCodes,
  projects,
}: {
  budgetCodes: BudgetCodeListItem[];
  projects: ProjectListItem[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const onEdit = (item: BudgetCodeListItem) => {
    setError(null);
    setForm(toFormState(item));
  };

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertBudgetCode({
      code: form.code,
      departmentCode: form.departmentCode || null,
      projectCode: form.projectCode || null,
      category: form.category,
      fiscalYear: form.fiscalYear,
      annualBudgetAmount: Number(form.annualBudgetAmount),
      ownerEmployeeCode: form.ownerEmployeeCode || null,
    });
    setSaving(false);
    if (result.ok) {
      setForm(emptyForm);
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    setDeletingId(id);
    const result = await deleteBudgetCode(id);
    setDeletingId(null);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <div className="space-y-8">
      <section className="rounded border p-4">
        <h2 className="mb-3 font-semibold">新增／編輯預算編號</h2>
        {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            預算編號
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            類別
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            部門代碼
            <input
              value={form.departmentCode}
              onChange={(e) => setForm({ ...form, departmentCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            專案代碼
            <select
              value={form.projectCode}
              onChange={(e) => setForm({ ...form, projectCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            >
              <option value="">（不指定專案）</option>
              {projects.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.code}｜{p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            年度
            <input
              value={form.fiscalYear}
              onChange={(e) => setForm({ ...form, fiscalYear: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            年度預算金額
            <input
              type="number"
              value={form.annualBudgetAmount}
              onChange={(e) => setForm({ ...form, annualBudgetAmount: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block text-sm">
            負責人工號
            <input
              value={form.ownerEmployeeCode}
              onChange={(e) => setForm({ ...form, ownerEmployeeCode: e.target.value })}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          {form.code && (
            <button
              type="button"
              onClick={() => setForm(emptyForm)}
              className="rounded border px-3 py-1 text-sm"
            >
              清空（新增模式）
            </button>
          )}
        </div>
      </section>

      <BudgetCodeImportForm />

      <ProjectManager projects={projects} />

      <section>
        <h2 className="mb-3 font-semibold">現有預算編號（{budgetCodes.length}）</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-2">編號</th>
              <th className="py-1 pr-2">部門／專案</th>
              <th className="py-1 pr-2">類別</th>
              <th className="py-1 pr-2">年度</th>
              <th className="py-1 pr-2">金額</th>
              <th className="py-1 pr-2">負責人</th>
              <th className="py-1 pr-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {budgetCodes.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-1 pr-2">{b.code}</td>
                <td className="py-1 pr-2">{b.departmentName ?? b.projectName ?? '-'}</td>
                <td className="py-1 pr-2">{b.category}</td>
                <td className="py-1 pr-2">{b.fiscalYear}</td>
                <td className="py-1 pr-2">{b.annualBudgetAmount ?? '-'}</td>
                <td className="py-1 pr-2">
                  {b.ownerName ?? <span className="text-amber-700">⚠️ 缺少負責人</span>}
                </td>
                <td className="py-1 pr-2">
                  <button
                    type="button"
                    onClick={() => onEdit(b)}
                    className="mr-2 text-blue-600 underline"
                  >
                    編輯
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(b.id)}
                    disabled={deletingId === b.id}
                    className="text-red-600 underline disabled:opacity-50"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
