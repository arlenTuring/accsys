'use client';

import dynamic from 'next/dynamic';

const PdfEditorApp = dynamic(
  () => import('./pdf-editor-app').then((m) => m.PdfEditorApp),
  {
    ssr: false,
    loading: () => (
      <main className="page-shell">
        <div className="card max-w-md">
          <p className="font-semibold text-td-blue-dark">載入 PDF 編輯器…</p>
          <p className="mt-2 text-sm text-td-muted">
            首次開啟可能需要幾秒，請稍候。若長時間無反應，請重新整理頁面。
          </p>
        </div>
      </main>
    ),
  }
);

export default function ToolsPdfEditorPage() {
  return <PdfEditorApp />;
}
