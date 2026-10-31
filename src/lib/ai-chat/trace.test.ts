import { describe, expect, it, vi } from 'vitest';
import { summarize, TurnTrace, valuesAllowed } from './trace';

describe('valuesAllowed', () => {
  it('requires AI_TRACE_VALUES=1 and refuses production', () => {
    expect(valuesAllowed({})).toBe(false);
    expect(valuesAllowed({ AI_TRACE_VALUES: '1', NODE_ENV: 'development' })).toBe(true);
    expect(valuesAllowed({ AI_TRACE_VALUES: '1', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('summarize', () => {
  it('keeps only shapes when values are not allowed', () => {
    expect(summarize({ location: '台中', amount: 120, ok: true }, false)).toEqual({
      location: '<string:2>',
      amount: '<number>',
      ok: '<boolean>',
    });
  });

  it('keeps values when allowed but always redacts sensitive keys', () => {
    const out = summarize(
      { location: '台中', sessionToken: 'abc', bankAccount: '123', nested: { password: 'x', imageBase64: 'y' } },
      true
    );
    expect(out).toEqual({
      location: '台中',
      sessionToken: '[redacted]',
      bankAccount: '[redacted]',
      nested: { password: '[redacted]', imageBase64: '[redacted]' },
    });
  });

  it('truncates long strings and bounds depth', () => {
    expect(summarize('x'.repeat(400), true)).toBe(`${'x'.repeat(300)}…(400)`);
    expect(summarize({ a: { b: { c: { d: { e: 1 } } } } }, true)).toEqual({ a: { b: { c: { d: '<object>' } } } });
  });
});

describe('TurnTrace', () => {
  it('numbers events in order and logs one JSON line per event without persisting', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const trace = new TurnTrace('turn-1', 'conv-1', 'emp-1', false);
    trace.emit('turn.start', { model: 'm' });
    trace.emit('turn.end', { ok: true });
    await trace.flush();
    expect(trace.events.map((e) => [e.seq, e.stage])).toEqual([
      [1, 'turn.start'],
      [2, 'turn.end'],
    ]);
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      ai_trace: true,
      turnId: 'turn-1',
      conversationId: 'conv-1',
      seq: 1,
      stage: 'turn.start',
      model: 'm',
    });
    log.mockRestore();
  });
});
