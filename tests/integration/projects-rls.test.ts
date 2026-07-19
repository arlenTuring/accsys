import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnonTestClient,
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('projects RLS policies', () => {
  let adminClient: ReturnType<typeof createServiceRoleTestClient>;
  const password = 'Test-password-123!';
  const staffEmail = `rls-projects-staff-${Date.now()}@turingdrive.ai`;
  const adminEmail = `rls-projects-admin-${Date.now()}@turingdrive.ai`;

  let departmentId: string;
  let staffAuthUserId: string;
  let adminAuthUserId: string;
  let projectId: string;

  beforeAll(async () => {
    adminClient = createServiceRoleTestClient();

    const { data: dept, error: deptError } = await adminClient
      .from('departments')
      .insert({ code: `RLSPJ-${Date.now()}`, name: 'RLS 專案測試部門' })
      .select()
      .single();
    if (deptError) throw deptError;
    departmentId = dept.id;

    const { data: staffUser, error: staffAuthError } = await adminClient.auth.admin.createUser({
      email: staffEmail,
      password,
      email_confirm: true,
    });
    if (staffAuthError) throw staffAuthError;
    staffAuthUserId = staffUser.user.id;

    const { data: adminUser, error: adminAuthError } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminAuthError) throw adminAuthError;
    adminAuthUserId = adminUser.user.id;

    const { error: employeesError } = await adminClient.from('employees').insert([
      {
        employee_code: `RLSPJ-STAFF-${Date.now()}`,
        name: 'RLS Projects Staff',
        department_id: departmentId,
        google_email: staffEmail,
        role: 'staff',
      },
      {
        employee_code: `RLSPJ-ADMIN-${Date.now()}`,
        name: 'RLS Projects Admin',
        department_id: departmentId,
        google_email: adminEmail,
        role: 'admin',
      },
    ]);
    if (employeesError) throw employeesError;

    const { data: project, error: projectError } = await adminClient
      .from('projects')
      .insert({ code: `RLSPJ-CODE-${Date.now()}`, name: 'RLS 測試專案' })
      .select()
      .single();
    if (projectError) throw projectError;
    projectId = project.id;
  });

  afterAll(async () => {
    await adminClient.auth.admin.deleteUser(staffAuthUserId);
    await adminClient.auth.admin.deleteUser(adminAuthUserId);
    await adminClient.from('employees').delete().eq('department_id', departmentId);
    await adminClient.from('departments').delete().eq('id', departmentId);
    await adminClient.from('projects').delete().eq('id', projectId);
  });

  it('allows an authenticated staff user to read projects', async () => {
    const staffClient = createAnonTestClient();
    const { error: signInError } = await staffClient.auth.signInWithPassword({
      email: staffEmail,
      password,
    });
    expect(signInError).toBeNull();

    const { data, error } = await staffClient.from('projects').select('*').eq('id', projectId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('blocks a staff user from creating a project', async () => {
    const staffClient = createAnonTestClient();
    await staffClient.auth.signInWithPassword({ email: staffEmail, password });

    const { error } = await staffClient
      .from('projects')
      .insert({ code: `RLSPJ-DENY-${Date.now()}`, name: '不應該成功' });

    expect(error).not.toBeNull();
  });

  it('allows an admin user to create and delete a project', async () => {
    const adminAuthClient = createAnonTestClient();
    await adminAuthClient.auth.signInWithPassword({ email: adminEmail, password });

    const { data, error } = await adminAuthClient
      .from('projects')
      .insert({ code: `RLSPJ-ALLOW-${Date.now()}`, name: '應該成功' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe('應該成功');

    await adminClient.from('projects').delete().eq('id', data!.id);
  });
});
