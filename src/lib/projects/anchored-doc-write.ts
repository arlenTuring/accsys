import { anchorDocumentSelection, paragraphsFromDocument, type DocAnchor, type DocParagraph, type DocsDocument } from './doc-selection';

type FailureReason = 'no_tokens' | 'auth_failed' | 'permission_denied' | 'target_not_found' | 'ambiguous_target' | 'revision_conflict' | 'api_error' | 'paragraph_count_mismatch' | 'verification_unknown';
type Failure = { ok: false; reason: FailureReason; restored?: boolean };
type ReadResult = { ok: true; doc: DocsDocument } | Failure;

export type StreamOptions = {
  /** Type the replacement in clause-sized chunks so the live Docs editor shows it being written. */
  stream?: boolean;
  /** Upper bound on typing writes per call; Docs API allows roughly 60 writes per user per minute. */
  maxChunks?: number;
  chunkDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function reasonForStatus(status: number): FailureReason {
  return status === 401 ? 'auth_failed' : status === 403 ? 'permission_denied' : status === 409 ? 'revision_conflict' : 'api_error';
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readGoogleDocument(docId: string, token: string): Promise<ReadResult> {
  try {
    const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
    return { ok: true, doc: await res.json() as DocsDocument };
  } catch { return { ok: false, reason: 'api_error' }; }
}

type BatchResult = { ok: true; revisionId?: string } | { ok: false; status: number };

async function batchUpdate(
  docId: string,
  token: string,
  requests: unknown[],
  writeControl: { requiredRevisionId?: string; targetRevisionId?: string }
): Promise<BatchResult> {
  const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writeControl, requests }), signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json().catch(() => ({}))) as { writeControl?: { requiredRevisionId?: string } };
  return { ok: true, revisionId: json.writeControl?.requiredRevisionId };
}

