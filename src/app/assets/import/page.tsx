import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canMaintainRegister } from '@/lib/assets/service';
import { PropertyImportClient } from './property-import-client';

export default async function AssetImportPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!canMaintainRegister(employee)) redirect('/dashboard');

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">資產管理</p>
        <h1 className="page-title">財產清冊匯入</h1>
        <p className="page-subtitle">
          使用公司工作表「1150630財產保管清冊」。先驗證與差異預覽，確認後才寫入；空白欄位預設不清除既有值；盤點欄寫入新批次。
        </p>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/assets">
            ← 返回清冊
          </Link>
        </p>
      </section>
      <PropertyImportClient />
    </main>
  );
}
