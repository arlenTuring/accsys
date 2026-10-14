import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/lib/db';
import { departments, employeeIdentities, employeeJobRoles, employees, jobRoles } from '@/lib/db/schema';

export type JobRoleOption = { id: string; code: string; name: string; isSystem: boolean };

export type EmployeeJobRoleBinding = {
  bindingId: string;
  jobRoleId: string;
  jobRoleName: string;
  departmentId: string | null;
  departmentName: string | null;
  isPrimary: boolean;
};

export type EmployeeAdminRow = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  departmentName: string;
  title: string | null;
  googleEmail: string | null;
  phone: string | null;
  extension: string | null;
  role: string;
  accessEnabled: boolean;
  bound: boolean;
  jobRoles: EmployeeJobRoleBinding[];
};

export function activeJobRoles(db: Db): Promise<JobRoleOption[]> {
  return db
    .select({ id: jobRoles.id, code: jobRoles.code, name: jobRoles.name, isSystem: jobRoles.isSystem })
    .from(jobRoles)
    .where(eq(jobRoles.active, true))
    .orderBy(desc(jobRoles.isSystem), asc(jobRoles.name));
}

/** Admin-only data; the caller must have checked the role. */
export async function getEmployeeAdminData() {
  const db = getDb();
  const scope = alias(departments, 'scope');
  const [rows, departmentRows, jobRoleRows, bindings] = await Promise.all([
    db
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        departmentId: employees.departmentId,
        departmentName: departments.name,
        title: employees.title,
        googleEmail: employees.googleEmail,
        phone: employees.phone,
        extension: employees.extension,
        role: employees.role,
        accessEnabled: employees.accessEnabled,
        identityId: employeeIdentities.id,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(employeeIdentities, and(eq(employeeIdentities.employeeId, employees.id), isNull(employeeIdentities.revokedAt)))
      .orderBy(asc(employees.employeeCode)),
    db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.sortOrder), asc(departments.code)),
    activeJobRoles(db),
    db
      .select({
        bindingId: employeeJobRoles.id,
        employeeId: employeeJobRoles.employeeId,
        jobRoleId: employeeJobRoles.jobRoleId,
        jobRoleName: jobRoles.name,
        departmentId: employeeJobRoles.departmentId,
        departmentName: scope.name,
        isPrimary: employeeJobRoles.isPrimary,
      })
      .from(employeeJobRoles)
      .innerJoin(jobRoles, eq(jobRoles.id, employeeJobRoles.jobRoleId))
      .leftJoin(scope, eq(scope.id, employeeJobRoles.departmentId))
      .orderBy(asc(jobRoles.name), asc(employeeJobRoles.createdAt)),
  ]);
  return {
    employees: rows.map(
      ({ identityId, ...r }): EmployeeAdminRow => ({
        ...r,
        bound: identityId !== null,
        jobRoles: bindings
          .filter((b) => b.employeeId === r.id)
          .map((b) => ({
            bindingId: b.bindingId,
            jobRoleId: b.jobRoleId,
            jobRoleName: b.jobRoleName,
            departmentId: b.departmentId,
            departmentName: b.departmentName,
            isPrimary: b.isPrimary,
          })),
      })
    ),
    departments: departmentRows,
    jobRoles: jobRoleRows,
  };
}
