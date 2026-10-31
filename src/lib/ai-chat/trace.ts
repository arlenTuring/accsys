import { getDb } from '@/lib/db';
import { aiTurnTraces } from '@/lib/db/schema';

/**
 * Per-turn trace with one correlation id (the user turn's clientMessageId).
 * Every stage is written to the server log as one JSON line and to
 * ai_turn_traces, so a failed turn can be reconstructed afterwards:
 * who, which conversation/form/schema version, every model round, every tool
 * call and result, draft versions before/after, and the UI events returned.
 *
 * Privacy: field values are recorded only when AI_TRACE_VALUES=1 outside
 * production; otherwise only keys, types and lengths. Credentials, tokens and
 * file bytes are never passed in.
 */

export type TraceStage =
  | 'turn.start'
  | 'turn.context'
  | 'turn.work_state'
  | 'model.request'
  | 'model.response'
  | 'tool.call'
  | 'tool.result'
  | 'draft.write'
  | 'turn.ui_events'
  | 'turn.end'
  | 'turn.error';

const SENSITIVE_KEY = /token|secret|password|authorization|cookie|bank_?account|base64|bytes/i;

export function valuesAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.AI_TRACE_VALUES === '1' && env.NODE_ENV !== 'production';
}

/** Shape-only summary of arbitrary data (keys, types, sizes), or the value itself when allowed. */
export function summarize(value: unknown, withValues = valuesAllowed(), depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    if (withValues) return value.length > 300 ? `${value.slice(0, 300)}…(${value.length})` : value;
    return `<string:${value.length}>`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return withValues ? value : `<${typeof value}>`;
  if (Array.isArray(value)) {
    if (depth > 3) return `<array:${value.length}>`;
    return value.slice(0, 20).map((v) => summarize(v, withValues, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth > 3) return '<object>';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : summarize(v, withValues, depth + 1);
    }
    return out;
  }
  return `<${typeof value}>`;
}

export class TurnTrace {
  private seq = 0;
  private pending: Promise<unknown> = Promise.resolve();
  readonly events: { seq: number; stage: TraceStage; data: Record<string, unknown> }[] = [];

  constructor(
    readonly turnId: string,
    readonly conversationId: string | null,
    readonly ownerEmployeeId: string | null,
    private readonly persist = true
  ) {}

  emit(stage: TraceStage, data: Record<string, unknown> = {}): void {
    const seq = ++this.seq;
    this.events.push({ seq, stage, data });
    console.info(
      JSON.stringify({ ai_trace: true, turnId: this.turnId, conversationId: this.conversationId, seq, stage, ...data })
    );
    if (!this.persist) return;
    // Never let diagnostics break the turn; writes are serialized per turn.
    this.pending = this.pending
      .then(() =>
        getDb()
          .insert(aiTurnTraces)
          .values({
            turnId: this.turnId,
            conversationId: this.conversationId,
            ownerEmployeeId: this.ownerEmployeeId,
            seq,
            stage,
            data,
          })
      )
      .catch((err) => console.warn('[ai-trace] persist failed', err instanceof Error ? err.message : err));
  }

  /** Wait for pending trace writes (tests, scripts). */
  flush(): Promise<unknown> {
    return this.pending;
  }
}
