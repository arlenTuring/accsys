import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getMyApprovalQueue } from '@/lib/purchase-requests/queries';
import { getUnreadNotificationCount } from '@/lib/notifications/queries';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  if (!employee) {
    redirect('/login?error=not_registered');
  }

  const [queue, unread] = await Promise.all([
    getMyApprovalQueue(),
    getUnreadNotificationCount(),
  ]);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">歡迎，{employee.name}</h1>
      <p className="mt-2 text-gray-600">
        工號：{employee.employeeCode}｜角色：{employee.role}
      </p>

      <nav className="mt-6 flex flex-col gap-2">
        <Link href="/requests/new" className="text-blue-600 underline">
          新增請購單
        </Link>
        <Link href="/requests" className="text-blue-600 underline">
          我的請購單
        </Link>
        <Link href="/approvals" className="text-blue-600 underline">
          待我簽核（{queue.length}）
        </Link>
        <Link href="/notifications" className="text-blue-600 underline">
          通知（未讀 {unread}）
        </Link>
        {employee.role === 'admin' && (
          <Link href="/admin/master-data" className="text-blue-600 underline">
            主檔資料總覽
          </Link>
        )}
      </nav>
    </main>
  );
}
