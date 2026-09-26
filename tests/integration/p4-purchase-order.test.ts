import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getSql } from '@/lib/db';
import * as po from '@/lib/purchase-orders/service';
import * as pr from '@/lib/purchase-requests/service';

const RD = '10000000-0000-0000-0000-000000000001';
const STAFF = { id: '20000000-0000-0000-0000-000000000001', departmentId: RD };
const MGR = { id: '20000000-0000-0000-0000-000000000002', departmentId: RD };
const GM = { id: '20000000-0000-0000-0000-000000000004', departmentId: '10000000-0000-0000-0000-000000000002' };
const BUDGET = '40000000-0000-0000-0000-000000000001';
const SUPPLIER = '50000000-0000-0000-0000-000000000001';

/** Approved purchase request with two lines (qty 3 and 2). */
async function approvedRequest() {
  const created = await pr.createPurchaseRequest(STAFF, {
    neededWithinDays: 7,
    items: [
      { budgetCodeId: BUDGET, description: 'A', quantity: 3, estimatedAmount: '300.00' },
      { budgetCodeId: BUDGET, description: 'B', quantity: 2, estimatedAmount: '200.00' },
    ],
    idempotencyKey: randomUUID(),
  });
  if (!created.ok) throw new Error(created.error);
  expect(await pr.approvePurchaseRequestStep(MGR, created.requestId, 1)).toEqual({ ok: true });
  expect(await pr.approvePurchaseRequestStep(GM, created.requestId, 2)).toEqual({ ok: true });
  const lines = await getSql()`select id from purchase_request_items where purchase_request_id = ${created.requestId} order by line_no`;
  return { requestId: created.requestId, lineIds: lines.map((l) => l.id as string) };
}

function orderInput(src: { requestId: string; lineIds: string[] }, prices: (number | string)[] = ['100.10', '50.05'], key = randomUUID()) {
  return {
    purchaseRequestId: src.requestId,
    supplierId: SUPPLIER,
    paymentMethod: '匯款',
    paymentTerms: '貨到付款',
    expectedDeliveryDays: 10,
    quoteCount: 1,
    quoteCountReason: null,
    items: src.lineIds.map((id, i) => ({ purchaseRequestItemId: id, unitPrice: prices[i] })),
    idempotencyKey: key,
  };
}

async function newOrder() {
  const src = await approvedRequest();
  const r = await po.createPurchaseOrder(STAFF, orderInput(src));
  if (!r.ok) throw new Error(r.error);
  return r.orderId;
}

const oks = (rs: { ok: boolean }[]) => rs.filter((r) => r.ok).length;

describe('P4b purchase orders', () => {
  it('computes line and order totals exactly from unit price x quantity', async () => {
    const id = await newOrder();
    const [row] = await getSql()`select total_amount::text as total from purchase_orders where id = ${id}`;
    const items = await getSql()`select total_price::text as t from purchase_order_items where purchase_order_id = ${id} order by line_no`;
    expect(items.map((i) => i.t)).toEqual(['300.30', '100.10']);
    expect(row.total).toBe('400.40');
  });

  it('two different creates from the same request race: exactly one order per case', async () => {
    const src = await approvedRequest();
    const results = await Promise.all([po.createPurchaseOrder(STAFF, orderInput(src)), po.createPurchaseOrder(STAFF, orderInput(src))]);
    expect(oks(results)).toBe(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: 'conflict' });
    const [{ n }] = await getSql()`select count(*)::int as n from purchase_orders where purchase_request_id = ${src.requestId}`;
    expect(n).toBe(1);
  });

  it('the same idempotency key twice at once returns the same order', async () => {
    const src = await approvedRequest();
    const input = orderInput(src);
    const [a, b] = await Promise.all([po.createPurchaseOrder(STAFF, input), po.createPurchaseOrder(STAFF, input)]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });

  it('approve / approve and approve / edit and approve / withdraw each yield one legal result', async () => {
    const a = await newOrder();
    expect(oks(await Promise.all([po.approvePurchaseOrderStep(MGR, a, 1), po.approvePurchaseOrderStep(MGR, a, 1)]))).toBe(1);

    const b = await newOrder();
    const itemIds = (await getSql()`select id from purchase_order_items where purchase_order_id = ${b} order by line_no`).map((r) => r.id as string);
    const edit = {
      supplierId: SUPPLIER,
      paymentMethod: '匯款',
      paymentTerms: '月結30天',
      expectedDeliveryDays: 5,
      quoteCount: 1,
      quoteCountReason: null,
      items: itemIds.map((id) => ({ purchaseOrderItemId: id, unitPrice: '1.00' })),
      expectedVersion: 1,
    };
    const raced = await Promise.all([po.approvePurchaseOrderStep(MGR, b, 1), po.updatePurchaseOrder(STAFF, b, edit)]);
    expect(oks(raced)).toBe(1);

    const c = await newOrder();
    expect(oks(await Promise.all([po.approvePurchaseOrderStep(MGR, c, 1), po.withdrawPurchaseOrder(STAFF, c)]))).toBe(1);
  });

  it('an edit keeps item ids (acceptances reference them) and records the previous round', async () => {
    const id = await newOrder();
    const before = (await getSql()`select id from purchase_order_items where purchase_order_id = ${id} order by line_no`).map((r) => r.id);
    const r = await po.updatePurchaseOrder(STAFF, id, {
      supplierId: SUPPLIER,
      paymentMethod: '支票',
      paymentTerms: '月結60天',
      expectedDeliveryDays: null,
      quoteCount: 1,
      quoteCountReason: null,
      items: before.map((i) => ({ purchaseOrderItemId: i as string, unitPrice: '2.50' })),
      expectedVersion: 1,
    });
    expect(r).toEqual({ ok: true });
    const after = (await getSql()`select id, total_price::text as t from purchase_order_items where purchase_order_id = ${id} order by line_no`);
    expect(after.map((x) => x.id)).toEqual(before);
    expect(after.map((x) => x.t)).toEqual(['7.50', '5.00']);
    const [audit] = await getSql()`select details from audit_events where entity_id = ${id} and action = 'purchase_order.updated'`;
    expect(audit.details.previousItems[0].totalPrice).toBe('300.30');
  });

  it('an injected failure rolls back the whole create; bad prices are rejected', async () => {
    const src = await approvedRequest();
    const failed = await po.createPurchaseOrder(STAFF, orderInput(src), {
      beforeCommit: async () => { throw new Error('injected'); },
    });
    expect(failed).toMatchObject({ ok: false, code: 'unavailable' });
    const [{ n }] = await getSql()`select count(*)::int as n from purchase_orders where purchase_request_id = ${src.requestId}`;
    expect(n).toBe(0);
    for (const bad of [['0', '1'], ['-5', '1'], ['1.234', '1'], ['999999999999.99', '1']]) {
      expect(await po.createPurchaseOrder(STAFF, orderInput(src, bad))).toMatchObject({ ok: false, code: 'validation' });
    }
    expect((await po.createPurchaseOrder(STAFF, orderInput(src))).ok).toBe(true);
  });

  it('refuses a price list that does not match the request lines (no forged lines)', async () => {
    const src = await approvedRequest();
    const forged = { ...orderInput(src), items: [{ purchaseRequestItemId: randomUUID(), unitPrice: '1.00' }] };
    expect(await po.createPurchaseOrder(STAFF, forged)).toMatchObject({ ok: false, code: 'validation' });
  });
});
