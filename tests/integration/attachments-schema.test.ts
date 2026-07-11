import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('attachments schema + storage bucket', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  const formId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    await supabase.from('attachments').delete().eq('form_id', formId);
  });

  it('has a private attachments Storage bucket', async () => {
    const { data, error } = await supabase.storage.getBucket('attachments');
    expect(error).toBeNull();
    expect(data!.public).toBe(false);
  });

  it('inserts an attachment row', async () => {
    const { data, error } = await supabase
      .from('attachments')
      .insert({
        form_type: 'purchase_order',
        form_id: formId,
        uploaded_by_employee_id: employeeId,
        storage_path: `purchase_order/${formId}/quote.pdf`,
        file_name: 'quote.pdf',
        mime_type: 'application/pdf',
        file_size_bytes: 1024,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.file_name).toBe('quote.pdf');
  });

  it('rejects an invalid form_type', async () => {
    const { error } = await supabase.from('attachments').insert({
      form_type: 'not_a_form',
      form_id: formId,
      uploaded_by_employee_id: employeeId,
      storage_path: `not_a_form/${formId}/x.pdf`,
      file_name: 'x.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1,
    });
    expect(error).not.toBeNull();
  });

  it('rejects a duplicate storage_path', async () => {
    const { error } = await supabase.from('attachments').insert({
      form_type: 'purchase_order',
      form_id: formId,
      uploaded_by_employee_id: employeeId,
      storage_path: `purchase_order/${formId}/quote.pdf`,
      file_name: 'quote-again.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1,
    });
    expect(error).not.toBeNull();
  });
});
