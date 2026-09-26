import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createServiceRoleTestClient,
} from './supabase-test-client';

const currentEmployee = vi.hoisted(() => ({
  value: null as null | { id: string; role: string },
}));
vi.mock('@/lib/auth/current-employee', () => ({
  getCurrentEmployee: async () => currentEmployee.value,
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

describe('attachments actions', () => {
  let admin: ReturnType<typeof createServiceRoleTestClient>;
  let applicantId: string;
  let outsiderId: string;
  let caseId: string;
  let requestId: string;
  let orderId: string;
  const createdStoragePaths: string[] = [];

  beforeAll(async () => {
    admin = createServiceRoleTestClient();
    const { data: emps } = await admin
      .from('employees')
      .select('id, department_id')
      .limit(2);
    applicantId = emps![0].id;
    outsiderId = emps![1].id;
    const { data: sup } = await admin.from('suppliers').select('id').limit(1).single();
    const { data: caseNumber } = await admin.rpc('next_case_number');
    const { data: pcase } = await admin
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: applicantId })
      .select()
      .single();
    caseId = pcase!.id;
    // purchase_orders.purchase_request_id is NOT NULL in the live schema, so a
    // purchase_request must exist first (mirrors tests/integration/purchase-orders-schema.test.ts).
    const { data: pr } = await admin
      .from('purchase_requests')
      .insert({
        procurement_case_id: caseId,
        applicant_employee_id: applicantId,
        department_id: emps![0].department_id,
        budget_owner_employee_id: applicantId,
        status: 'approved',
      })
      .select()
      .single();
    requestId = pr!.id;
    const { data: po } = await admin
      .from('purchase_orders')
      .insert({
        procurement_case_id: caseId,
        purchase_request_id: requestId,
        applicant_employee_id: applicantId,
        department_id: emps![0].department_id,
        budget_owner_employee_id: applicantId,
        supplier_id: sup!.id,
        payment_method: '匯款',
        payment_terms: '貨到付款',
      })
      .select()
      .single();
    orderId = po!.id;
  });

  afterEach(() => {
    currentEmployee.value = null;
  });

  afterAll(async () => {
    const storageRoot = process.env.STORAGE_LOCAL_PATH!;
    for (const storagePath of createdStoragePaths) {
      await rm(path.join(storageRoot, storagePath), { force: true });
    }
    await admin.from('attachments').delete().eq('form_id', orderId);
    await admin.from('purchase_orders').delete().eq('id', orderId);
    await admin.from('purchase_requests').delete().eq('id', requestId);
    await admin.from('procurement_cases').delete().eq('id', caseId);
  });

  it('rejects an upload from a non-participant employee', async () => {
    currentEmployee.value = { id: outsiderId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    formData.set(
      'file',
      new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'quote.pdf', { type: 'application/pdf' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result).toEqual({ ok: false, error: '您沒有權限為此表單上傳附件' });
  });

  it('rejects an unsupported file type', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    formData.set(
      'file',
      new File([new Uint8Array([1])], 'malware.exe', { type: 'application/x-msdownload' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result).toEqual({ ok: false, error: '僅接受 PDF、PNG、JPEG 檔案（以檔案內容判斷）' });
  });

  it('uploads a file, records it, and returns a download URL to a participant', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment, getAttachmentDownloadUrl } = await import(
      '@/lib/attachments/actions'
    );
    const formData = new FormData();
    formData.set(
      'file',
      new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'quote.pdf', { type: 'application/pdf' })
    );
    const result = await uploadAttachment('purchase_order', orderId, formData);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data: row } = await admin
      .from('attachments')
      .select('storage_path')
      .eq('id', result.attachmentId)
      .single();
    createdStoragePaths.push(row!.storage_path);

    // Authorized by attachment id (no storage path in the URL); the route re-checks access.
    const url = await getAttachmentDownloadUrl(result.attachmentId);
    expect(url).toBe(`/api/attachments/${result.attachmentId}`);
  });

  it('rejects a download for a non-participant employee', async () => {
    currentEmployee.value = { id: applicantId, role: 'staff' };
    const { uploadAttachment } = await import('@/lib/attachments/actions');
    const formData = new FormData();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    formData.set('file', new File([png], 'x.png', { type: 'image/png' }));
    const uploadResult = await uploadAttachment('purchase_order', orderId, formData);
    if (!uploadResult.ok) throw new Error('setup failed');
    const { data: row } = await admin
      .from('attachments')
      .select('storage_path')
      .eq('id', uploadResult.attachmentId)
      .single();
    createdStoragePaths.push(row!.storage_path);

    currentEmployee.value = { id: outsiderId, role: 'staff' };
    const { getAttachmentDownloadUrl } = await import('@/lib/attachments/actions');
    const url = await getAttachmentDownloadUrl(uploadResult.attachmentId);
    expect(url).toBeNull();
  });
});
