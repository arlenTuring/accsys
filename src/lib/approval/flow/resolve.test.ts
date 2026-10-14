import { describe, expect, it } from 'vitest';
import { CHAIRMAN_THRESHOLD, generateApprovalChain } from '../chain';
import { evaluateCondition } from './condition';
import { standardFlow } from './presets';
import { resolveFlow } from './resolve';
import type { ApproverBlock, FlowBlock, FlowContext, FlowDef, OrgSnapshot } from './types';

// Org used by most tests:
//   CEO室 (ceo, mgr E_CEO)
//     └ 研發處 (division, mgr E_DIV)
//         └ 軟體部 (dept, mgr E_DEPT)
//             └ 前端組 (team, mgr E_TEAM) — members E_A, E_B, E_TEAM
const emp = (id: string, departmentId: string, active = true) => [id, { id, name: id, departmentId, active }] as const;
function makeOrg(over: Partial<OrgSnapshot> = {}): OrgSnapshot {
  return {
    employees: new Map([
      emp('E_CEO', 'D_CEO'),
      emp('E_CHAIR', 'D_CEO'),
      emp('E_DIV', 'D_DIV'),
      emp('E_DEPT', 'D_DEPT'),
      emp('E_TEAM', 'D_TEAM'),
      emp('E_A', 'D_TEAM'),
      emp('E_B', 'D_TEAM'),
      emp('E_OFF', 'D_TEAM', false),
      emp('E_LEGAL', 'D_CEO'),
      emp('E_LEGAL2', 'D_CEO'),
    ]),
    departments: new Map([
      ['D_CEO', { id: 'D_CEO', name: 'CEO室', parentId: null, managerId: 'E_CEO', levelCode: 'ceo', active: true }],
      ['D_DIV', { id: 'D_DIV', name: '研發處', parentId: 'D_CEO', managerId: 'E_DIV', levelCode: 'division', active: true }],
      ['D_DEPT', { id: 'D_DEPT', name: '軟體部', parentId: 'D_DIV', managerId: 'E_DEPT', levelCode: 'dept', active: true }],
      ['D_TEAM', { id: 'D_TEAM', name: '前端組', parentId: 'D_DEPT', managerId: 'E_TEAM', levelCode: 'team', active: true }],
    ]),
    levels: new Map([
      ['team', { name: '組級', rank: 10 }],
      ['dept', { name: '部級', rank: 20 }],
      ['division', { name: '處級', rank: 30 }],
      ['ceo', { name: 'CEO級', rank: 40 }],
    ]),
    jobRoles: new Map([
      ['general_manager', { name: '總經理', active: true }],
      ['chairman', { name: '董事長', active: true }],
      ['legal', { name: '法務窗口', active: true }],
      ['finance_contact', { name: '財務窗口', active: true }],
    ]),
    jobRoleBindings: [
      { jobRole: 'general_manager', departmentId: null, employeeId: 'E_CEO', isPrimary: true },
      { jobRole: 'chairman', departmentId: null, employeeId: 'E_CHAIR', isPrimary: true },
      { jobRole: 'legal', departmentId: null, employeeId: 'E_LEGAL', isPrimary: false },
      { jobRole: 'legal', departmentId: null, employeeId: 'E_LEGAL2', isPrimary: false },
      { jobRole: 'finance_contact', departmentId: null, employeeId: 'E_LEGAL', isPrimary: true },
      { jobRole: 'finance_contact', departmentId: 'D_DIV', employeeId: 'E_B', isPrimary: true },
    ],
    groups: new Map([['G1', { name: '管理部', active: true, memberIds: ['E_B', 'E_OFF', 'E_A'] }]]),
    delegations: [],
    budgetOwners: new Map([
      ['BC1', 'E_DEPT'],
      ['BC_NONE', null],
    ]),
    assetCustodians: new Map([
      ['AS1', 'E_A'],
      ['AS2', 'E_B'],
      ['AS3', 'E_A'],
    ]),
    ...over,
  };
}

const ctx = (over: Partial<FlowContext> = {}): FlowContext => ({
  applicantEmployeeId: 'E_A',
  departmentId: 'D_TEAM',
  formKey: 'general-seal',
  today: '2026-10-13',
  fields: {},
  ...over,
  filerEmployeeId: over.filerEmployeeId ?? over.applicantEmployeeId ?? 'E_A',
});

