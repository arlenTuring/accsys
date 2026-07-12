'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importBudgetCodesFromExcel } from '@/lib/budget-codes/actions';

export function BudgetCodeImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    successCount: number;
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const onUpload = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('請選擇檔案');
      return;
    }
    setError(null);
    setSummary(null);
    setUploading(true);
    const formData = new FormData();
    formData.set('file', file);
    const result = await importBudgetCodesFromExcel(formData);
    setUploading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSummary(result.summary);
    router.refresh();
  };

  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 font-semibold">批次匯入（Excel）</h2>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="mb-2 text-sm">
          <p>
            成功 {summary.successCount} 筆、失敗 {summary.errors.length} 筆
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-6 text-red-700">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  第 {e.row} 列：{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".xlsx" className="text-sm" />
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="rounded border px-3 py-1 text-sm disabled:opacity-50"
        >
          {uploading ? '匯入中…' : '上傳並匯入'}
        </button>
      </div>
    </section>
  );
}
