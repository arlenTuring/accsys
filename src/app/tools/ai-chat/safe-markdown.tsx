'use client';

/**
 * Minimal safe markdown: bold, italic, code, links (http/https only).
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

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) => {
        if (s.t === 'bold') return <strong key={i}>{s.v}</strong>;
        if (s.t === 'italic') return <em key={i}>{s.v}</em>;
        if (s.t === 'code')
          return (
            <code key={i} className="rounded bg-td-blue-light/50 px-1 text-[0.85em]">
              {s.v}
            </code>
          );
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
