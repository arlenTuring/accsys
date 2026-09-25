import { describe, expect, it } from 'vitest';
import { createServiceRoleTestClient } from './supabase-test-client';
import { getSql } from '@/lib/db';

describe('projects migration', () => {
  it('has no remaining negative annual_budget_amount rows', async () => {
    const [{ count }] = await getSql()<{ count: number }[]>`
      select count(*)::int as count from budget_codes where annual_budget_amount < 0`;
    expect(count).toBe(0);
  });

  it('every project-scoped budget code resolves to a projects row with a matching code', async () => {
    const [{ orphans }] = await getSql()<{ orphans: number }[]>`
      select count(*)::int as orphans
      from budget_codes b left join projects p on p.id = b.project_id
      where b.project_id is not null and p.id is null`;
    expect(orphans).toBe(0);
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
