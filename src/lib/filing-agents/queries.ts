import { and, asc, eq, or } from 'drizzle-orm';
import { getDb, type Db } from '@/lib/db';
import { departments, employees, filingAgents } from '@/lib/db/schema';
import type { Tx } from '@/lib/workflow/tx';

export type FilingTargetOption = {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  label: string;
  isAssignedTarget: boolean;
  assignmentKind: 'self' | 'employee' | 'department' | 'general';
};

export type EmployeeFilingScope = {
  hasAssignments: boolean;
  assignedEmployeeIds: string[];
  assignedDepartmentIds: string[];
  assignedDepartments: { id: string; name: string }[];
  applicants: FilingTargetOption[];
};

/**
 * Checks whether `agentEmployeeId` is configured in `filing_agents` as the
 * 經辦人 for `applicantEmployeeId` (person-level) or `applicantDepartmentId` (department-level).
 */
export async function isConfiguredFilingAgent(
  dbOrTx: Db | Tx,
  agentEmployeeId: string,
  applicantEmployeeId: string,
  applicantDepartmentId: string
): Promise<boolean> {
  if (agentEmployeeId === applicantEmployeeId) return true;
  const rows = await dbOrTx
    .select({ id: filingAgents.id })
    .from(filingAgents)
    .where(
      and(
        eq(filingAgents.agentEmployeeId, agentEmployeeId),
        or(
          and(
            eq(filingAgents.targetType, 'employee'),
            eq(filingAgents.targetEmployeeId, applicantEmployeeId)
          ),
          and(
            eq(filingAgents.targetType, 'department'),
            eq(filingAgents.targetDepartmentId, applicantDepartmentId)
          )
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Loads the filing agent scope for `agentEmployeeId`, returning which employees
 * and departments they are explicitly assigned to represent, as well as the full
 * list of active employees annotated with `isAssignedTarget`.
 */
export async function getEmployeeFilingScope(
  agentEmployeeId: string,
  allowAllEmployees = false,
  db: Db = getDb()
): Promise<EmployeeFilingScope> {
  const [assignments, allEmps, allDepts] = await Promise.all([
    db
      .select({
        targetType: filingAgents.targetType,
        targetEmployeeId: filingAgents.targetEmployeeId,
        targetDepartmentId: filingAgents.targetDepartmentId,
      })
      .from(filingAgents)
      .where(eq(filingAgents.agentEmployeeId, agentEmployeeId)),
    db
      .select({
        id: employees.id,
        name: employees.name,
        departmentId: employees.departmentId,
        departmentName: departments.name,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.accessEnabled, true))
      .orderBy(asc(departments.name), asc(employees.name)),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
  ]);

  const empSet = new Set<string>();
  const deptSet = new Set<string>();
  for (const a of assignments) {
    if (a.targetType === 'employee' && a.targetEmployeeId) {
      empSet.add(a.targetEmployeeId);
    } else if (a.targetType === 'department' && a.targetDepartmentId) {
      deptSet.add(a.targetDepartmentId);
    }
  }

  const hasAssignments = empSet.size > 0 || deptSet.size > 0;
  const assignedDepartments = allDepts.filter((d) => deptSet.has(d.id));

  const applicants: FilingTargetOption[] = [];
  for (const e of allEmps) {
    const isSelf = e.id === agentEmployeeId;
    const isEmpTarget = empSet.has(e.id);
    const isDeptTarget = deptSet.has(e.departmentId);
    const isAssigned = isEmpTarget || isDeptTarget;

    if (!isSelf && !isAssigned && !allowAllEmployees) {
      continue;
    }

    const assignmentKind: FilingTargetOption['assignmentKind'] = isSelf
      ? 'self'
      : isEmpTarget
        ? 'employee'
        : isDeptTarget
          ? 'department'
          : 'general';

    const suffix = isSelf
      ? '（本人）'
      : isEmpTarget
        ? ' ★ 指定經辦人員'
        : isDeptTarget
          ? ' ★ 指定經辦部門'
          : '';

    applicants.push({
      id: e.id,
      name: e.name,
      departmentId: e.departmentId,
      departmentName: e.departmentName,
      label: `${e.name}（${e.departmentName}）${suffix}`,
      isAssignedTarget: isAssigned,
      assignmentKind,
    });
  }

  // Sort: self first, then assigned targets, then others
  applicants.sort((a, b) => {
    const rank = (x: FilingTargetOption) =>
      x.assignmentKind === 'self'
        ? 0
        : x.assignmentKind === 'employee'
          ? 1
          : x.assignmentKind === 'department'
            ? 2
            : 3;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label, 'zh-Hant');
  });

  return {
    hasAssignments,
    assignedEmployeeIds: [...empSet],
    assignedDepartmentIds: [...deptSet],
    assignedDepartments,
    applicants,
  };
}
