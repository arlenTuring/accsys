import type { SupabaseClient } from '@supabase/supabase-js';

export type CurrentEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  role: 'staff' | 'finance' | 'admin';
  isGeneralManager: boolean;
  isChairman: boolean;
};

export async function getCurrentEmployee(
  supabase: SupabaseClient
): Promise<CurrentEmployee | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return null;
  }

  const { data, error } = await supabase
    .from('employees')
    .select('id, employee_code, name, department_id, role, is_general_manager, is_chairman')
    .eq('google_email', user.email)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    employeeCode: data.employee_code,
    name: data.name,
    departmentId: data.department_id,
    role: data.role,
    isGeneralManager: data.is_general_manager,
    isChairman: data.is_chairman,
  };
}
