import { randomUUID } from 'node:crypto';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSession } from '@/lib/auth/sessions';
import { getDb, getSql } from '@/lib/db';
import { attachments, employees } from '@/lib/db/schema';

// Real sessions: server code reads the cookie through next/headers.
const jar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === '__Host-accsys_sid' && jar.token ? { name, value: jar.token } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const RD = '10000000-0000-0000-0000-000000000001';
const SUPPLIER = '50000000-0000-0000-0000-000000000001';
const BUDGET = '40000000-0000-0000-0000-000000000001';

type Person = { id: string; token: string; role: string };

async function person(role: 'staff' | 'finance' | 'admin' = 'staff'): Promise<Person> {
  const code = `Z-${randomUUID().slice(0, 8)}`;
  const [emp] = await getDb()
    .insert(employees)
    .values({ employeeCode: code, name: code, departmentId: RD, googleEmail: `${code.toLowerCase()}@example.test`, role })
    .returning();
  const { token } = await createSession(getDb(), { employeeId: emp.id, identityId: null, ttlMs: 3600_000 });
  return { id: emp.id, token, role };
}

function as(p: Person | null) {
  jar.token = p?.token;
}

/** A full case: approved PR -> approved PO -> acceptance -> expense (pending, step 1 = approver). */
async function makeCase(applicant: Person, approver: Person) {
  const q = getSql();
  const [{ case_number }] = await q`select next_case_number() as case_number`;
  const [pcase] = await q`insert into procurement_cases (case_number, created_by_employee_id) values (${case_number}, ${applicant.id}) returning id`;
  const [pr] = await q`
    insert into purchase_requests (procurement_case_id, applicant_employee_id, department_id, budget_owner_employee_id, total_amount, status)
    values (${pcase.id}, ${applicant.id}, ${RD}, ${approver.id}, 1000, 'approved') returning id`;
  await q`insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role, status)
          values ('purchase_request', ${pr.id}, 1, ${approver.id}, 'department_manager', 'approved')`;
  const [po] = await q`
    insert into purchase_orders (procurement_case_id, purchase_request_id, applicant_employee_id, department_id, budget_owner_employee_id,
                                 supplier_id, payment_method, payment_terms, total_amount, status)
    values (${pcase.id}, ${pr.id}, ${applicant.id}, ${RD}, ${approver.id}, ${SUPPLIER}, '匯款', '貨到付款', 1000, 'approved') returning id`;
  const [poItem] = await q`
    insert into purchase_order_items (purchase_order_id, line_no, budget_code_id, item_category, description, quantity, unit_price, total_price)
    values (${po.id}, 1, ${BUDGET}, '設備', '測試', 1, 1000, 1000) returning id`;
  const [er] = await q`
    insert into expense_requests (procurement_case_id, purchase_order_id, applicant_employee_id, department_id, budget_owner_employee_id,
                                  payee_type, payee_supplier_id, payment_method, bank_name, bank_account, account_name, total_amount,
                                  status, current_step_order)
    values (${pcase.id}, ${po.id}, ${applicant.id}, ${RD}, ${approver.id}, 'supplier', ${SUPPLIER}, '匯款', '測試銀行',
            '012-3456789-01234', '測試供應商', 1000, 'pending_approval', 1) returning id`;
  await q`insert into expense_request_items (expense_request_id, line_no, purchase_order_item_id, description, amount)
          values (${er.id}, 1, ${poItem.id}, '測試', 1000)`;
  await q`insert into approval_steps (form_type, form_id, step_order, approver_employee_id, approver_role)
          values ('expense_request', ${er.id}, 1, ${approver.id}, 'department_manager')`;
  return { caseNumber: case_number as string, prId: pr.id as string, poId: po.id as string, erId: er.id as string };
}

let applicant: Person;
let approver: Person;
let outsider: Person;
let finance: Person;
let admin: Person;
let kase: Awaited<ReturnType<typeof makeCase>>;

beforeAll(async () => {
  [applicant, approver, outsider, finance, admin] = await Promise.all([
    person('staff'),
    person('staff'),
    person('staff'),
    person('finance'),
    person('admin'),
  ]);
  kase = await makeCase(applicant, approver);
});

beforeEach(() => as(null));

