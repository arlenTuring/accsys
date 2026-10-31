import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));

import type { FormFacts } from './form-facts';
import { describeEvent } from './launcher-events';

const APPLICANT = 'a';
const facts = (over: Partial<FormFacts> = {}): FormFacts => ({
  label: '公出差旅申請單',
  formNumber: '20261031BT0004',
  applicantId: APPLICANT,
  applicantName: '測試員工',
  filerId: APPLICANT,
  status: 'returned',
  what: '[測試] 高雄訪談',
  when: '2026-11-03',
  where: '高雄',
  amount: null,
  ...over,
});
const base = { nudge: false, message: '', viewerId: APPLICANT, reason: null };

describe('describeEvent', () => {
  it('a pending approval says who, what and when', () => {
    const e = describeEvent({ ...base, type: 'approval_requested', facts: facts({ status: 'pending_approval', amount: 300 }), viewerId: 'c' });
    expect(e.title).toBe('待您簽核：公出差旅申請單');
    expect(e.body).toContain('測試員工 申請');
    expect(e.body).toContain('[測試] 高雄訪談');
    expect(e.body).toContain('2026-11-03');
    expect(e.body).toContain('NT$ 300');
    expect(e.body).not.toContain('20261031BT0004');
  });

  it('a return carries the real reason and the 補件 entry for its owner', () => {
    const e = describeEvent({ ...base, type: 'request_returned', facts: facts(), reason: '缺少客戶名稱' });
    expect(e.reason).toEqual({ short: '缺少客戶名稱', full: '缺少客戶名稱', missing: false });
    expect(e.body).toContain('原因：缺少客戶名稱');
    expect(e.canResubmit).toBe(true);
  });

  it('a long reason is shortened in the body and kept in full', () => {
    const long = '請'.repeat(90);
    const e = describeEvent({ ...base, type: 'request_returned', facts: facts(), reason: long });
    expect(e.reason?.short.length).toBe(60);
    expect(e.reason?.full).toBe(long);
  });

  it('never invents a reason', () => {
    const e = describeEvent({ ...base, type: 'request_returned', facts: facts(), message: '公出差旅申請單 X 已被退回：' });
    expect(e.reason?.missing).toBe(true);
    expect(e.body).toContain('退回時未提供原因');
  });

  it('falls back to the reason recorded in the message', () => {
    const e = describeEvent({ ...base, type: 'request_returned', facts: facts(), message: '公出差旅申請單 X 已被退回：金額不符' });
    expect(e.reason?.full).toBe('金額不符');
  });

  it('a rejection is not offered as something to correct', () => {
    const e = describeEvent({ ...base, type: 'request_returned', facts: facts({ status: 'rejected' }), reason: '不予核准' });
    expect(e.kind).toBe('request_rejected');
    expect(e.title).toBe('公出差旅申請單已被拒絕');
    expect(e.canResubmit).toBe(false);
  });

  it('補件 is only for the owner of a form still returned', () => {
    expect(describeEvent({ ...base, type: 'request_returned', facts: facts({ status: 'pending_approval' }), reason: 'x' }).canResubmit).toBe(false);
    expect(describeEvent({ ...base, type: 'request_returned', facts: facts(), reason: 'x', viewerId: 'someone' }).canResubmit).toBe(false);
  });

  it('a nudge is labelled as one', () => {
    const e = describeEvent({ ...base, type: 'approval_requested', nudge: true, facts: facts({ status: 'pending_approval' }), viewerId: 'c' });
    expect(e.kind).toBe('nudge');
    expect(e.title).toBe('催簽提醒：公出差旅申請單');
  });

  it('without form access it says only what the notification said', () => {
    const e = describeEvent({ ...base, type: 'approval_requested', facts: null, message: '單據待您簽核', viewerId: 'c' });
    expect(e.body).toBe('單據待您簽核');
  });
});
