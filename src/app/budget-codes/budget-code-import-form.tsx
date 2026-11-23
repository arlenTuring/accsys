'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { importBudgetCodesFromExcel } from '@/lib/budget-codes/actions';

export function BudgetCodeImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fiscalYearForTemplate, setFiscalYearForTemplate] = useState('2027');
  const [includeHistorical, setIncludeHistorical] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    successCount: number;
    historicalCount?: number;
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
    formData.set('includeHistorical', includeHistorical ? 'true' : 'false');
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
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-td-blue-dark">
            預算 Excel 匯入與標準範本下載
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            支援上傳單張清單範本，或直接上傳填妥之「年度部門預算表」、「年度營收.產品專案預算表」、「年度預算差異分析表」多工作表 Excel 檔。
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="font-medium text-slate-600">
            範本年度：
            <input
              value={fiscalYearForTemplate}
              onChange={(e) => setFiscalYearForTemplate(e.target.value)}
              className="ml-1.5 w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-center"
              placeholder="2027"
            />
          </label>
        </div>
      </div>

      {/* 標準範本檔下載列 */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-3 text-xs font-semibold text-slate-700">下載官方標準 Excel 範本檔：</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <a
            href={`/api/budget-codes/templates/department?year=${encodeURIComponent(fiscalYearForTemplate)}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3.5 py-2.5 text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            <span>📥</span>
            <span>{fiscalYearForTemplate}年度部門預算表-空白V1.xlsx</span>
          </a>
          <a
            href={`/api/budget-codes/templates/project?year=${encodeURIComponent(fiscalYearForTemplate)}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3.5 py-2.5 text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            <span>📥</span>
            <span>{fiscalYearForTemplate}年度營收.產品專案預算表-空白V1.xlsx</span>
          </a>
          <a
            href={`/api/budget-codes/templates/variance?year=${encodeURIComponent(fiscalYearForTemplate)}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3.5 py-2.5 text-xs font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
          >
            <span>📥</span>
            <span>{fiscalYearForTemplate}年度預算差異分析表-空白V1.xlsx</span>
          </a>
          <a
            href={`/api/budget-codes/templates/flat?year=${encodeURIComponent(fiscalYearForTemplate)}`}
            download
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <span>📥</span>
            <span>預算編號與歷年資料批次匯入清單範本.xlsx</span>
          </a>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">
            成功匯入／更新本年度預算 {summary.successCount} 筆
            {summary.historicalCount ? `、同步匯入歷年對照資料 ${summary.historicalCount} 筆` : ''}
            、失敗 {summary.errors.length} 筆
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-1.5 list-disc pl-6 text-red-700">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  第 {e.row} 列：{e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
        <input ref={fileInputRef} type="file" accept=".xlsx" className="text-sm" />
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={includeHistorical}
            onChange={(e) => setIncludeHistorical(e.target.checked)}
          />
          同時匯入檔案內之「歷年實際執行數」作為跨年度對照資料
        </label>
        <button
          type="button"
          onClick={onUpload}
          disabled={uploading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {uploading ? '匯入中…' : '上傳並匯入'}
        </button>
      </div>
    </section>
  );
}
