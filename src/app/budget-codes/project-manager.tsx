'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PROJECT_KIND_LABELS, type ProjectKind } from '@/lib/expense-claims/editions';
import { upsertProject } from '@/lib/projects/actions';
import type { ProjectListItem } from '@/lib/projects/queries';

export function ProjectManager({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ProjectKind>('product');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertProject({ code, name, kind });
    setSaving(false);
    if (result.ok) {
      setCode('');
      setName('');
      router.refresh();
    } else {
      setError(result.error);
    }
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 font-semibold">專案管理</h2>
      <p className="mb-2 text-xs text-gray-500">
        專案類型決定預算可用於哪一種費用申請單：產品專案 → 產品專案版，營收專案 → 營收專案版。
      </p>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="專案代碼"
          className="rounded border px-2 py-1"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="專案名稱"
          className="flex-1 rounded border px-2 py-1"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ProjectKind)}
          aria-label="專案類型"
          className="rounded border px-2 py-1"
        >
          {Object.entries(PROJECT_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? '儲存中…' : '新增／更新專案'}
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-gray-600">
        {projects.map((p) => (
          <li key={p.id}>
            {p.code}｜{p.name}｜{PROJECT_KIND_LABELS[p.kind] ?? p.kind}
          </li>
        ))}
      </ul>
    </section>
  );
}
