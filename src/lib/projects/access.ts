import { sql, type SQL } from 'drizzle-orm';
import { projects } from '@/lib/db/schema';

/**
 * Projects an employee may use: every unrestricted project, plus restricted
 * ones that list the employee in project_members. Used by search, pickers,
 * the assistant and the formal submit check alike.
 */
export function projectUsableBy(employeeId: string | null | undefined): SQL {
  if (!employeeId) return sql`${projects.restricted} = false`;
  return sql`(${projects.restricted} = false or exists (select 1 from project_members pm where pm.project_id = ${projects.id} and pm.employee_id = ${employeeId}))`;
}
