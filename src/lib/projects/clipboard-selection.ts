import { matchDocumentSelection, type DocParagraph } from './doc-selection';

/**
 * Classifies clipboard text captured when the user clicks the selection orb.
 * The orb flow is "select text in Google Docs → copy → click orb"; the cross-origin
 * Docs iframe never exposes its selection, so the clipboard is the only exact source.
 *
 * Pure and browser-safe: clipboard text is matched against already-loaded document
 * paragraphs on the client so unrelated clipboard content never leaves the browser.
 */

export const MAX_LINKED_PARAGRAPHS = 8;
export const MAX_LINKED_CHARS = 3000;

export type LinkedParagraphRange = {
  paragraphs: DocParagraph[];
  confidence: number;
  startIndex: number;
  endIndex: number;
  /** Nearest preceding heading-like paragraph, used as the chip label. */
  sectionLabel: string;
  /** 1-based ordinal of the first selected paragraph within its section. */
  ordinalInSection: number;
  /** True when the copied text covers only part of the matched paragraph(s). */
  partial: boolean;
};

export type ClipboardClassification =
  | { kind: 'empty' }
  | { kind: 'url' }
  | { kind: 'not_in_doc' }
  | { kind: 'ambiguous' }
  | { kind: 'too_large' }
  | { kind: 'same_as_last'; range: LinkedParagraphRange }
  | { kind: 'ok'; range: LinkedParagraphRange };

export type LastLinkedRef = { startIndex: number; text: string } | null | undefined;

const NUMBERED_HEADING =
  /^\s*(?:[(（][0-9０-９一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]{1,3}[)）]|[(（]?[0-9０-９一二三四五六七八九十壹貳參肆伍陸柒捌玖拾]{1,3}[)）]?\s*[、.．:：]|第[一二三四五六七八九十0-9]+[章節條]|[0-9]+(?:\.[0-9]+)+\s)/;

/** Heading-like: styled heading, or a short numbered line such as "1、申請創新實驗計畫之緣由". */
export function isHeadingLike(paragraph: DocParagraph): boolean {
  if (paragraph.heading) return true;
  const text = paragraph.text.trim();
  return text.length > 0 && text.length <= 40 && NUMBERED_HEADING.test(text) && !/[。；;]$/.test(text);
}

function compact(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
}

export function describeParagraphRange(
  all: DocParagraph[],
  matched: DocParagraph[],
  copiedText: string,
  confidence: number
): LinkedParagraphRange {
  const first = matched[0];
  const last = matched[matched.length - 1];
  const firstIdx = all.findIndex((p) => p.startIndex === first.startIndex);
  let sectionLabel = '';
  let ordinal = 1;
  for (let i = firstIdx - 1; i >= 0; i -= 1) {
    if (isHeadingLike(all[i])) {
      sectionLabel = all[i].text.trim();
      break;
    }
    ordinal += 1;
  }
  const matchedChars = compact(matched.map((p) => p.text).join('')).length;
  const copiedChars = compact(copiedText).length;
  return {
    paragraphs: matched,
    confidence,
    startIndex: first.startIndex,
    endIndex: last.endIndex - 1,
    sectionLabel: sectionLabel || '文件內容',
    ordinalInSection: ordinal,
    partial: copiedChars < matchedChars * 0.9,
  };
}

export function classifyClipboardSelection(
  clipboardText: string | null | undefined,
  paragraphs: DocParagraph[],
  lastLinked?: LastLinkedRef
): ClipboardClassification {
  const text = (clipboardText ?? '').trim();
  if (compact(text).length < 4) return { kind: 'empty' };
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return { kind: 'url' };
  if (text.length > MAX_LINKED_CHARS) return { kind: 'too_large' };

  const result = matchDocumentSelection(paragraphs, text);
  if (!result.ok) {
    return { kind: result.reason === 'ambiguous_target' ? 'ambiguous' : 'not_in_doc' };
  }
  // A copied numbered heading line ("1、申請…之緣由") is context, not edit target.
  let matched = result.match.paragraphs;
  while (matched.length > 1 && isHeadingLike(matched[0])) matched = matched.slice(1);
  const matchedChars = matched.reduce((sum, p) => sum + p.text.length, 0);
  if (matched.length > MAX_LINKED_PARAGRAPHS || matchedChars > MAX_LINKED_CHARS) {
    return { kind: 'too_large' };
  }
  const range = describeParagraphRange(paragraphs, matched, text, result.match.confidence);
  if (
    lastLinked &&
    lastLinked.startIndex === range.startIndex &&
    lastLinked.text === matched.map((p) => p.text).join('\n')
  ) {
    return { kind: 'same_as_last', range };
  }
  return { kind: 'ok', range };
}

export function clipboardClassificationMessage(
  kind: Exclude<ClipboardClassification['kind'], 'ok' | 'same_as_last'> | 'denied' | 'unsupported' | 'load_failed',
  copyKey: string
): string {
  switch (kind) {
    case 'empty':
    case 'url':
      return `看起來還沒有複製文字。請在文件中選取要修改的段落，按 ${copyKey}，再按小球。`;
    case 'not_in_doc':
      return `剪貼簿目前的內容不在這份文件中，可能忘了按 ${copyKey}。請重新選取段落並按 ${copyKey}，再按小球。`;
    case 'ambiguous':
      return `這段文字在文件中出現多次，請多選一些前後文再按 ${copyKey}。`;
    case 'too_large':
      return `選取範圍太大（上限 ${MAX_LINKED_PARAGRAPHS} 段或 ${MAX_LINKED_CHARS} 字），請縮小到要修改的段落。`;
    case 'denied':
      return `瀏覽器尚未允許讀取剪貼簿。請在網址列左側的網站設定開啟「剪貼簿」，或在下方輸入框按 ${copyKey.replace(/C$/, 'V')} 貼上剛複製的文字。`;
    case 'unsupported':
      return `這個瀏覽器無法讀取剪貼簿。請在下方輸入框按 ${copyKey.replace(/C$/, 'V')} 貼上剛複製的文字。`;
    case 'load_failed':
      return '目前無法讀取這份 Google 文件的內容，請稍後再試一次。';
  }
}

export function previewSnippet(text: string, max = 20): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
