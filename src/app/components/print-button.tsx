'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';

/**
 * Directly prepares the full printable application document in the background
 * on the current page and invokes the OS native printer dialog (`window.print()`)
 * without navigating away or opening a new browser tab.
 */
export async function triggerPrintUrl(href: string, onDone?: () => void) {
  if (typeof window === 'undefined') return;

  const cleanup = () => {
    document.body.classList.remove('accsys-direct-printing');
    const existing = document.getElementById('accsys-direct-print-root');
    if (existing) existing.remove();
  };

  try {
    const res = await fetch(href, {
      credentials: 'same-origin',
      headers: { Accept: 'text/html' },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch printable document (${res.status})`);
    }
    const html = await res.text();
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(html, 'text/html');
    const mainEl = parsedDoc.querySelector('main');
    if (!mainEl) {
      throw new Error('Printable main section not found');
    }

    // Remove interactive / navigation elements that should not appear on paper
    mainEl
      .querySelectorAll(
        'nav, button, input, select, textarea, .print\\:hidden, [aria-label="簽核與單據追蹤導覽列"]'
      )
      .forEach((el) => el.remove());

    cleanup();

    const printRoot = document.createElement('div');
    printRoot.id = 'accsys-direct-print-root';
    printRoot.setAttribute('aria-hidden', 'true');
    printRoot.appendChild(document.importNode(mainEl, true));

    document.body.appendChild(printRoot);
    document.body.classList.add('accsys-direct-printing');

    let finished = false;
    const finishPrint = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('afterprint', finishPrint);
      cleanup();
      onDone?.();
    };

    window.addEventListener('afterprint', finishPrint, { once: true });

    // Wait 2 animation frames so styles & layout are ready, then open the printer dialog directly
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          window.print();
        } finally {
          // Fallback cleanup in case afterprint does not fire in certain environments
          window.setTimeout(finishPrint, 1000);
        }
      });
    });
  } catch {
    cleanup();
    onDone?.();
  }
}

/**
 * Rendered on form detail pages.
 * Directly triggers `window.print()` on the current page.
 */
export function PrintButton({ label }: { label: string }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('print') !== '1') return;

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
 * Compact shortcut button for application rows in「簽核與單據追蹤」and AI chat cards.
 * Prepares the full printable form + approval timeline in the background and
 * pops up the OS printer dialog directly on the current page without navigating away.
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
        e.preventDefault();
        e.stopPropagation();
        if (printing) return;
        setPrinting(true);
        void triggerPrintUrl(href, () => setPrinting(false));
      }}
      title="直接準備此單據完整內容並開啟印表機列印"
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
