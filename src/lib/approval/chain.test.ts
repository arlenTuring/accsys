import { describe, expect, it } from 'vitest';
import { generateApprovalChain } from './chain';

const base = {
  applicantEmployeeId: 'E1',
  departmentManagerEmployeeId: 'E2',
  budgetOwnerEmployeeId: 'E3',
  generalManagerEmployeeId: 'E4',
  chairmanEmployeeId: 'E5',
};

describe('generateApprovalChain', () => {
  it('builds manager → budget owner → GM for a normal request under 100k', () => {
    expect(generateApprovalChain({ ...base, totalAmount: 65000 })).toEqual([
      { approverEmployeeId: 'E2', approverRole: 'department_manager' },
      { approverEmployeeId: 'E3', approverRole: 'budget_owner' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('appends the chairman when the total exceeds 100k', () => {
    const chain = generateApprovalChain({ ...base, totalAmount: 100001 });
    expect(chain[chain.length - 1]).toEqual({
      approverEmployeeId: 'E5',
      approverRole: 'chairman',
    });
  });

  it('does not append the chairman at exactly 100k', () => {
    const chain = generateApprovalChain({ ...base, totalAmount: 100000 });
    expect(chain.map((s) => s.approverRole)).not.toContain('chairman');
  });

  it('dedupes when the manager is also the budget owner, keeping the first role', () => {
    expect(
      generateApprovalChain({ ...base, budgetOwnerEmployeeId: 'E2', totalAmount: 50000 })
    ).toEqual([
      { approverEmployeeId: 'E2', approverRole: 'department_manager' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('drops the applicant when they would otherwise appear as an approver', () => {
    expect(
      generateApprovalChain({ ...base, applicantEmployeeId: 'E2', totalAmount: 50000 })
    ).toEqual([
      { approverEmployeeId: 'E3', approverRole: 'budget_owner' },
      { approverEmployeeId: 'E4', approverRole: 'general_manager' },
    ]);
  });

  it('returns an empty chain (auto-approve) when the applicant is the only would-be approver', () => {
    expect(
      generateApprovalChain({
        applicantEmployeeId: 'E4',
        departmentManagerEmployeeId: 'E4',
        budgetOwnerEmployeeId: 'E4',
        generalManagerEmployeeId: 'E4',
        chairmanEmployeeId: 'E5',
        totalAmount: 50000,
      })
    ).toEqual([]);
  });
});
