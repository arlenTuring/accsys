import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('departments and employees schema', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  const departmentCode = `TEST-${Date.now()}`;
  let departmentId: string;

  beforeAll(() => {
    supabase = createServiceRoleTestClient();
  });

  afterAll(async () => {
    await supabase.from('employees').delete().eq('department_id', departmentId);
    await supabase.from('departments').delete().eq('id', departmentId);
  });

  it('inserts a department and reads it back', async () => {
    const { data, error } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '測試部門' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.code).toBe(departmentCode);
    departmentId = data!.id;
  });

  it('rejects a duplicate department code', async () => {
    const { error } = await supabase
      .from('departments')
      .insert({ code: departmentCode, name: '重複部門' });

    expect(error).not.toBeNull();
  });

  it('inserts an employee linked to the department with default role staff', async () => {
    const { data, error } = await supabase
      .from('employees')
      .insert({
        employee_code: `EMP-${Date.now()}`,
        name: '測試員工',
        department_id: departmentId,
        google_email: `test-${Date.now()}@turingdrive.ai`,
      })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.role).toBe('staff');
    expect(data?.is_general_manager).toBe(false);
    expect(data?.is_chairman).toBe(false);
  });

  it('rejects an employee with an invalid role', async () => {
    const { error } = await supabase.from('employees').insert({
      employee_code: `EMP-BAD-${Date.now()}`,
      name: '壞角色員工',
      department_id: departmentId,
      google_email: `bad-${Date.now()}@turingdrive.ai`,
      role: 'ceo',
    });

    expect(error).not.toBeNull();
  });
});
