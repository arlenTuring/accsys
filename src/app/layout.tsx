import type { Metadata } from 'next';
import './globals.css';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { TopNav } from '@/app/components/top-nav';

export const metadata: Metadata = {
  title: '台灣智慧駕駛 電子採購與簽核系統',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const employee = await getCurrentEmployee(supabase);

  return (
    <html lang="zh-Hant">
      <body>
        {employee && <TopNav employeeName={employee.name} />}
        {children}
      </body>
    </html>
  );
}
