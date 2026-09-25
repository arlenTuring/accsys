import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export type NotificationRow = {
  id: string;
  type: string;
  formType: string;
  caseNumber: string;
  message: string;
  isRead: boolean;
  formId: string;
  createdAt: string;
};

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const { data } = await supabase
    .from('notifications')
    .select('id, type, form_type, case_number, message, is_read, form_id, created_at')
    .eq('recipient_employee_id', employee.id)
    .order('created_at', { ascending: false });
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    formType: n.form_type,
    caseNumber: n.case_number,
    message: n.message,
    isRead: n.is_read,
    formId: n.form_id,
    createdAt: n.created_at,
  }));
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee) return 0;
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_employee_id', employee.id)
    .eq('is_read', false);
  return count ?? 0;
}
