'use client';

import { useRef, useState, useTransition } from 'react';
import { confirmPropertyRegisterImport, previewPropertyRegisterImport } from '@/lib/assets/actions';

type Preview = {
  sheetName: string;
  counts: { create: number; update: number; unchanged: number; skip: number; fail: number };
  unresolvedCustodians: string[];
  unresolvedDepartments: string[];
  issueCount: number;
  sampleIssues: Array<{ rowNumber: number; column?: string; message: string }>;
  sampleFails: Array<{ row: number; tag: string; action: string; reason?: string }>;
};

export function PropertyImportClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{error}</p>}
      {result && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{result}</p>}

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold text-td-blue-dark">1. 選檔與驗證</h2>
        <input ref={fileRef} type="file" accept=".xlsx" className="block w-full text-sm" />
        <button
          type="button"
          className="btn-secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setResult(null);
              setPreview(null);
              const file = fileRef.current?.files?.[0];
              if (!file) {
                setError('請選擇 Excel');
                return;
              }
              const fd = new FormData();
              fd.set('file', file);
              const res = await previewPropertyRegisterImport(fd);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setPreview(res.preview);
              setFileName(res.fileName);
              setIdempotencyKey(crypto.randomUUID());
            })
          }
        >
          {pending ? '解析中…' : '產生差異預覽'}
        </button>
      </section>

      {preview && (
        <section className="card space-y-3 p-4 text-sm">
          <h2 className="font-semibold text-td-blue-dark">2. 差異預覽（{preview.sheetName}）</h2>
          <p>
            新增 {preview.counts.create} · 更新 {preview.counts.update} · 無變更 {preview.counts.unchanged} · 略過{' '}
            {preview.counts.skip} · 失敗 {preview.counts.fail}
          </p>
          {preview.unresolvedCustodians.length > 0 && (
            <div>
              <p className="font-medium text-amber-900">未對應保管人（不會建立假員工）</p>
              <p className="text-xs text-td-muted">{preview.unresolvedCustodians.slice(0, 40).join('、')}</p>
            </div>
          )}
          {preview.unresolvedDepartments.length > 0 && (
            <div>
              <p className="font-medium text-amber-900">未對應保管部門</p>
              <p className="text-xs text-td-muted">{preview.unresolvedDepartments.slice(0, 40).join('、')}</p>
            </div>
          )}
          {preview.sampleFails.length > 0 && (
            <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-xs text-red-800">
              {preview.sampleFails.map((f) => (
                <li key={`${f.row}-${f.tag}`}>
                  第 {f.row} 列 {f.tag}：{f.reason}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !idempotencyKey || preview.counts.create + preview.counts.update === 0}
            onClick={() =>
              start(async () => {
                setError(null);
                const file = fileRef.current?.files?.[0];
                if (!file || !idempotencyKey) return;
                const fd = new FormData();
                fd.set('file', file);
                fd.set('idempotencyKey', idempotencyKey);
                const res = await confirmPropertyRegisterImport(fd);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setResult(
                  `匯入完成（${fileName}）：新增 ${res.counts.create}、更新 ${res.counts.update}、無變更 ${res.counts.unchanged}、略過 ${res.counts.skip}、失敗 ${res.counts.fail}。盤點批次 ${res.inventoryBatchId.slice(0, 8)}…`
                );
              })
            }
          >
            {pending ? '寫入中…' : '確認匯入'}
          </button>
          <p className="text-xs text-td-muted">重送同一 idempotency key 不會重複建立資產。</p>
        </section>
      )}
    </div>
  );
}