describe('form detail pages: only participants, finance and admin', () => {
  const load = async () => {
    const [{ getPurchaseRequestDetail }, { getPurchaseOrderDetail }, { getExpenseRequestDetail }] = await Promise.all([
      import('@/lib/purchase-requests/queries'),
      import('@/lib/purchase-orders/queries'),
      import('@/lib/expense-requests/queries'),
    ]);
    return {
      pr: await getPurchaseRequestDetail(kase.prId),
      po: await getPurchaseOrderDetail(kase.poId),
      er: await getExpenseRequestDetail(kase.erId),
    };
  };

  it.each([
    ['the applicant', () => applicant],
    ['an approver on the form', () => approver],
    ['finance', () => finance],
    ['admin', () => admin],
  ])('%s can read', async (_label, who) => {
    as(who());
    const { pr, er } = await load();
    expect(pr?.id).toBe(kase.prId);
    expect(er?.id).toBe(kase.erId);
  });

  it('an unrelated employee gets "not found" for every form (direct URL / guessed id)', async () => {
    as(outsider);
    expect(await load()).toEqual({ pr: null, po: null, er: null });
  });

  it('no session gets nothing', async () => {
    expect(await load()).toEqual({ pr: null, po: null, er: null });
  });

  it('malformed ids are treated as not found', async () => {
    as(admin);
    const { getPurchaseRequestDetail } = await import('@/lib/purchase-requests/queries');
    expect(await getPurchaseRequestDetail("x' or '1'='1")).toBeNull();
  });

  it('shows the full bank account only to the applicant and finance; approvers see the last 4 digits', async () => {
    const { getExpenseRequestDetail } = await import('@/lib/expense-requests/queries');
    as(applicant);
    expect((await getExpenseRequestDetail(kase.erId))?.bankAccount).toBe('012-3456789-01234');
    as(finance);
    expect((await getExpenseRequestDetail(kase.erId))?.bankAccount).toBe('012-3456789-01234');
    as(approver);
    expect((await getExpenseRequestDetail(kase.erId))?.bankAccount).toBe('****1234');
  });
});

describe('case overview and company-wide views', () => {
  it('hides the whole case from non-participants', async () => {
    const { getCaseOverview } = await import('@/lib/cases/queries');
    as(outsider);
    expect(await getCaseOverview(kase.caseNumber)).toBeNull();
  });

  it('shows forms the caller cannot open as restricted, without id or status', async () => {
    const other = await person('staff');
    const second = await makeCase(applicant, other);
    // `other` approves only the expense request of this case.
    await getSql()`delete from approval_steps where form_type = 'purchase_request' and form_id = ${second.prId}`;
    const { getCaseOverview } = await import('@/lib/cases/queries');
    as(other);
    const overview = await getCaseOverview(second.caseNumber);
    const byType = Object.fromEntries(overview!.forms.map((f) => [f.formType, f]));
    expect(byType.expense_request).toMatchObject({ restricted: false, id: second.erId });
    expect(byType.purchase_order).toMatchObject({ exists: true, restricted: true, id: null, status: null });
  });

  it('finance tracking returns nothing for staff even if called directly', async () => {
    const { getFinanceCaseTracking } = await import('@/lib/case-tracking/queries');
    as(outsider);
    expect(await getFinanceCaseTracking({})).toEqual([]);
    as(finance);
    expect((await getFinanceCaseTracking({})).length).toBeGreaterThan(0);
  });

  it('budget amounts are visible to finance only', async () => {
    const { getBudgetCodeList } = await import('@/lib/budget-codes/queries');
    as(outsider);
    const staffView = await getBudgetCodeList();
    expect(staffView.length).toBeGreaterThan(0);
    expect(staffView.every((b) => b.annualBudgetAmount === null)).toBe(true);
    as(finance);
    expect((await getBudgetCodeList()).some((b) => b.annualBudgetAmount !== null)).toBe(true);
  });
});

