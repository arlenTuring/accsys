import { anchorDocumentSelection, paragraphsFromDocument, type DocAnchor, type DocsDocument } from './doc-selection';

type FailureReason = 'no_tokens' | 'auth_failed' | 'permission_denied' | 'target_not_found' | 'ambiguous_target' | 'revision_conflict' | 'api_error' | 'paragraph_count_mismatch' | 'verification_unknown';
type Failure = { ok: false; reason: FailureReason };
type ReadResult = { ok: true; doc: DocsDocument } | Failure;

function reasonForStatus(status: number): FailureReason {
  return status === 401 ? 'auth_failed' : status === 403 ? 'permission_denied' : status === 409 ? 'revision_conflict' : 'api_error';
}

export async function readGoogleDocument(docId: string, token: string): Promise<ReadResult> {
  try {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
    return { ok: true, doc: await res.json() as DocsDocument };
  } catch { return { ok: false, reason: 'api_error' }; }
}

export async function writeAnchoredDocument(token: string, anchor: DocAnchor, text: string): Promise<{ ok: true; anchor: DocAnchor } | Failure> {
  if (!text.trim() || !Array.isArray(anchor.paragraphs) || anchor.paragraphs.length === 0 || anchor.endIndex <= anchor.startIndex) return { ok: false, reason: 'target_not_found' };
  const replacement = text.trim().split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (replacement.length !== anchor.paragraphs.length) return { ok: false, reason: 'paragraph_count_mismatch' };
  const before = await readGoogleDocument(anchor.docId, token);
  if (!before.ok) return before;
  let current = anchor;
  if (before.doc.revisionId !== anchor.revisionId) {
    const relocated = anchorDocumentSelection(anchor.docId, before.doc, anchor.paragraphs.map((p) => p.text).join('\n'));
    if (!relocated.ok) return { ok: false, reason: relocated.reason === 'api_error' ? 'api_error' : 'revision_conflict' };
    if (relocated.anchor.paragraphs.map((p) => p.text).join('\n') !== anchor.paragraphs.map((p) => p.text).join('\n')) return { ok: false, reason: 'revision_conflict' };
    current = relocated.anchor;
  } else {
    const currentParagraphs = paragraphsFromDocument(before.doc).filter((p) => p.startIndex >= anchor.startIndex && p.endIndex - 1 <= anchor.endIndex);
    if (!currentParagraphs.length || currentParagraphs[0].startIndex !== anchor.startIndex || currentParagraphs[currentParagraphs.length - 1].endIndex - 1 !== anchor.endIndex || currentParagraphs.some((p) => p.heading) || currentParagraphs.map((p) => p.text).join('\n') !== anchor.paragraphs.map((p) => p.text).join('\n')) return { ok: false, reason: 'revision_conflict' };
  }
  let sent = false;
  try {
    // Reverse paragraph order, preserving delete-before-insert within each paragraph.
    const ordered = current.paragraphs.map((p, i) => [
      { deleteContentRange: { range: { startIndex: p.startIndex, endIndex: p.endIndex - 1 } } },
      { insertText: { location: { index: p.startIndex }, text: replacement[i] } },
    ]).reverse().flat();
    sent = true;
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(anchor.docId)}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ writeControl: { requiredRevisionId: current.revisionId }, requests: ordered }), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, reason: res.status === 400 || res.status === 409 ? 'revision_conflict' : reasonForStatus(res.status) };
    const after = await readGoogleDocument(anchor.docId, token);
    if (!after.ok) return { ok: false, reason: 'verification_unknown' };
    const updated = anchorDocumentSelection(anchor.docId, after.doc, text);
    if (!updated.ok || updated.anchor.startIndex !== current.startIndex) return { ok: false, reason: 'verification_unknown' };
    return { ok: true, anchor: updated.anchor };
  } catch { return { ok: false, reason: sent ? 'verification_unknown' : 'api_error' }; }
}
