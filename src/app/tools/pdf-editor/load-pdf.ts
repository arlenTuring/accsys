'use client';

export type RenderedPdfPage = {
  pageIndex: number;
  imageUrl: string;
  width: number;
  height: number;
};

let workerReady = false;

// Everything runs in the user's browser; these bounds keep a hostile or huge
// PDF from exhausting the tab.
export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_PDF_PAGES = 100;

export async function loadAndRenderPdf(file: File): Promise<{
  bytes: ArrayBuffer;
  pages: RenderedPdfPage[];
}> {
  // Lazy-load pdfjs so the editor shell can open without waiting on a ~1.7MB chunk
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    workerReady = true;
  }

  if (file.size > MAX_PDF_BYTES) throw new Error('PDF 檔案不可超過 30 MB');
  const bytes = await file.arrayBuffer();
  const data = new Uint8Array(bytes.slice(0));

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // No eval-based font compilation; no fetching of external resources.
    isEvalSupported: false,
    disableAutoFetch: true,
  });
  const doc = await loadingTask.promise;
  if (doc.numPages > MAX_PDF_PAGES) {
    await doc.destroy();
    throw new Error(`PDF 頁數不可超過 ${MAX_PDF_PAGES} 頁`);
  }

  const pages: RenderedPdfPage[] = [];
  const scale = 1.35;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('無法建立畫布');

      await (
        page.render({
          canvasContext: ctx,
          viewport,
          canvas,
        } as Parameters<typeof page.render>[0])
      ).promise;

      pages.push({
        pageIndex: i - 1,
        imageUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
      });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return { bytes, pages };
}
