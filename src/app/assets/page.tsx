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
        <p className="section-title">財會管理 · 全公司資產</p>
        <h1 className="page-title">全公司財產保管清冊</h1>
        <p className="page-subtitle">此處管理全公司資產清冊（個人名下保管資產請點擊左下角個人帳號查看）；核准的資產異動單會自動更新保管人與狀態。</p>
        <p className="mt-2 flex flex-wrap gap-3 text-sm">
          <a className="underline" href="/assets/fields">
            欄位管理
          </a>
          <a className="underline" href="/assets/import">
            公司 Excel 匯入
          </a>
        </p>
      </section>
      <AssetRegisterManager register={register} employees={employees} />
    </main>
  );
}