describe('actions refuse forged or foreign inputs', () => {
  it('cannot create a purchase order from someone else\'s approved request', async () => {
    const fresh = await makeCase(applicant, approver);
    await getSql()`delete from expense_request_items where expense_request_id = ${fresh.erId}`;
    await getSql()`delete from approval_steps where form_id = ${fresh.erId}`;
    await getSql()`delete from expense_requests where id = ${fresh.erId}`;
    await getSql()`delete from purchase_order_items where purchase_order_id = ${fresh.poId}`;
    await getSql()`delete from purchase_orders where id = ${fresh.poId}`;
    const { createPurchaseOrder } = await import('@/lib/purchase-orders/actions');
    as(outsider);
    const result = await createPurchaseOrder({ idempotencyKey: crypto.randomUUID(),
      purchaseRequestId: fresh.prId,
      supplierId: SUPPLIER,
      paymentMethod: '匯款',
      paymentTerms: '貨到付款',
      expectedDeliveryDays: 7,
      quoteCount: 1,
      quoteCountReason: '',
      items: [{ lineNo: 1, budgetCodeId: BUDGET, itemCategory: '設備', description: 'x', quantity: 1, unitPrice: 100 }],
    } as never);
    expect(result).toMatchObject({ ok: false, error: '找不到來源請購單' });
  });

  it('only the current step approver can approve; admin does not bypass', async () => {
    const { approveExpenseRequestStep } = await import('@/lib/expense-requests/actions');
    for (const who of [outsider, admin, finance, applicant]) {
      as(who);
      const result = await approveExpenseRequestStep(kase.erId);
      expect(result.ok).toBe(false);
    }
    const [{ status }] = await getSql()`select status from expense_requests where id = ${kase.erId}`;
    expect(status).toBe('pending_approval');
  });

  it('cannot withdraw someone else\'s form', async () => {
    const { withdrawExpenseRequest } = await import('@/lib/expense-requests/actions');
    as(approver);
    expect((await withdrawExpenseRequest(kase.erId)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const pdfFile = (name = 'quote.pdf', bytes: Uint8Array = PDF, type = 'application/pdf') =>
  new File([bytes as BlobPart], name, { type });

/** Minimal clamd speaking INSTREAM; verdict chosen per test. */
function fakeClamd(verdict: 'clean' | 'infected' | 'hang'): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let received = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk]);
        if (verdict === 'hang') return;
        if (received.subarray(-4).equals(Buffer.alloc(4))) {
          socket.end(verdict === 'clean' ? 'stream: OK\0' : 'stream: Eicar-Test-Signature FOUND\0');
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() });
    });
  });
}

