import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';

export default async function MasterDataPage() {
  const employee = await getCurrentEmployee();

  if (!employee) {
    redirect('/login');
  }

  // 主檔資料已整合至「財會管理 → 預算管理平台 → 主檔管理」
  redirect('/budget-codes/projects');
}
