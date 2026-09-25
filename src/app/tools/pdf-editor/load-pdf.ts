'use client';

export type RenderedPdfPage = {
  pageIndex: number;
  imageUrl: string;
  width: number;
  height: number;
};

let workerReady = false;

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

  const bytes = await file.arrayBuffer();
  const data = new Uint8Array(bytes.slice(0));

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

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
