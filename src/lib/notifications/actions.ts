'use server';

import { revalidatePath } from 'next/cache';
import { createAppDb } from '@/lib/db/app-client';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { isUuid } from '@/lib/authz/forms';

export async function markNotificationRead(notificationId: string): Promise<void> {
  const supabase = createAppDb();
  const employee = await getCurrentEmployee();
  if (!employee || !isUuid(notificationId)) return;
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_employee_id', employee.id);
  revalidatePath('/notifications');
}
