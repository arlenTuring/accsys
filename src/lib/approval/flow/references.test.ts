import { describe, expect, it } from 'vitest';
import { flowFieldIds, flowReferences } from './references';
import { DEFAULT_FLOW_OPTIONS, type FlowDef } from './types';

const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333';
const G1 = '44444444-4444-4444-8444-444444444444';

const flow: FlowDef = {
  version: 1,
  options: DEFAULT_FLOW_OPTIONS,
  blocks: [
    { id: 'a', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 }, onUnresolved: 'block' },
    {
      id: 'c',
      type: 'condition',
      label: '金額',
      branches: [
        {
          id: 'b1',
          label: '大額',
          when: { all: [{ field: 'amount', op: 'gt', value: 100000 }, { field: '$applicant.orgLevel', op: 'in', value: ['team', 'dept'] }] },
          blocks: [
            {
              id: 'oc',
              type: 'approver',
              label: '層級',
              source: { kind: 'org_chain', of: 'applicant', includeStartDepartment: false, rules: [{ fromLevel: 'team', toLevel: 'division' }], defaultToLevel: 'ceo' },
              onUnresolved: 'block',
            },
            { id: 'g', type: 'approver', label: '群組', source: { kind: 'employee_group', groupId: G1 }, onUnresolved: 'block' },
          ],
        },
        {
          id: 'b2',
          label: '特定部門',
          when: { not: { field: '$applicant.department', op: 'eq', value: D1 } },
          blocks: [{ id: 'm', type: 'approver', label: '部門成員', source: { kind: 'department_members', departmentId: D2, includeManager: false }, onUnresolved: 'skip' }],
        },
      ],
      otherwise: {
        label: '其他',
        blocks: [
          { id: 'e', type: 'approver', label: '指定', source: { kind: 'employee', employeeId: E1 }, onUnresolved: 'block' },
          { id: 'r', type: 'approver', label: '職務', source: { kind: 'job_role', jobRole: 'it_admin', scope: 'field_department', fieldId: 'dept' }, onUnresolved: 'block' },
          { id: 'p', type: 'approver', label: '預算', source: { kind: 'form_party', party: 'budget_owner', fieldId: 'budget' }, onUnresolved: 'block' },
          { id: 'x', type: 'approver', label: '條件職務', source: { kind: 'department_manager', of: 'field', fieldId: 'dept', levelsUp: 1 }, onUnresolved: 'block' },
        ],
      },
    },
  ],
};

describe('flowReferences', () => {
  it('collects records named by approvers and by applicant conditions in every branch', () => {
    const refs = flowReferences(flow);
    expect([...refs.employees]).toEqual([E1]);
    expect([...refs.departments].sort()).toEqual([D1, D2].sort());
    expect([...refs.groups]).toEqual([G1]);
    expect([...refs.roles]).toEqual(['it_admin']);
    expect([...refs.levels].sort()).toEqual(['ceo', 'dept', 'division', 'team']);
  });

  it('includes a fixed department manager source', () => {
    const refs = flowReferences({
      ...flow,
      blocks: [{ id: 'a', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'department', departmentId: D2, levelsUp: 0 }, onUnresolved: 'block' }],
    });
    expect([...refs.departments]).toEqual([D2]);
  });
});

describe('flowFieldIds', () => {
  it('lists form fields read by conditions and approvers once, skipping system values', () => {
    expect(flowFieldIds(flow)).toEqual(['amount', 'dept', 'budget']);
  });
});
