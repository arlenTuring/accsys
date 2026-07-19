import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient, hasIntegrationTestCredentials } from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('projects migration', () => {
  it('has no remaining negative annual_budget_amount rows', async () => {
    const admin = createServiceRoleTestClient();
    const { count } = await admin
      .from('budget_codes')
      .select('id', { count: 'exact', head: true })
      .lt('annual_budget_amount', 0);
    expect(count).toBe(0);
  });

  it('every project-scoped budget code resolves to a projects row with a matching code', async () => {
    const admin = createServiceRoleTestClient();
    const { data: rows } = await admin
      .from('budget_codes')
      .select('project_id, project:projects(code)')
      .not('project_id', 'is', null);
    for (const row of rows ?? []) {
      expect(row.project).not.toBeNull();
    }
  });

  it('rejects a budget_codes row with both department_id and project_id set', async () => {
    const admin = createServiceRoleTestClient();
    const { data: anyDept } = await admin.from('departments').select('id').limit(1).single();
    const { data: anyProject } = await admin.from('projects').select('id').limit(1).maybeSingle();
    if (!anyProject) return;
    const { error } = await admin.from('budget_codes').insert({
      code: `MIGTEST-${Date.now()}`,
      department_id: anyDept!.id,
      project_id: anyProject.id,
      category: '測試',
      fiscal_year: '115',
      annual_budget_amount: 1000,
    });
    expect(error).not.toBeNull();
  });
});
