import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getSql } from '@/lib/db';
import * as svc from '@/lib/purchase-requests/service';

// Service-level tests: every call runs its own transaction on its own pooled
// connection, so Promise.all([...]) races two real database sessions.

const RD = '10000000-0000-0000-0000-000000000001';
const STAFF = { id: '20000000-0000-0000-0000-000000000001', departmentId: RD };
const MGR = { id: '20000000-0000-0000-0000-000000000002', departmentId: RD };
const GM = { id: '20000000-0000-0000-0000-000000000004', departmentId: '10000000-0000-0000-0000-000000000002' };
const BUDGET = '40000000-0000-0000-0000-000000000001';

const item = (amount: number | string = '1000.00') => ({ budgetCodeId: BUDGET, description: '測試', quantity: 1, estimatedAmount: amount });

async function create(amount: number | string = '1000.00') {
  const r = await svc.createPurchaseRequest(STAFF, { neededWithinDays: 7, items: [item(amount)], idempotencyKey: randomUUID() });
  if (!r.ok) throw new Error(r.error);
  return r.requestId;
}

async function state(id: string) {
  const q = getSql();
  const [pr] = await q`select status, current_step_order, version, total_amount::text as total from purchase_requests where id = ${id}`;
  const steps = await q`select step_order, status from approval_steps where form_type = 'purchase_request' and form_id = ${id} order by step_order`;
  const notes = await q`select type, recipient_employee_id from notifications where form_type = 'purchase_request' and form_id = ${id}`;
  const audit = await q`select action, details from audit_events where entity_type = 'purchase_request' and entity_id = ${id} order by id`;
  return { pr, steps, notes, audit };
}

const oks = (results: { ok: boolean }[]) => results.filter((r) => r.ok).length;

describe('P4a purchase requests: concurrency with two database sessions', () => {
  it('approve / approve by the same approver: one wins, one notification for the next step', async () => {
    const id = await create();
    const results = await Promise.all([
      svc.approvePurchaseRequestStep(MGR, id, 1),
      svc.approvePurchaseRequestStep(MGR, id, 1),
    ]);
    expect(oks(results)).toBe(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: 'conflict' });
    const s = await state(id);
    expect(s.pr).toMatchObject({ status: 'pending_approval', current_step_order: 2, version: 2 });
    expect(s.steps.map((x) => x.status)).toEqual(['approved', 'pending']);
    expect(s.notes.filter((n) => n.recipient_employee_id === GM.id)).toHaveLength(1);
    expect(s.audit.filter((a) => a.action === 'purchase_request.step_approved')).toHaveLength(1);
  });

  it('approve / return at the same time: exactly one decision is recorded', async () => {
    const id = await create();
    const results = await Promise.all([
      svc.approvePurchaseRequestStep(MGR, id, 1),
      svc.returnPurchaseRequestStep(MGR, id, '請補資料', 1),
    ]);
    expect(oks(results)).toBe(1);
    const s = await state(id);
    const decided = s.steps.filter((x) => x.status !== 'pending');
    expect(decided).toHaveLength(1);
    expect(['returned', 'pending_approval']).toContain(s.pr.status);
  });

  it('approve / edit at the same time: one legal result, never an approval of unseen content', async () => {
    const id = await create();
    const results = await Promise.all([
      svc.approvePurchaseRequestStep(MGR, id, 1),
      svc.updatePurchaseRequest(STAFF, id, { neededWithinDays: 14, items: [item('2000.00')], expectedVersion: 1 }),
    ]);
    expect(oks(results)).toBe(1);
    const s = await state(id);
    if (results[0].ok) {
      expect(s.pr).toMatchObject({ total: '1000.00', current_step_order: 2 });
    } else {
      expect(s.pr).toMatchObject({ total: '2000.00', current_step_order: 1 });
      expect(s.steps.every((x) => x.status === 'pending')).toBe(true);
    }
  });

  it('approve / withdraw at the same time: exactly one succeeds', async () => {
    const id = await create();
    const results = await Promise.all([
      svc.approvePurchaseRequestStep(MGR, id, 1),
      svc.withdrawPurchaseRequest(STAFF, id),
    ]);
    expect(oks(results)).toBe(1);
    const s = await state(id);
    if (results[1].ok) expect(s.pr.status).toBe('withdrawn');
    else expect(s.pr.current_step_order).toBe(2);
  });

  it('duplicate create with the same key returns the same request once; a different payload is refused', async () => {
    const key = randomUUID();
    const input = { neededWithinDays: 7, items: [item('500.00')], idempotencyKey: key };
    const [a, b] = await Promise.all([svc.createPurchaseRequest(STAFF, input), svc.createPurchaseRequest(STAFF, input)]);
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && b.ok && a.requestId === b.requestId).toBe(true);
    const again = await svc.createPurchaseRequest(STAFF, input);
    expect(again).toEqual(a);
    const different = await svc.createPurchaseRequest(STAFF, { ...input, items: [item('600.00')] });
    expect(different).toMatchObject({ ok: false, code: 'conflict' });
    const [{ n }] = await getSql()`select count(*)::int as n from purchase_requests where id = ${(a as { requestId: string }).requestId}`;
    expect(n).toBe(1);
  });

  it('refuses a create without an idempotency key', async () => {
    const r = await svc.createPurchaseRequest(STAFF, { neededWithinDays: 7, items: [item()], idempotencyKey: '' });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
  });
});