const approver = (id: string, source: ApproverBlock['source'], extra: Partial<ApproverBlock> = {}): ApproverBlock => ({
  id,
  type: 'approver',
  label: id,
  source,
  onUnresolved: 'block',
  ...extra,
});

const flow = (blocks: FlowBlock[], options: Partial<FlowDef['options']> = {}): FlowDef => ({
  version: 1,
  blocks,
  options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block', ...options },
});

function run(f: FlowDef, c: Partial<FlowContext> = {}, org = makeOrg()) {
  const r = resolveFlow(f, ctx(c), org);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const people = (r: ReturnType<typeof run>) => r.steps.map((s) => [s.approverEmployeeId, s.status]);

describe('approver sources', () => {
  it('指定員工', () => {
    expect(people(run(flow([approver('s', { kind: 'employee', employeeId: 'E_LEGAL' })])))).toEqual([['E_LEGAL', 'pending']]);
  });

  it('部門主管 of the applicant, levels up, a fixed department and a field', () => {
    const f = flow([
      approver('own', { kind: 'department_manager', of: 'applicant', levelsUp: 0 }),
      approver('up2', { kind: 'department_manager', of: 'applicant', levelsUp: 2 }),
      approver('fixed', { kind: 'department_manager', of: 'department', departmentId: 'D_CEO', levelsUp: 0 }),
      approver('field', { kind: 'department_manager', of: 'field', fieldId: 'dept', levelsUp: 0 }),
    ]);
    expect(people(run(f, { fields: { dept: 'D_DEPT' } }))).toEqual([
      ['E_TEAM', 'pending'],
      ['E_DIV', 'pending'],
      ['E_CEO', 'pending'],
      ['E_DEPT', 'pending'],
    ]);
  });

  it('部門主管 beyond the root is unresolved', () => {
    const r = resolveFlow(flow([approver('x', { kind: 'department_manager', of: 'applicant', levelsUp: 4 })]), ctx(), makeOrg());
    expect(r).toMatchObject({ ok: false, blockId: 'x' });
  });

  it('部門成員 signs every active member in turn, optionally without the manager', () => {
    const f = flow([approver('m', { kind: 'department_members', departmentId: 'D_TEAM', includeManager: false })], {
      skipApplicant: false,
    });
    expect(people(run(f, { applicantEmployeeId: 'E_CEO', departmentId: 'D_CEO' }))).toEqual([
      ['E_A', 'pending'],
      ['E_B', 'pending'],
    ]);
    const withMgr = flow([approver('m', { kind: 'department_members', departmentId: 'D_TEAM', includeManager: true })]);
    expect(run(withMgr, { applicantEmployeeId: 'E_CEO', departmentId: 'D_CEO' }).steps.map((s) => s.approverEmployeeId)).toEqual([
      'E_A',
      'E_B',
      'E_TEAM',
    ]);
  });

  it('組織層級 signs up to the level configured for the applicant level', () => {
    const block = approver('org', {
      kind: 'org_chain',
      of: 'applicant',
      includeStartDepartment: true,
      rules: [
        { fromLevel: 'team', toLevel: 'ceo' },
        { fromLevel: 'dept', toLevel: 'division' },
      ],
      defaultToLevel: null,
    });
    const team = run(flow([block]), { applicantEmployeeId: 'E_B' });
    expect(team.steps.map((s) => [s.approverEmployeeId, s.label])).toEqual([
      ['E_TEAM', 'org（前端組）'],
      ['E_DEPT', 'org（軟體部）'],
      ['E_DIV', 'org（研發處）'],
      ['E_CEO', 'org（CEO室）'],
    ]);
    const dept = run(flow([block]), { applicantEmployeeId: 'E_LEGAL', departmentId: 'D_DEPT' });
    expect(dept.steps.map((s) => s.approverEmployeeId)).toEqual(['E_DEPT', 'E_DIV']);
    const noRule = resolveFlow(flow([block]), ctx({ departmentId: 'D_DIV' }), makeOrg());
    expect(noRule).toMatchObject({ ok: false });
  });

  it('組織層級 skips departments without a manager and fails when the target level is never reached', () => {
    const org = makeOrg();
    org.departments.set('D_DEPT', { ...org.departments.get('D_DEPT')!, managerId: null });
    const block = approver('org', {
      kind: 'org_chain',
      of: 'applicant',
      includeStartDepartment: false,
      rules: [],
      defaultToLevel: 'division',
    });
    expect(run(flow([block]), { applicantEmployeeId: 'E_B' }, org).steps.map((s) => s.approverEmployeeId)).toEqual(['E_DIV']);
    const tooHigh = { ...block, source: { ...block.source, defaultToLevel: 'ceo' } } as ApproverBlock;
    org.departments.set('D_CEO', { ...org.departments.get('D_CEO')!, levelCode: null });
    expect(resolveFlow(flow([tooHigh]), ctx({ applicantEmployeeId: 'E_B' }), org)).toMatchObject({ ok: false });
  });

  it('表單關係人: applicant, filer, employee field, budget owner and asset custodians', () => {
    const f = flow(
      [
        approver('ap', { kind: 'form_party', party: 'applicant' }),
        approver('fi', { kind: 'form_party', party: 'filer' }),
        approver('fe', { kind: 'form_party', party: 'field_employee', fieldId: 'who' }),
        approver('bo', { kind: 'form_party', party: 'budget_owner', fieldId: 'budget' }),
        approver('ac', { kind: 'form_party', party: 'asset_custodian', fieldId: 'assets' }),
      ],
      { skipFiler: false, collapseDuplicates: false }
    );
    const r = run(f, {
      applicantEmployeeId: 'E_B',
      filerEmployeeId: 'E_LEGAL',
      fields: { who: ['E_DIV', 'E_CEO'], budget: 'BC1', assets: ['AS1', 'AS2', 'AS3'] },
    });
    expect(people(r)).toEqual([
      ['E_B', 'pending'],
      ['E_LEGAL', 'pending'],
      ['E_DIV', 'pending'],
      ['E_CEO', 'pending'],
      ['E_DEPT', 'pending'],
      ['E_A', 'pending'],
      ['E_B', 'auto_approved'],
    ]);
  });

  it('員工群組 keeps the configured order and leaves out disabled members', () => {
    expect(run(flow([approver('g', { kind: 'employee_group', groupId: 'G1' })]), { applicantEmployeeId: 'E_CEO' }).steps.map((s) => s.approverEmployeeId)).toEqual([
      'E_B',
      'E_A',
    ]);
  });

  it('職務類別: company scope, department scope walking up, and the primary rule', () => {
    const company = flow([approver('gm', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' })]);
    expect(run(company).steps[0].approverEmployeeId).toBe('E_CEO');

    const scoped = flow([approver('fc', { kind: 'job_role', jobRole: 'finance_contact', scope: 'applicant_department' })]);
    expect(run(scoped, { applicantEmployeeId: 'E_A' }).steps[0].approverEmployeeId).toBe('E_B');
    expect(run(scoped, { applicantEmployeeId: 'E_CEO', departmentId: 'D_CEO' }).steps[0].approverEmployeeId).toBe('E_LEGAL');

    const ambiguous = resolveFlow(flow([approver('lg', { kind: 'job_role', jobRole: 'legal', scope: 'company' })]), ctx(), makeOrg());
    expect(ambiguous).toMatchObject({ ok: false, blockId: 'lg' });
    if (!ambiguous.ok) expect(ambiguous.error).toContain('主要人員');
  });
});

describe('system signing, delegation and unresolved steps', () => {
  it('signs for the applicant, the filer and repeated approvers but keeps the steps', () => {
    const f = flow([
      approver('own', { kind: 'department_manager', of: 'applicant', levelsUp: 0 }),
      approver('again', { kind: 'employee', employeeId: 'E_DEPT' }),
      approver('filer', { kind: 'employee', employeeId: 'E_LEGAL' }),
      approver('gm', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' }),
    ]);
    const r = run(f, { applicantEmployeeId: 'E_TEAM', filerEmployeeId: 'E_LEGAL', departmentId: 'D_TEAM' });
    expect(r.steps.map((s) => [s.approverEmployeeId, s.status, s.systemNote])).toEqual([
      ['E_TEAM', 'auto_approved', '簽核人即申請人，由系統代簽'],
      ['E_DEPT', 'pending', null],
      ['E_LEGAL', 'auto_approved', '簽核人即填表人，由系統代簽'],
      ['E_CEO', 'pending', null],
    ]);
    const dup = run(flow([approver('a', { kind: 'employee', employeeId: 'E_DEPT' }), approver('b', { kind: 'employee', employeeId: 'E_DEPT' })]));
    expect(dup.steps.map((s) => s.status)).toEqual(['pending', 'auto_approved']);
  });

  it('an explicit 申請人 step is not signed by the system', () => {
    const r = run(flow([approver('confirm', { kind: 'form_party', party: 'applicant' })]), { filerEmployeeId: 'E_LEGAL' });
    expect(people(r)).toEqual([['E_A', 'pending']]);
  });

  it('applies an active delegation in scope and records the original approver', () => {
    const org = makeOrg({
      delegations: [
        { delegatorId: 'E_CEO', delegateId: 'E_DIV', startsOn: '2026-10-10', endsOn: '2026-10-13', formKeys: null },
        { delegatorId: 'E_TEAM', delegateId: 'E_B', startsOn: '2026-10-01', endsOn: '2026-10-31', formKeys: ['other-form'] },
      ],
    });
    const f = flow([
      approver('own', { kind: 'department_manager', of: 'applicant', levelsUp: 0 }),
      approver('gm', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' }),
    ]);
    const r = run(f, {}, org);
    expect(r.steps.map((s) => [s.approverEmployeeId, s.delegatedFromEmployeeId])).toEqual([
      ['E_TEAM', null],
      ['E_DIV', 'E_CEO'],
    ]);
    expect(run(f, { today: '2026-10-14' }, org).steps[1]).toMatchObject({ approverEmployeeId: 'E_CEO', delegatedFromEmployeeId: null });
  });

  it('a disabled approver blocks submission or is skipped, as configured', () => {
    const blocked = resolveFlow(flow([approver('off', { kind: 'employee', employeeId: 'E_OFF' })]), ctx(), makeOrg());
    expect(blocked).toMatchObject({ ok: false, blockId: 'off' });
    if (!blocked.ok) expect(blocked.error).toContain('停用');

    const r = run(
      flow([
        approver('off', { kind: 'employee', employeeId: 'E_OFF' }, { onUnresolved: 'skip' }),
        approver('gm', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' }),
      ])
    );
    expect(r.steps.map((s) => [s.approverEmployeeId, s.status])).toEqual([
      [null, 'skipped'],
      ['E_CEO', 'pending'],
    ]);
  });

  it('a flow with nobody left to sign is refused unless configured to auto-approve', () => {
    const selfOnly = [approver('own', { kind: 'department_manager', of: 'applicant', levelsUp: 0 })];
    expect(resolveFlow(flow(selfOnly), ctx({ applicantEmployeeId: 'E_TEAM' }), makeOrg())).toMatchObject({ ok: false, blockId: null });
    const r = run(flow(selfOnly, { whenEmpty: 'auto_approve' }), { applicantEmployeeId: 'E_TEAM' });
    expect(r.steps.map((s) => s.status)).toEqual(['auto_approved']);
    expect(resolveFlow(flow([], { whenEmpty: 'block' }), ctx(), makeOrg()).ok).toBe(false);
  });
});

describe('condition blocks', () => {
  const branching = flow([
    {
      id: 'amount',
      type: 'condition',
      label: '金額',
      branches: [
        {
          id: 'big',
          label: '合計超過10萬以上',
          when: { field: 'total', op: 'gt', value: 100000 },
          blocks: [approver('chair', { kind: 'job_role', jobRole: 'chairman', scope: 'company' })],
        },
        {
          id: 'mid',
          label: '合計超過1萬',
          when: { field: 'total', op: 'gt', value: 10000 },
          blocks: [approver('gm', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' })],
        },
      ],
      otherwise: { label: '其他', blocks: [approver('mgr', { kind: 'department_manager', of: 'applicant', levelsUp: 0 })] },
    },
  ]);

  it('takes the first matching branch in order, else the exception branch', () => {
    expect(run(branching, { fields: { total: '150000.00' } })).toMatchObject({ path: ['金額：合計超過10萬以上'] });
    expect(run(branching, { fields: { total: 150000 } }).steps[0].approverEmployeeId).toBe('E_CHAIR');
    expect(run(branching, { fields: { total: 50000 } }).steps[0].approverEmployeeId).toBe('E_CEO');
    expect(run(branching, { fields: { total: 100 } })).toMatchObject({ path: ['金額：其他'] });
    expect(run(branching, { fields: {} }).steps[0].approverEmployeeId).toBe('E_TEAM');
  });

  it('evaluates operators, groups and system values', () => {
    const org = makeOrg();
    const c = ctx({ fields: { lend: true, seals: ['公司大章', '發票章'], type: '合約', n: '5' } });
    const ev = (cond: Parameters<typeof evaluateCondition>[0]) => evaluateCondition(cond, c, org);
    expect(ev({ field: 'lend', op: 'eq', value: true })).toBe(true);
    expect(ev({ field: 'lend', op: 'eq', value: 'true' })).toBe(true);
    expect(ev({ field: 'seals', op: 'contains', value: '發票章' })).toBe(true);
    expect(ev({ field: 'type', op: 'in', value: ['合約', '其他'] })).toBe(true);
    expect(ev({ field: 'type', op: 'not_in', value: ['合約'] })).toBe(false);
    expect(ev({ field: 'missing', op: 'gt', value: 0 })).toBe(false);
    expect(ev({ field: 'missing', op: 'neq', value: 'x' })).toBe(true);
    expect(ev({ field: 'missing', op: 'empty' })).toBe(true);
    expect(ev({ field: 'n', op: 'gte', value: 5 })).toBe(true);
    expect(ev({ all: [{ field: 'lend', op: 'filled' }, { any: [{ field: 'n', op: 'lt', value: 1 }, { not: { field: 'type', op: 'eq', value: 'x' } }] }] })).toBe(true);
    expect(ev({ field: '$applicant.orgLevel', op: 'eq', value: 'team' })).toBe(true);
    expect(ev({ field: '$applicant.department', op: 'eq', value: 'D_TEAM' })).toBe(true);
    expect(evaluateCondition({ field: '$applicant.jobRoles', op: 'contains', value: 'general_manager' }, ctx({ applicantEmployeeId: 'E_CEO' }), org)).toBe(true);
  });
});

describe('standard flow preset matches the hard-coded chain', () => {
  // Every combination of who the applicant / manager / budget owner is and the amount.
  const people5 = ['P1', 'P2', 'P3', 'GM', 'CH'];
  const amounts = [0, 1, CHAIRMAN_THRESHOLD, CHAIRMAN_THRESHOLD + 0.01, 250000];

  function orgFor(managerId: string, budgetOwner: string | null): OrgSnapshot {
    return makeOrg({
      employees: new Map(people5.map((p) => emp(p, 'D1'))),
      departments: new Map([['D1', { id: 'D1', name: '部門', parentId: null, managerId, levelCode: null, active: true }]]),
      jobRoleBindings: [
        { jobRole: 'general_manager', departmentId: null, employeeId: 'GM', isPrimary: true },
        { jobRole: 'chairman', departmentId: null, employeeId: 'CH', isPrimary: true },
      ],
      budgetOwners: new Map([['BC', budgetOwner]]),
    });
  }

  for (const withBudget of [true, false]) {
    it(`${withBudget ? 'with' : 'without'} a budget owner`, () => {
      const f = standardFlow({ amountField: 'total', budgetField: withBudget ? 'budget' : undefined });
      let cases = 0;
      for (const applicant of people5)
        for (const manager of people5)
          for (const owner of withBudget ? people5 : [null])
            for (const amount of amounts) {
              const legacy = generateApprovalChain({
                applicantEmployeeId: applicant,
                departmentManagerEmployeeId: manager,
                budgetOwnerEmployeeId: owner,
                generalManagerEmployeeId: 'GM',
                chairmanEmployeeId: amount > CHAIRMAN_THRESHOLD ? 'CH' : applicant,
                totalAmount: amount,
              });
              const r = resolveFlow(
                f,
                { applicantEmployeeId: applicant, filerEmployeeId: applicant, departmentId: 'D1', formKey: null, today: '2026-10-13', fields: { total: amount.toFixed(2), budget: 'BC' } },
                orgFor(manager, owner)
              );
              expect(r.ok).toBe(true);
              if (!r.ok) return;
              const pending = r.steps.filter((s) => s.status === 'pending').map((s) => [s.approverEmployeeId, s.blockId]);
              expect(pending).toEqual(legacy.map((s) => [s.approverEmployeeId, s.approverRole === 'department_manager' ? 'dept_manager' : s.approverRole]));
              cases += 1;
            }
      expect(cases).toBeGreaterThan(100);
    });
  }
});
