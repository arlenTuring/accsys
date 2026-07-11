import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('approval_steps + notifications schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  let employeeId: string;
  const formId = crypto.randomUUID();

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    await supabase.from('approval_steps').delete().eq('form_id', formId);
    await supabase.from('notifications').delete().eq('form_id', formId);
  });

  it('inserts an approval step with default status pending', async () => {
    const { data, error } = await supabase
      .from('approval_steps')
      .insert({
        form_type: 'purchase_request',
        form_id: formId,
        step_order: 1,
        approver_employee_id: employeeId,
        approver_role: 'department_manager',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe('pending');
  });

  it('enforces unique (form_type, form_id, step_order)', async () => {
    const { error } = await supabase.from('approval_steps').insert({
      form_type: 'purchase_request',
      form_id: formId,
      step_order: 1,
      approver_employee_id: employeeId,
      approver_role: 'budget_owner',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid form_type', async () => {
    const { error } = await supabase.from('approval_steps').insert({
      form_type: 'not_a_form',
      form_id: formId,
      step_order: 9,
      approver_employee_id: employeeId,
      approver_role: 'budget_owner',
    });
    expect(error).not.toBeNull();
  });

  it('inserts a notification with default is_read false', async () => {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        recipient_employee_id: employeeId,
        type: 'approval_requested',
        form_type: 'purchase_request',
        form_id: formId,
        case_number: 'CP115070001',
        message: '有一張請購單待您簽核',
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.is_read).toBe(false);
  });
});
