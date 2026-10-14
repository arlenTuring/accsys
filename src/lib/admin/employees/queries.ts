import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { departments, employeeIdentities, employees } from '@/lib/db/schema';

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
};

/** Admin-only data; the caller must have checked the role. */
export async function getEmployeeAdminData() {
  const db = getDb();
  const [rows, departmentRows] = await Promise.all([
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
  ]);
  return {
    employees: rows.map(({ identityId, ...r }): EmployeeAdminRow => ({ ...r, bound: identityId !== null })),
    departments: departmentRows,
  };
}
