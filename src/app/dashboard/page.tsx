import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  if (!employee) {
    redirect('/login?error=not_registered');
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">歡迎，{employee.name}</h1>
      <p className="mt-2 text-gray-600">
        工號：{employee.employeeCode}｜角色：{employee.role}
      </p>
      {employee.role === 'admin' && (
        <a href="/admin/master-data" className="mt-4 inline-block text-blue-600 underline">
          主檔資料總覽
        </a>
      )}
    </main>
  );
}