describe('P4a purchase requests: rollback, stale edits, money, history', () => {
  it('a failure just before commit leaves nothing behind (case, form, items, steps, notifications, audit, key)', async () => {
    const q = getSql();
    const before = await q`select
      (select count(*) from procurement_cases)::int as cases,
      (select count(*) from purchase_requests)::int as prs,
      (select count(*) from purchase_request_items)::int as items,
      (select count(*) from approval_steps)::int as steps,
      (select count(*) from notifications)::int as notes,
      (select count(*) from audit_events)::int as audit,
      (select count(*) from idempotency_keys)::int as keys`;
    const r = await svc.createPurchaseRequest(
      STAFF,
      { neededWithinDays: 7, items: [item()], idempotencyKey: randomUUID() },
      { beforeCommit: async () => { throw new Error('injected failure'); } }
    );
    expect(r).toMatchObject({ ok: false, code: 'unavailable' });
    expect((r as { error: string }).error).toContain('參考碼');
    const after = await q`select
      (select count(*) from procurement_cases)::int as cases,
      (select count(*) from purchase_requests)::int as prs,
      (select count(*) from purchase_request_items)::int as items,
      (select count(*) from approval_steps)::int as steps,
      (select count(*) from notifications)::int as notes,
      (select count(*) from audit_events)::int as audit,
      (select count(*) from idempotency_keys)::int as keys`;
    expect(after).toEqual(before);
  });

  it('a failed approval rolls back the step, the header and the notification together', async () => {
    const id = await create();
    const r = await svc.approvePurchaseRequestStep(MGR, id, 1, {
      beforeCommit: async () => { throw new Error('injected failure'); },
    });
    expect(r).toMatchObject({ ok: false, code: 'unavailable' });
    const s = await state(id);
    expect(s.pr).toMatchObject({ current_step_order: 1, version: 1 });
    expect(s.steps.map((x) => x.status)).toEqual(['pending', 'pending']);
    expect(s.notes.filter((n) => n.recipient_employee_id === GM.id)).toHaveLength(0);
  });

  it('a stale edit is refused instead of overwriting newer data', async () => {
    const id = await create();
    expect((await svc.updatePurchaseRequest(STAFF, id, { neededWithinDays: 1, items: [item('1500.00')], expectedVersion: 1 })).ok).toBe(true);
    const stale = await svc.updatePurchaseRequest(STAFF, id, { neededWithinDays: 2, items: [item('9.99')], expectedVersion: 1 });
    expect(stale).toMatchObject({ ok: false, code: 'conflict' });
    expect((await state(id)).pr.total).toBe('1500.00');
    // An approver looking at the old version must reload too.
    expect(await svc.approvePurchaseRequestStep(MGR, id, 1)).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('sums money exactly and rejects bad amounts', async () => {
    const r = await svc.createPurchaseRequest(STAFF, {
      neededWithinDays: 7,
      items: [item(0.1), item(0.2), item('1234.56')],
      idempotencyKey: randomUUID(),
    });
    expect(r.ok).toBe(true);
    expect((await state((r as { requestId: string }).requestId)).pr.total).toBe('1234.86');
    for (const bad of [0, -1, '12.345', 'abc', 1e13, '1000000000000.00']) {
      const res = await svc.createPurchaseRequest(STAFF, { neededWithinDays: 7, items: [item(bad)], idempotencyKey: randomUUID() });
      expect(res).toMatchObject({ ok: false, code: 'validation' });
    }
  });

  it('keeps the previous round in the audit trail when an edit rebuilds the steps', async () => {
    const id = await create('3000.00');
    await svc.updatePurchaseRequest(STAFF, id, { neededWithinDays: 3, items: [item('3100.00')], expectedVersion: 1 });
    const s = await state(id);
    const updated = s.audit.find((a) => a.action === 'purchase_request.updated');
    expect(updated!.details.previousVersion).toBe(1);
    expect(updated!.details.previousSteps).toHaveLength(2);
    expect(updated!.details.previousItems[0].estimatedAmount).toBe('3000.00');
    expect(s.audit.map((a) => a.action)).toEqual(['purchase_request.created', 'purchase_request.updated']);
  });

  it('only the current approver decides; admin role alone does not bypass', async () => {
    const id = await create();
    const r = await svc.approvePurchaseRequestStep(GM, id, 1);
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
