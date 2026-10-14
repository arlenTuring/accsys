import { describe, expect, it } from 'vitest';
import { parseFlow } from './parse';
import { standardFlow } from './presets';

const UUID = '6f1c2a34-1b2c-4d5e-8f90-1234567890ab';

describe('parseFlow', () => {
  it('accepts the standard preset unchanged', () => {
    const preset = standardFlow({ amountField: 'total', budgetField: 'budget' });
    expect(parseFlow(JSON.parse(JSON.stringify(preset)))).toEqual({ ok: true, flow: preset });
  });

  it('accepts every block type from the designer and fills option defaults', () => {
    const r = parseFlow({
      version: 1,
      blocks: [
        { id: 'a', type: 'approver', label: '指定員工', source: { kind: 'employee', employeeId: UUID } },
        { id: 'b', type: 'approver', label: '主管', source: { kind: 'department_manager', of: 'field', fieldId: 'dept', levelsUp: 1 } },
        { id: 'c', type: 'approver', label: '成員', source: { kind: 'department_members', departmentId: UUID } },
        {
          id: 'd',
          type: 'approver',
          label: '組織層級',
          source: { kind: 'org_chain', of: 'applicant', rules: [{ fromLevel: 'team', toLevel: 'ceo' }] },
        },
        { id: 'e', type: 'approver', label: '關係人', source: { kind: 'form_party', party: 'budget_owner', fieldId: 'budget' } },
        { id: 'f', type: 'approver', label: '群組', source: { kind: 'employee_group', groupId: UUID }, onUnresolved: 'skip' },
        { id: 'g', type: 'approver', label: '法務', source: { kind: 'job_role', jobRole: 'legal' } },
        {
          id: 'h',
          type: 'condition',
          label: '條件式',
          branches: [{ id: 'h1', label: '合計超過10萬以上', when: { field: 'total', op: 'gt', value: 100000 }, blocks: [] }],
          otherwise: { blocks: [] },
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.flow.options).toEqual({ skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block' });
    expect(r.flow.blocks[3]).toMatchObject({ source: { includeStartDepartment: true, defaultToLevel: null } });
    expect(r.flow.blocks[6]).toMatchObject({ source: { scope: 'company' }, onUnresolved: 'block' });
    expect(r.flow.blocks[7]).toMatchObject({ otherwise: { label: '其他' } });
  });

  it.each([
    ['not an object', null],
    ['wrong version', { version: 2, blocks: [] }],
    ['unknown block type', { version: 1, blocks: [{ id: 'a', type: 'script', label: 'x' }] }],
    ['unknown source kind', { version: 1, blocks: [{ id: 'a', type: 'approver', label: 'x', source: { kind: 'sql' } }] }],
    ['bad employee id', { version: 1, blocks: [{ id: 'a', type: 'approver', label: 'x', source: { kind: 'employee', employeeId: "1' or 1=1" } }] }],
    ['duplicate ids', { version: 1, blocks: [1, 2].map(() => ({ id: 'a', type: 'approver', label: 'x', source: { kind: 'form_party', party: 'applicant' } })) }],
    ['bad id characters', { version: 1, blocks: [{ id: 'a b', type: 'approver', label: 'x', source: { kind: 'form_party', party: 'applicant' } }] }],
    ['empty label', { version: 1, blocks: [{ id: 'a', type: 'approver', label: ' ', source: { kind: 'form_party', party: 'applicant' } }] }],
    ['bad operator', { version: 1, blocks: [{ id: 'c', type: 'condition', label: 'x', branches: [{ id: 'b', label: 'y', when: { field: 'f', op: 'regex', value: '.*' }, blocks: [] }], otherwise: { blocks: [] } }] }],
    ['object as compare value', { version: 1, blocks: [{ id: 'c', type: 'condition', label: 'x', branches: [{ id: 'b', label: 'y', when: { field: 'f', op: 'eq', value: { a: 1 } }, blocks: [] }], otherwise: { blocks: [] } }] }],
    ['condition without branches', { version: 1, blocks: [{ id: 'c', type: 'condition', label: 'x', branches: [], otherwise: { blocks: [] } }] }],
    ['org chain without an end level', { version: 1, blocks: [{ id: 'a', type: 'approver', label: 'x', source: { kind: 'org_chain', of: 'applicant', rules: [] } }] }],
    ['levels up out of range', { version: 1, blocks: [{ id: 'a', type: 'approver', label: 'x', source: { kind: 'department_manager', of: 'applicant', levelsUp: 99 } }] }],
    ['party field missing', { version: 1, blocks: [{ id: 'a', type: 'approver', label: 'x', source: { kind: 'form_party', party: 'field_employee' } }] }],
    ['bad whenEmpty', { version: 1, blocks: [], options: { whenEmpty: 'maybe' } }],
  ])('rejects %s', (_name, raw) => {
    expect(parseFlow(raw).ok).toBe(false);
  });

  it('limits size and nesting', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, type: 'approver', label: 'x', source: { kind: 'form_party', party: 'applicant' } }));
    expect(parseFlow({ version: 1, blocks: many }).ok).toBe(false);

    let nested: unknown[] = [];
    for (let i = 0; i < 12; i++) {
      nested = [{ id: `c${i}`, type: 'condition', label: 'x', branches: [{ id: `b${i}`, label: 'y', when: { field: 'f', op: 'filled' }, blocks: nested }], otherwise: { blocks: [] } }];
    }
    expect(parseFlow({ version: 1, blocks: nested }).ok).toBe(false);
  });
});