describe('attachments', () => {
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'accsys-authz-attachments-'));
    process.env.STORAGE_LOCAL_PATH = root;
    const { __resetStorageRootForTests } = await import('@/lib/attachments/storage');
    __resetStorageRootForTests();
  });

  afterAll(() => {
    delete process.env.ATTACHMENT_SCAN;
  });

  async function upload(who: Person | null, file: File, formType = 'expense_request', formId = kase.erId) {
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    as(who);
    const fd = new FormData();
    fd.set('file', file);
    return uploadAttachment(formType, formId, fd);
  }

  async function download(who: Person | null, id: string) {
    const { GET } = await import('@/app/api/attachments/[id]/route');
    as(who);
    return GET(new Request(`https://accsys.test/api/attachments/${id}`), { params: Promise.resolve({ id }) });
  }

  it('non-participants cannot upload; participants can (dev without scanner = unscanned)', async () => {
    delete process.env.ATTACHMENT_SCAN;
    expect(await upload(outsider, pdfFile())).toMatchObject({ ok: false, error: '您沒有權限為此表單上傳附件' });
    const ok = await upload(approver, pdfFile());
    expect(ok).toMatchObject({ ok: true, scanStatus: 'unscanned' });
  });

  it('stores a server-generated key; a traversal file name is only a display name', async () => {
    const result = await upload(applicant, pdfFile('../../../../etc/cron.d/evil.pdf'));
    expect(result.ok).toBe(true);
    const [row] = await getDb().select().from(attachments).where(eq(attachments.id, (result as { attachmentId: string }).attachmentId));
    expect(row.fileName).toBe('evil.pdf');
    expect(row.storagePath).toMatch(/^expense_request\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const written = await stat(path.join(root, row.storagePath));
    expect(written.isFile()).toBe(true);
  });

  it.each([
    ['HTML disguised as PDF', pdfFile('x.pdf', new TextEncoder().encode('<html><script>alert(1)</script>'))],
    ['SVG', pdfFile('x.svg', new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml')],
    ['an empty file', pdfFile('x.pdf', new Uint8Array())],
    ['a file over 10 MB', pdfFile('x.pdf', new Uint8Array(10 * 1024 * 1024 + 1))],
  ])('rejects %s', async (_label, file) => {
    const result = await upload(applicant, file);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown form type even for admin (no path injection through formType)', async () => {
    expect((await upload(admin, pdfFile(), '../../tmp', kase.erId)).ok).toBe(false);
  });

  it('serves a readable attachment only to people who can read the form, as a download', async () => {
    const result = (await upload(applicant, pdfFile('報價單.pdf'))) as { attachmentId: string };
    const ok = await download(approver, result.attachmentId);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-security-policy')).toContain('sandbox');
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect((await download(outsider, result.attachmentId)).status).toBe(404);
    expect((await download(null, result.attachmentId)).status).toBe(404);
    expect((await download(approver, randomUUID())).status).toBe(404);
  });

  it('refuses to follow a symlink or a traversal key planted in the database', async () => {
    const id = randomUUID();
    const dir = path.join(root, 'expense_request', kase.erId);
    await mkdir(dir, { recursive: true });
    symlinkSync('/etc/hosts', path.join(dir, 'planted'));
    await getDb().insert(attachments).values({
      id,
      formType: 'expense_request',
      formId: kase.erId,
      uploadedByEmployeeId: applicant.id,
      storagePath: `expense_request/${kase.erId}/planted`,
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 10,
      scanStatus: 'clean',
    });
    expect((await download(applicant, id)).status).toBe(404);

    const id2 = randomUUID();
    await getDb().insert(attachments).values({
      id: id2,
      formType: 'expense_request',
      formId: kase.erId,
      uploadedByEmployeeId: applicant.id,
      storagePath: `expense_request/../../../../etc/hosts`,
      fileName: 'y.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 10,
      scanStatus: 'clean',
    });
    expect((await download(applicant, id2)).status).toBe(404);
  });

  it('with a scanner: clean files are served, infected files are deleted and never served', async () => {
    const clean = await fakeClamd('clean');
    Object.assign(process.env, { ATTACHMENT_SCAN: 'clamav', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(clean.port) });
    const ok = (await upload(applicant, pdfFile())) as { ok: boolean; attachmentId: string; scanStatus: string };
    clean.close();
    expect(ok).toMatchObject({ ok: true, scanStatus: 'clean' });
    expect((await download(applicant, ok.attachmentId)).status).toBe(200);

    const bad = await fakeClamd('infected');
    process.env.CLAMAV_PORT = String(bad.port);
    const infected = await upload(applicant, pdfFile('eicar.pdf'));
    bad.close();
    expect(infected).toMatchObject({ ok: false, error: '檔案未通過安全掃描，已拒絕' });
    const [row] = await getDb().select().from(attachments).where(sql`${attachments.fileName} = 'eicar.pdf'`);
    expect(row.scanStatus).toBe('infected');
    expect((await download(applicant, row.id)).status).toBe(409);
    expect(await readdir(path.join(root, '.quarantine'))).not.toContain(row.id);
  });

  it('a scanner timeout/outage never marks a file safe; the rescan job clears it later', async () => {
    const down = await fakeClamd('clean');
    down.close(); // nothing listening -> connection refused
    Object.assign(process.env, { ATTACHMENT_SCAN: 'clamav', CLAMAV_PORT: String(down.port) });
    const failed = await upload(applicant, pdfFile('later.pdf'));
    expect(failed.ok).toBe(false);
    const [row] = await getDb().select().from(attachments).where(sql`${attachments.fileName} = 'later.pdf'`);
    expect(row.scanStatus).toBe('scan_failed');
    expect((await download(applicant, row.id)).status).toBe(409);

    await getSql()`update attachments set created_at = now() - interval '5 minutes' where id = ${row.id}`;
    const clean = await fakeClamd('clean');
    process.env.CLAMAV_PORT = String(clean.port);
    const { rescanAttachments } = await import('@/lib/attachments/rescan');
    const summary = await rescanAttachments();
    clean.close();
    expect(summary.clean).toBeGreaterThanOrEqual(1);
    expect((await download(applicant, row.id)).status).toBe(200);
  });

  it('production never serves unscanned files and refuses uploads without a scanner', async () => {
    const { isServable } = await import('@/lib/attachments/service');
    expect(isServable('unscanned', { NODE_ENV: 'production' })).toBe(false);
    expect(isServable('clean', { NODE_ENV: 'production' })).toBe(true);
    const { scannerConfig } = await import('@/lib/attachments/scan');
    expect(() => scannerConfig({ NODE_ENV: 'production' })).toThrow();
    expect(() => scannerConfig({ NODE_ENV: 'production', ATTACHMENT_SCAN: 'disabled' })).toThrow();
  });
});
