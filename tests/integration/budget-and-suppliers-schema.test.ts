import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('budget_codes and suppliers schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  const departmentCode = `TEST-BC-${Date.now()}`;
  let departmentId: string;
  let employeeId: string;

  beforeAll(() => {
    supabase = createServiceRoleTestClient();
  });

  afterAll(async () => {
    await supabase.from('budget_codes').delete().eq('department_id', departmentId);
    await supabase.from('employees').delete().eq('id', employeeId);
    await supabase.from('departments').delete().eq('id', departmentId);
    await supabase.from('suppliers').delete().eq('name', '測試供應商');
  });

  it('inserts a budget code referencing a department and owner employee', async () => {
    const { data: dept } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '測試預算部門' })
      .select()
      .single();
    departmentId = dept!.id;

    const { data: employee } = await supabase
      .from('employees')
      .insert({
        employee_code: `BC-EMP-${Date.now()}`,
        name: '測試預算負責人',
        department_id: departmentId,
        google_email: `bc-owner-${Date.now()}@turingdrive.ai`,
      })
      .select()
      .single();
    employeeId = employee!.id;

    const { data, error } = await supabase
      .from('budget_codes')
      .insert({
        code: `115TEST${Date.now()}`,
        department_id: departmentId,
        category: '材料',
        owner_employee_id: employeeId,
        fiscal_year: '115',
        annual_budget_amount: 100000,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.category).toBe('材料');
  });

  it('inserts a supplier with only a name and rejects a duplicate name', async () => {
    const { error: firstError } = await supabase
      .from('suppliers')
      .insert({ name: '測試供應商' });
    expect(firstError).toBeNull();

    const { error: duplicateError } = await supabase
      .from('suppliers')
      .insert({ name: '測試供應商' });
    expect(duplicateError).not.toBeNull();
  });
});
