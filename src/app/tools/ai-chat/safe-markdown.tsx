'use client';

import { useState } from 'react';

/**
 * Minimal safe markdown: bold, italic, code (with one-click copy button), links (http/https only).
 * No raw HTML / dangerouslySetInnerHTML.
 */

type Seg =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; v: string };

function parseInline(src: string): Seg[] {
  const out: Seg[] = [];
  const re =
    /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ t: 'text', v: src.slice(last, m.index) });
    if (m[2]) out.push({ t: 'bold', v: m[2] });
    else if (m[3]) out.push({ t: 'italic', v: m[3] });
    else if (m[4]) out.push({ t: 'code', v: m[4] });
    else if (m[5] && m[6]) out.push({ t: 'link', v: m[5], href: m[6] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ t: 'text', v: src.slice(last) });
  return out;
}

function CopyableCodeBadge({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 align-baseline">
      <code className="rounded bg-td-blue-light/50 px-1.5 py-0.5 font-mono text-[0.85em] text-td-blue-dark">
        {value}
      </code>
      <button
        type="button"
        onClick={() => void handleCopy()}
        title={`複製「${value}」`}
        aria-label={`複製 ${value}`}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium transition-colors ${
          copied
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-td-blue/40 hover:bg-slate-50 hover:text-td-blue-dark'
        }`}
      >
        {copied ? (
          <>
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
              <path d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.563a1 1 0 0 1-1.42 0L3.29 9.766a1 1 0 1 1 1.42-1.408l3.79 3.822 6.79-6.847a1 1 0 0 1 1.414-.043Z" />
            </svg>
            <span>已複製</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden>
              <path d="M6 2a2 2 0 0 0-2 2v1H3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H6Zm7 11V7a2 2 0 0 0-2-2H6V4h8v9h-1ZM3 7h8v9H3V7Z" />
            </svg>
            <span>複製</span>
          </>
        )}
      </button>
    </span>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) => {
        if (s.t === 'bold') return <strong key={i}>{s.v}</strong>;
        if (s.t === 'italic') return <em key={i}>{s.v}</em>;
        if (s.t === 'code') return <CopyableCodeBadge key={i} value={s.v} />;
        if (s.t === 'link')
          return (
            <a key={i} href={s.href} className="underline" rel="noopener noreferrer" target="_blank">
              {s.v}
            </a>
          );
        return <span key={i}>{s.v}</span>;
      })}
    </>
  );
}

export function SafeMarkdown({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\n/);
  return (
    <div className={className}>
      {lines.map((line, i) => (
        <p key={i} className={i > 0 ? 'mt-1 whitespace-pre-wrap' : 'whitespace-pre-wrap'}>
          <Inline text={line} />
        </p>
      ))}
    </div>
  );
}
