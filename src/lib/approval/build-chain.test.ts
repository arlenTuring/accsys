import { describe, expect, it } from 'vitest';
import { buildApprovalChainForForm } from './build-chain';

function makeFakeDb(overrides: {
  departments?: Record<string, { manager_employee_id: string | null } | undefined>;
  generalManager?: { id: string } | null;
  chairman?: { id: string } | null;
}) {
  return {
    from(table: string) {
      const eqFilters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          eqFilters[column] = value;
          return builder;
        },
        limit() {
          return builder;
        },
        async single() {
          if (table === 'departments') {
            const dept = overrides.departments?.[eqFilters.id as string];
            return dept ? { data: dept, error: null } : { data: null, error: new Error('not found') };
          }
          if (table === 'employees' && eqFilters.is_general_manager === true) {
            return overrides.generalManager
              ? { data: overrides.generalManager, error: null }
              : { data: null, error: new Error('not found') };
          }
          if (table === 'employees' && eqFilters.is_chairman === true) {
            return overrides.chairman
              ? { data: overrides.chairman, error: null }
              : { data: null, error: new Error('not found') };
          }
          return { data: null, error: new Error('unexpected query') };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('buildApprovalChainForForm', () => {
  it('builds manager → budget owner → GM for a normal amount', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 65000,
    });
    expect(result).toEqual({
      ok: true,
      chain: [
        { approverEmployeeId: 'MGR', approverRole: 'department_manager' },
        { approverEmployeeId: 'OWNER', approverRole: 'budget_owner' },
        { approverEmployeeId: 'GM', approverRole: 'general_manager' },
      ],
    });
  });

  it('adds the chairman when total exceeds the threshold', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
      chairman: { id: 'CHAIR' },
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 100001,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chain[result.chain.length - 1]).toEqual({
      approverEmployeeId: 'CHAIR',
      approverRole: 'chairman',
    });
  });

  it('errors when the department has no manager', async () => {
    const db = makeFakeDb({ departments: { D1: { manager_employee_id: null } }, generalManager: { id: 'GM' } });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 1000,
    });
    expect(result).toEqual({ ok: false, error: '申請單位尚未設定主管，無法送出簽核，請聯絡系統管理員' });
  });

  it('errors when no general manager is configured', async () => {
    const db = makeFakeDb({ departments: { D1: { manager_employee_id: 'MGR' } }, generalManager: null });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 1000,
    });
    expect(result).toEqual({ ok: false, error: '系統尚未設定總經理，請聯絡系統管理員' });
  });

  it('errors when total exceeds the threshold but no chairman is configured', async () => {
    const db = makeFakeDb({
      departments: { D1: { manager_employee_id: 'MGR' } },
      generalManager: { id: 'GM' },
      chairman: null,
    });
    const result = await buildApprovalChainForForm(db, {
      applicantEmployeeId: 'APP',
      departmentId: 'D1',
      budgetOwnerEmployeeId: 'OWNER',
      totalAmount: 100001,
    });
    expect(result).toEqual({
      ok: false,
      error: '系統尚未設定董事長，無法送出逾 10 萬元的表單，請聯絡系統管理員',
    });
  });
});
