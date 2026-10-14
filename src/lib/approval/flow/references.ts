import type { Condition, FlowBlock, FlowDef } from './types';

export type FlowReferences = {
  employees: Set<string>;
  departments: Set<string>;
  groups: Set<string>;
  /** job role codes */
  roles: Set<string>;
  /** org level codes */
  levels: Set<string>;
};

/** Organisation records a flow names directly (not the ones it finds through form fields). */
export function flowReferences(flow: FlowDef): FlowReferences {
  const refs: FlowReferences = { employees: new Set(), departments: new Set(), groups: new Set(), roles: new Set(), levels: new Set() };
  const visitCondition = (c: Condition) => {
    if ('all' in c) c.all.forEach(visitCondition);
    else if ('any' in c) c.any.forEach(visitCondition);
    else if ('not' in c) visitCondition(c.not);
    else if (c.field === '$applicant.orgLevel') {
      for (const v of Array.isArray(c.value) ? c.value : [c.value]) if (typeof v === 'string') refs.levels.add(v);
    } else if (c.field === '$applicant.jobRoles') {
      for (const v of Array.isArray(c.value) ? c.value : [c.value]) if (typeof v === 'string') refs.roles.add(v);
    } else if (c.field === '$applicant.department') {
      for (const v of Array.isArray(c.value) ? c.value : [c.value]) if (typeof v === 'string') refs.departments.add(v);
    }
  };
  const visit = (blocks: FlowBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'condition') {
        b.branches.forEach((br) => {
          visitCondition(br.when);
          visit(br.blocks);
        });
        visit(b.otherwise.blocks);
        continue;
      }
      const s = b.source;
      if (s.kind === 'employee') refs.employees.add(s.employeeId);
      if (s.kind === 'department_manager' && s.of === 'department' && s.departmentId) refs.departments.add(s.departmentId);
      if (s.kind === 'department_members') refs.departments.add(s.departmentId);
      if (s.kind === 'employee_group') refs.groups.add(s.groupId);
      if (s.kind === 'job_role') refs.roles.add(s.jobRole);
      if (s.kind === 'org_chain') {
        s.rules.forEach((r) => refs.levels.add(r.fromLevel).add(r.toLevel));
        if (s.defaultToLevel) refs.levels.add(s.defaultToLevel);
      }
    }
  };
  visit(flow.blocks);
  return refs;
}

/** Form field ids the flow reads (conditions and approver sources), in first-use order. */
export function flowFieldIds(flow: FlowDef): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !id.startsWith('$') && !ids.includes(id)) ids.push(id);
  };
  const visitCondition = (c: Condition) => {
    if ('all' in c) c.all.forEach(visitCondition);
    else if ('any' in c) c.any.forEach(visitCondition);
    else if ('not' in c) visitCondition(c.not);
    else add(c.field);
  };
  const visit = (blocks: FlowBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'condition') {
        b.branches.forEach((br) => {
          visitCondition(br.when);
          visit(br.blocks);
        });
        visit(b.otherwise.blocks);
      } else if ('fieldId' in b.source) {
        add(b.source.fieldId);
      }
    }
  };
  visit(flow.blocks);
  return ids;
}
