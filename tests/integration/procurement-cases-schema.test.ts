import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createServiceRoleTestClient,
  hasIntegrationTestCredentials,
} from './supabase-test-client';

describe.skipIf(!hasIntegrationTestCredentials())('procurement_cases + next_case_number', () => {
  let supabase: ReturnType<typeof createServiceRoleTestClient>;
  const createdCaseIds: string[] = [];
  let employeeId: string;

  beforeAll(async () => {
    supabase = createServiceRoleTestClient();
    const { data } = await supabase.from('employees').select('id').limit(1).single();
    employeeId = data!.id;
  });

  afterAll(async () => {
    if (createdCaseIds.length > 0) {
      await supabase.from('procurement_cases').delete().in('id', createdCaseIds);
    }
  });

  it('generates a case number matching CP + 5-digit year-month + 4-digit serial', async () => {
    const { data, error } = await supabase.rpc('next_case_number');
    expect(error).toBeNull();
    expect(data).toMatch(/^CP\d{5}\d{4}$/);
  });

  it('generates strictly increasing serials within the same year-month', async () => {
    const { data: first } = await supabase.rpc('next_case_number');
    const { data: second } = await supabase.rpc('next_case_number');
    const prefix = (n: string) => n.slice(0, 7);
    const serial = (n: string) => parseInt(n.slice(7), 10);
    expect(prefix(second)).toBe(prefix(first));
    expect(serial(second)).toBe(serial(first) + 1);
  });

  it('inserts a procurement_case with a unique case_number', async () => {
    const { data: caseNumber } = await supabase.rpc('next_case_number');
    const { data, error } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data!.case_number).toBe(caseNumber);
    createdCaseIds.push(data!.id);

    const { error: dupError } = await supabase
      .from('procurement_cases')
      .insert({ case_number: caseNumber, created_by_employee_id: employeeId });
    expect(dupError).not.toBeNull();
  });
});