/** Splits text into at most `count` clause-aligned chunks of similar size. */
export function splitIntoTypingChunks(text: string, count: number): string[] {
  if (count <= 1 || text.length <= 8) return [text];
  const clauses = text.match(/[^。！？；!?;，,、]+[。！？；!?;，,、]*/g) ?? [text];
  const target = text.length / count;
  const chunks: string[] = [];
  let current = '';
  for (const clause of clauses) {
    current += clause;
    if (current.length >= target && chunks.length < count - 1) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.join('') === text ? chunks : [text];
}

function validateCurrentAnchor(doc: DocsDocument, anchor: DocAnchor): DocAnchor | FailureReason {
  if (doc.revisionId !== anchor.revisionId) {
    const relocated = anchorDocumentSelection(anchor.docId, doc, anchor.paragraphs.map((p) => p.text).join('\n'));
    if (!relocated.ok) return relocated.reason === 'api_error' ? 'api_error' : 'revision_conflict';
    if (relocated.anchor.paragraphs.map((p) => p.text).join('\n') !== anchor.paragraphs.map((p) => p.text).join('\n')) return 'revision_conflict';
    return relocated.anchor;
  }
  const currentParagraphs = paragraphsFromDocument(doc).filter((p) => p.startIndex >= anchor.startIndex && p.endIndex - 1 <= anchor.endIndex);
  if (!currentParagraphs.length || currentParagraphs[0].startIndex !== anchor.startIndex || currentParagraphs[currentParagraphs.length - 1].endIndex - 1 !== anchor.endIndex || currentParagraphs.some((p) => p.heading) || currentParagraphs.map((p) => p.text).join('\n') !== anchor.paragraphs.map((p) => p.text).join('\n')) return 'revision_conflict';
  return anchor;
}

export async function writeAnchoredDocument(
  token: string,
  anchor: DocAnchor,
  text: string,
  options: StreamOptions = {}
): Promise<{ ok: true; anchor: DocAnchor; streamed: boolean } | Failure> {
  if (!text.trim() || !Array.isArray(anchor.paragraphs) || anchor.paragraphs.length === 0 || anchor.endIndex <= anchor.startIndex) return { ok: false, reason: 'target_not_found' };
  const replacement = text.trim().split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (replacement.length !== anchor.paragraphs.length) return { ok: false, reason: 'paragraph_count_mismatch' };
  const before = await readGoogleDocument(anchor.docId, token);
  if (!before.ok) return before;
  const validated = validateCurrentAnchor(before.doc, anchor);
  if (typeof validated === 'string') return { ok: false, reason: validated };
  const current = validated;

  const written = options.stream
    ? await streamReplacement(token, current, replacement, options)
    : await replaceAtOnce(token, current, replacement);
  if (!written.ok) return written;

  const after = await readGoogleDocument(anchor.docId, token);
  if (!after.ok) return { ok: false, reason: 'verification_unknown' };
  const updated = anchorDocumentSelection(anchor.docId, after.doc, replacement.join('\n'));
  if (!updated.ok || updated.anchor.startIndex !== current.startIndex) return { ok: false, reason: 'verification_unknown' };
  return { ok: true, anchor: updated.anchor, streamed: Boolean(options.stream) };
}

async function replaceAtOnce(token: string, current: DocAnchor, replacement: string[]): Promise<{ ok: true } | Failure> {
  let sent = false;
  try {
    // Reverse paragraph order, preserving delete-before-insert within each paragraph.
    const ordered = current.paragraphs.map((p, i) => [
      { deleteContentRange: { range: { startIndex: p.startIndex, endIndex: p.endIndex - 1 } } },
      { insertText: { location: { index: p.startIndex }, text: replacement[i] } },
    ]).reverse().flat();
    sent = true;
    const res = await batchUpdate(current.docId, token, ordered, { requiredRevisionId: current.revisionId });
    if (!res.ok) return { ok: false, reason: res.status === 400 || res.status === 409 ? 'revision_conflict' : reasonForStatus(res.status) };
    return { ok: true };
  } catch { return { ok: false, reason: sent ? 'verification_unknown' : 'api_error' }; }
}

/**
 * 1. Clears the anchored paragraphs in one revision-locked write (paragraph breaks kept).
 * 2. Types the replacement top-to-bottom in clause chunks, each write targeting the
 *    revision returned by the previous one so concurrent collaborator edits are transformed.
 * 3. On HTTP 429 the remainder is written in one request; on any other failure the
 *    original text is written back so the document is never left half-written.
 */
async function streamReplacement(
  token: string,
  current: DocAnchor,
  replacement: string[],
  options: StreamOptions
): Promise<{ ok: true } | Failure> {
  const sleep = options.sleep ?? defaultSleep;
  const delay = options.chunkDelayMs ?? 250;
  const maxChunks = Math.max(1, options.maxChunks ?? 12);
  const paragraphs: DocParagraph[] = current.paragraphs;
  const removedLengths = paragraphs.map((p) => Math.max(0, p.endIndex - 1 - p.startIndex));
  // Start index of each (now empty) paragraph after the clearing write.
  const clearedStarts = paragraphs.map((p, i) => p.startIndex - removedLengths.slice(0, i).reduce((a, b) => a + b, 0));
  const typed = paragraphs.map(() => 0);
  // Current start of paragraph i given how much of each paragraph has been typed so far.
  const typedStartOf = (i: number) => clearedStarts[i] + typed.slice(0, i).reduce((a, b) => a + b, 0);
  const positionOf = (i: number) => typedStartOf(i) + typed[i];

  let revision: string | undefined;
  try {
    const deletes = paragraphs
      .map((p, i) => (removedLengths[i] > 0 ? { deleteContentRange: { range: { startIndex: p.startIndex, endIndex: p.endIndex - 1 } } } : null))
      .filter(Boolean)
      .reverse();
    const cleared = deletes.length
      ? await batchUpdate(current.docId, token, deletes, { requiredRevisionId: current.revisionId })
      : { ok: true as const, revisionId: current.revisionId };
    if (!cleared.ok) return { ok: false, reason: cleared.status === 400 || cleared.status === 409 ? 'revision_conflict' : reasonForStatus(cleared.status) };
    revision = cleared.revisionId;
  } catch {
    return { ok: false, reason: 'api_error' };
  }

  const totalLength = replacement.reduce((a, b) => a + b.length, 0) || 1;
  const plan = replacement.map((r) => splitIntoTypingChunks(r, Math.max(1, Math.round((r.length / totalLength) * maxChunks))));

  const control = () => (revision ? { targetRevisionId: revision } : {});
  let failure: FailureReason | null = null;

  outer: for (let i = 0; i < plan.length; i += 1) {
    for (let c = 0; c < plan[i].length; c += 1) {
      const chunk = plan[i][c];
      let res: BatchResult;
      try {
        res = await batchUpdate(current.docId, token, [{ insertText: { location: { index: positionOf(i) }, text: chunk } }], control());
      } catch {
        failure = 'api_error';
        break outer;
      }
      if (res.ok) {
        typed[i] += chunk.length;
        // Never reuse an older revision as target: indices are relative to the state after this chunk.
        revision = res.revisionId;
        await sleep(delay);
        continue;
      }
      if (res.status === 429) {
        const finished = await finishRemainder(token, current.docId, replacement, typed, positionOf, () => revision, sleep);
        if (finished.ok) return { ok: true };
        failure = finished.reason;
        revision = finished.revision ?? revision;
        break outer;
      }
      failure = reasonForStatus(res.status);
      break outer;
    }
  }
  if (!failure) return { ok: true };

  // Restore the original text in place of whatever was typed so far.
  try {
    const restore = paragraphs.map((p, i) => {
      const start = typedStartOf(i);
      const reqs: unknown[] = [];
      if (typed[i] > 0) reqs.push({ deleteContentRange: { range: { startIndex: start, endIndex: start + typed[i] } } });
      if (p.text) reqs.push({ insertText: { location: { index: start }, text: p.text } });
      return reqs;
    }).reverse().flat();
    const restored = restore.length ? await batchUpdate(current.docId, token, restore, control()) : { ok: true as const };
    if (restored.ok) return { ok: false, reason: failure, restored: true };
  } catch {
    // fall through
  }
  return { ok: false, reason: 'verification_unknown' };
}

async function finishRemainder(
  token: string,
  docId: string,
  replacement: string[],
  typed: number[],
  positionOf: (i: number) => number,
  getRevision: () => string | undefined,
  sleep: (ms: number) => Promise<void>
): Promise<{ ok: true } | { ok: false; reason: FailureReason; revision?: string }> {
  const requests = replacement
    .map((r, i) => (typed[i] < r.length ? { insertText: { location: { index: positionOf(i) }, text: r.slice(typed[i]) } } : null))
    .filter(Boolean)
    .reverse();
  if (!requests.length) return { ok: true };
  for (const wait of [1500, 3000, 6000]) {
    await sleep(wait);
    try {
      const rev = getRevision();
      const res = await batchUpdate(docId, token, requests, rev ? { targetRevisionId: rev } : {});
      if (res.ok) {
        replacement.forEach((r, i) => { typed[i] = r.length; });
        return { ok: true };
      }
      if (res.status !== 429) return { ok: false, reason: reasonForStatus(res.status) };
    } catch {
      return { ok: false, reason: 'api_error' };
    }
  }
  return { ok: false, reason: 'api_error' };
}
