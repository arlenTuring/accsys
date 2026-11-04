/**
 * Live progress events for one assistant turn (SSE / UI timeline).
 * Seconds are measured by the emitter (server) and/or the client clock.
 */

export type ChatProgressStepKind = 'thinking' | 'tool' | 'reply';

export type ChatProgressStep = {
  id: string;
  kind: ChatProgressStepKind;
  /** Short Chinese label shown in the timeline row. */
  label: string;
  status: 'running' | 'done' | 'error';
  /** Optional expandable detail (thought summary, tool message, …). */
  detail?: string;
  /** Epoch ms when the step started. */
  startedAt: number;
  /** Epoch ms when the step finished (status done/error). */
  endedAt?: number;
};

export type ChatProgressEvent =
  | { type: 'step'; step: ChatProgressStep }
  | { type: 'heartbeat'; at: number };

export type TurnProgressSink = (event: ChatProgressEvent) => void;

export function stepElapsedMs(step: ChatProgressStep, now = Date.now()): number {
  const end = step.endedAt ?? now;
  return Math.max(0, end - step.startedAt);
}

export function formatElapsedZh(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}
