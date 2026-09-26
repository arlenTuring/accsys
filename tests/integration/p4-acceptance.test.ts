import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as acc from '@/lib/acceptances/service';
import { getSql } from '@/lib/db';
import * as po from '@/lib/purchase-orders/service';
import * as pr from '@/lib/purchase-requests/service';

const RD = '10000000-0000-0000-0000-000000000001';
const STAFF = { id: '20000000-0000-0000-0000-000000000001', departmentId: RD, role: 'staff' };
const MGR = { id: '20000000-0000-0000-0000-000000000002', departmentId: RD, role: 'staff' };
const FIN = { id: '20000000-0000-0000-0000-000000000003', role: 'finance' };
const GM = { id: '20000000-0000-0000-0000-000000000004', departmentId: '10000000-0000-0000-0000-000000000002', role: 'admin' };
const BUDGET = '40000000-0000-0000-0000-000000000001';
const SUPPLIER = '50000000-0000-0000-0000-000000000001';

/** Approved request -> approved order; returns the order and its item ids. */
async function approvedOrder() {
  const r = await pr.createPurchaseRequest(STAFF, {
    neededWithinDays: 7,
    items: [{ budgetCodeId: BUDGET, description: 'X', quantity: 2, estimatedAmount: '100.00' }],
    idempotencyKey: randomUUID(),
  });
  if (!r.ok) throw new Error(r.error);
  await pr.approvePurchaseRequestStep(MGR, r.requestId, 1);
  await pr.approvePurchaseRequestStep(GM, r.requestId, 2);
  const [line] = await getSql()`select id from purchase_request_items where purchase_request_id = ${r.requestId}`;
  const o = await po.createPurchaseOrder(STAFF, {
    purchaseRequestId: r.requestId,
    supplierId: SUPPLIER,
    paymentMethod: '匯款',
    paymentTerms: '貨到付款',
    expectedDeliveryDays: 5,
    quoteCount: 1,
    quoteCountReason: null,
    items: [{ purchaseRequestItemId: line.id, unitPrice: '45.55' }],
    idempotencyKey: randomUUID(),
  });
  if (!o.ok) throw new Error(o.error);
  await po.approvePurchaseOrderStep(MGR, o.orderId, 1);
  await po.approvePurchaseOrderStep(GM, o.orderId, 2);
  const items = await getSql()`select id from purchase_order_items where purchase_order_id = ${o.orderId}`;
  return { orderId: o.orderId, itemIds: items.map((i) => i.id as string) };
}

const input = (src: { orderId: string; itemIds: string[] }, key = randomUUID()) => ({
  purchaseOrderId: src.orderId,
  contractorSupplierId: SUPPLIER,
  acceptanceDate: '2026-09-26',
  items: src.itemIds.map((id) => ({ purchaseOrderItemId: id, passFail: 'pass' as const })),
  idempotencyKey: key,
});

const oks = (rs: { ok: boolean }[]) => rs.filter((r) => r.ok).length;

describe('P4c acceptances', () => {
  it('copies amounts from the approved order exactly', async () => {
    const src = await approvedOrder();
    const r = await acc.createAcceptance(STAFF, input(src));
    expect(r.ok).toBe(true);
    const [row] = await getSql()`select total_amount::text as t from acceptances where id = ${(r as { acceptanceId: string }).acceptanceId}`;
    expect(row.t).toBe('91.10');
  });

  it('racing creates for one order produce one acceptance; same key replays', async () => {
    const src = await approvedOrder();
    const results = await Promise.all([acc.createAcceptance(STAFF, input(src)), acc.createAcceptance(STAFF, input(src))]);
    expect(oks(results)).toBe(1);
    const src2 = await approvedOrder();
    const same = input(src2);
    const [a, b] = await Promise.all([acc.createAcceptance(STAFF, same), acc.createAcceptance(STAFF, same)]);
    expect(a).toEqual(b);
  });

  it('approve / approve and approve / withdraw each yield one result', async () => {
    const a = (await acc.createAcceptance(STAFF, input(await approvedOrder()))) as { acceptanceId: string };
    expect(oks(await Promise.all([acc.approveAcceptanceStep(MGR, a.acceptanceId, 1), acc.approveAcceptanceStep(MGR, a.acceptanceId, 1)]))).toBe(1);
    const b = (await acc.createAcceptance(STAFF, input(await approvedOrder()))) as { acceptanceId: string };
    expect(oks(await Promise.all([acc.approveAcceptanceStep(MGR, b.acceptanceId, 1), acc.withdrawAcceptance(STAFF, b.acceptanceId)]))).toBe(1);
  });

  it('rejects invalid dates and forged results; rolls back an injected failure', async () => {
    const src = await approvedOrder();
    expect(await acc.createAcceptance(STAFF, { ...input(src), acceptanceDate: '2026-13-45' })).toMatchObject({ code: 'validation' });
    expect(
      await acc.createAcceptance(STAFF, { ...input(src), items: [{ purchaseOrderItemId: src.itemIds[0], passFail: 'maybe' as never }] })
    ).toMatchObject({ code: 'validation' });
    const failed = await acc.createAcceptance(STAFF, input(src), { beforeCommit: async () => { throw new Error('x'); } });
    expect(failed).toMatchObject({ code: 'unavailable' });
    const [{ n }] = await getSql()`select count(*)::int as n from acceptances where purchase_order_id = ${src.orderId}`;
    expect(n).toBe(0);
  });

  it('property tags: finance only, only after approval, audited', async () => {
    const a = (await acc.createAcceptance(STAFF, input(await approvedOrder()))) as { acceptanceId: string };
    const [item] = await getSql()`select id from acceptance_items where acceptance_id = ${a.acceptanceId}`;
    expect(await acc.updateAcceptanceItemPropertyTag(FIN, item.id, 'P-1')).toMatchObject({ code: 'conflict' });
    await acc.approveAcceptanceStep(MGR, a.acceptanceId, 1);
    await acc.approveAcceptanceStep(GM, a.acceptanceId, 2);
    expect(await acc.updateAcceptanceItemPropertyTag(STAFF, item.id, 'P-1')).toMatchObject({ code: 'forbidden' });
    expect(await acc.updateAcceptanceItemPropertyTag(FIN, item.id, 'P-1')).toEqual({ ok: true });
    const [audit] = await getSql()`select details from audit_events where entity_id = ${a.acceptanceId} and action = 'acceptance.property_tag_set'`;
    expect(audit.details).toMatchObject({ from: null, to: 'P-1' });
  });
});
