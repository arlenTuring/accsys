import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { departments, employees } from '@/lib/db/schema';

export type CurrentEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  title: string | null;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  role: 'staff' | 'finance' | 'admin';
  isGeneralManager: boolean;
  isChairman: boolean;
};

export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const session = await getSession();
  if (!session.email) return null;

  const rows = await getDb()
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      email: employees.googleEmail,
      title: employees.title,
      departmentId: employees.departmentId,
      departmentCode: departments.code,
      departmentName: departments.name,
      role: employees.role,
      isGeneralManager: employees.isGeneralManager,
      isChairman: employees.isChairman,
    })
    .from(employees)
    .innerJoin(departments, eq(employees.departmentId, departments.id))
    .where(eq(employees.googleEmail, session.email))
    .limit(1);

  const data = rows[0];
  if (!data || !data.email) return null;

  return {
    id: data.id,
    employeeCode: data.employeeCode,
    name: data.name,
    email: data.email,
    title: data.title,
    departmentId: data.departmentId,
    departmentCode: data.departmentCode,
    departmentName: data.departmentName,
    role: data.role as CurrentEmployee['role'],
    isGeneralManager: data.isGeneralManager,
    isChairman: data.isChairman,
  };
}
