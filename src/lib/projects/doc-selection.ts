/** A paragraph's Google Docs indices include the terminating newline. */
export type DocParagraph = { startIndex: number; endIndex: number; text: string; heading?: boolean };
export type SelectionMatch = { paragraphs: DocParagraph[]; confidence: number };
export type DocAnchor = SelectionMatch & { docId: string; revisionId: string; startIndex: number; endIndex: number };

export type DocsDocument = { revisionId?: string; body?: { content?: Array<{ startIndex?: number; endIndex?: number; paragraph?: { paragraphStyle?: { namedStyleType?: string }; elements?: Array<{ textRun?: { content?: string } }> } }> } };

export function paragraphsFromDocument(doc: DocsDocument): DocParagraph[] {
  return (doc.body?.content ?? []).flatMap((item) => {
    if (!item.paragraph || typeof item.startIndex !== 'number' || typeof item.endIndex !== 'number') return [];
    const text = (item.paragraph.elements ?? []).map((e) => e.textRun?.content ?? '').join('').replace(/\n$/, '');
    if (!text.trim()) return [];
    const style = item.paragraph.paragraphStyle?.namedStyleType ?? '';
    return [{ startIndex: item.startIndex, endIndex: item.endIndex, text, heading: /^(HEADING_|TITLE|SUBTITLE)/.test(style) }];
  });
}

export function anchorDocumentSelection(docId: string, doc: DocsDocument, selected: string):
  | { ok: true; anchor: DocAnchor }
  | { ok: false; reason: 'target_not_found' | 'ambiguous_target' | 'api_error' } {
  if (!doc.revisionId) return { ok: false, reason: 'api_error' };
  const result = matchDocumentSelection(paragraphsFromDocument(doc), selected);
  if (!result.ok) return result;
  const p = result.match.paragraphs;
  return { ok: true, anchor: { ...result.match, docId, revisionId: doc.revisionId, startIndex: p[0].startIndex, endIndex: p[p.length - 1].endIndex - 1 } };
}

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function bigrams(text: string): Set<string> {
  const chars = Array.from(normalize(text));
  return new Set(chars.slice(0, -1).map((c, i) => c + chars[i + 1]));
}

/** Require substantial coverage of each paragraph; a stray partial preceding sentence is excluded. */
export function matchDocumentSelection(paragraphs: DocParagraph[], selected: string):
  | { ok: true; match: SelectionMatch }
  | { ok: false; reason: 'target_not_found' | 'ambiguous_target' } {
  const selection = bigrams(selected);
  if (selection.size < 8) return { ok: false, reason: 'target_not_found' };
  const candidates = paragraphs.map((paragraph, index) => {
    const grams = bigrams(paragraph.text);
    if (paragraph.heading || grams.size < 6) {
      return { paragraph, index, score: 0, selectionCoverage: 0, eligible: false };
    }
    const overlap = [...grams].filter((g) => selection.has(g)).length;
    return {
      paragraph,
      index,
      score: overlap / grams.size,
      selectionCoverage: overlap / selection.size,
      eligible: true,
    };
  });
  const hits = candidates.filter((x) => x.eligible && x.score >= 0.72);
  if (!hits.length) {
    const partialHits = candidates.filter((x) => x.eligible && x.selectionCoverage >= 0.8);
    if (!partialHits.length) return { ok: false, reason: 'target_not_found' };
    if (partialHits.length > 1) return { ok: false, reason: 'ambiguous_target' };
    const hit = partialHits[0];
    return { ok: true, match: { paragraphs: [hit.paragraph], confidence: hit.selectionCoverage } };
  }
  const groups: typeof hits[] = [];
  for (const hit of hits) {
    const group = groups[groups.length - 1];
    if (group && hit.index === group[group.length - 1].index + 1) group.push(hit);
    else groups.push([hit]);
  }
  if (groups.length !== 1) return { ok: false, reason: 'ambiguous_target' };
  const group = groups[0];
  return { ok: true, match: { paragraphs: group.map((x) => x.paragraph), confidence: Math.min(...group.map((x) => x.score)) } };
}
