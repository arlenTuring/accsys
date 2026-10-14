import { Fragment } from 'react';

// Web addresses and files under /docs/ become links; nothing else in notice text is markup.
const LINK = /(https?:\/\/[^\s<>"'）)]+|\/docs\/[A-Za-z0-9._-]+)/g;

export function NoticeText({ text }: { text: string }) {
  const parts = text.split(LINK);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="font-semibold text-td-blue hover:underline">
            {part.startsWith('/docs/') ? part.slice('/docs/'.length) : part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}
