import type { Metadata } from 'next';
import { Inter, Noto_Sans_TC } from 'next/font/google';
import './globals.css';
import { getPendingApprovalCount } from '@/lib/approvals/pending-count';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { TopNav } from '@/app/components/top-nav';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansTc = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ACCSYS · 台灣智慧駕駛 電子採購與簽核',
  description: '台灣智慧駕駛內部電子採購與簽核系統',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();
  const pendingApprovalCount = employee ? await getPendingApprovalCount() : 0;

  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className={`${inter.variable} ${notoSansTc.variable} font-sans`} suppressHydrationWarning>
        {employee && <TopNav employee={employee} pendingApprovalCount={pendingApprovalCount} />}
        {children}
      </body>
    </html>
  );
}
