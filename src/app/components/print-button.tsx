'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';

/**
 * Triggers the browser's native print dialog for a given application detail URL
 * by loading the full detail page (including all fields, tables, and the complete
 * ApprovalTimeline) inside an offscreen iframe and invoking `contentWindow.print()`.
 */
export function triggerPrintUrl(href: string, onDone?: () => void) {
  if (typeof window === 'undefined') return;

  const printUrl = `${href}${href.includes('?') ? '&' : '?'}print=1`;

  // Remove any previous print iframe
  const existing = document.getElementById('accsys-hidden-print-frame');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'accsys-hidden-print-frame';
  iframe.src = printUrl;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = '1024px';
  iframe.style.height = '900px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';

  let printed = false;

  const doPrint = () => {
    if (printed) return;
    printed = true;
    window.removeEventListener('message', onMessage);
    window.clearTimeout(fallbackTimer);
    try {
      const cw = iframe.contentWindow;
      if (cw) {
        cw.focus();
        cw.print();
        onDone?.();
        return;
      }
    } catch {
      /* fallback to opening in new tab if iframe print fails */
    }
    window.open(printUrl, '_blank', 'noopener,noreferrer');
    onDone?.();
  };

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (e.data && typeof e.data === 'object' && e.data.type === 'accsys-print-ready') {
      window.setTimeout(doPrint, 120);
    }
  };

  window.addEventListener('message', onMessage);

  iframe.onload = () => {
    window.setTimeout(doPrint, 450);
  };

  const fallbackTimer = window.setTimeout(doPrint, 4000);
  document.body.appendChild(iframe);
}

/**
 * Rendered on form detail pages (`status === 'approved'`).
 * Also coordinates `?print=1` auto-printing when opened directly or via `triggerPrintUrl`.
 */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== '1') return;

    if (window.self !== window.top) {
      // Loaded inside the hidden print iframe: notify parent that detail + timeline are mounted
      const id = window.requestAnimationFrame(() => {
        window.parent.postMessage({ type: 'accsys-print-ready' }, window.location.origin);
      });
      return () => window.cancelAnimationFrame(id);
    }

    // Opened directly in a browser tab with ?print=1
    params.delete('print');
    const cleanSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', cleanUrl);

    const timer = window.setTimeout(() => {
      window.print();
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-secondary inline-flex items-center gap-1.5 print:hidden"
    >
      <span aria-hidden>🖨️</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * Compact shortcut button for approved application rows in「我的申請」and AI chat cards.
 * Directly loads the detailed application + approval results and pops up the OS printer dialog.
 */
export function QuickPrintButton({
  href,
  size = 'sm',
}: {
  href: string;
  size?: 'xs' | 'sm';
}) {
  const { t } = useI18n();
  const [printing, setPrinting] = useState(false);

  return (
    <button
      type="button"
      disabled={printing}
      onClick={(e) => {
        e.stopPropagation();
        if (printing) return;
        setPrinting(true);
        triggerPrintUrl(href, () => setPrinting(false));
      }}
      title="列印完整申請單與詳細簽核結果"
      className={
        size === 'xs'
          ? 'inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50/70 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 print:hidden'
          : 'inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60 print:hidden'
      }
    >
      <span>{printing ? t.approvalsPage.printingShortcut : t.approvalsPage.printShortcut}</span>
    </button>
  );
}
