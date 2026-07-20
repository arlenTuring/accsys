'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { upsertProject } from '@/lib/projects/actions';
import type { ProjectListItem } from '@/lib/projects/queries';

export function ProjectManager({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    const result = await upsertProject({ code, name });
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
            {p.code}｜{p.name}
          </li>
        ))}
      </ul>
    </section>
  );
}
