import { redirect } from 'next/navigation';
import { getEmployeeOptions } from '@/lib/asset-transfers/queries';
import { getAssetRegister } from '@/lib/assets/queries';
import { canMaintainRegister } from '@/lib/assets/service';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { AssetRegisterManager } from './asset-register-manager';

export default async function AssetsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!canMaintainRegister(employee)) redirect('/dashboard');
  const [register, employees] = await Promise.all([getAssetRegister(), getEmployeeOptions()]);

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">資產管理</p>
        <h1 className="page-title">財產保管清冊</h1>
        <p className="page-subtitle">核准的資產異動申請單會自動更新保管人、保管地點與狀態；新購財產或盤點更正請在此維護。</p>
      </section>
      <AssetRegisterManager register={register} employees={employees} />
    </main>
  );
}
