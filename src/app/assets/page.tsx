import { redirect } from 'next/navigation';
import { getEmployeeOptions } from '@/lib/asset-transfers/queries';
import { getAssetRegister } from '@/lib/assets/queries';
import { canMaintainRegister } from '@/lib/assets/service';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { departments } from '@/lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import { getServerI18n } from '@/lib/i18n/server';
import { AssetRegisterManager } from './asset-register-manager';

export default async function AssetsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  // 一般員工點進 /assets 時自動導向「我的資產管理 (/assets/mine)」而非踢回首頁
  if (!canMaintainRegister(employee)) redirect('/assets/mine');

  const db = getDb();
  const [{ t }, register, employees, deptRows] = await Promise.all([
    getServerI18n(),
    getAssetRegister(),
    getEmployeeOptions(),
    db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.active, true))
      .orderBy(asc(departments.code)),
  ]);

  return (
    <main className="page-shell space-y-4">
      <section>
        <p className="section-title">{t.assetsPage.sectionTitle}</p>
        <h1 className="page-title">{t.assetsPage.title}</h1>
      </section>
      <AssetRegisterManager
        register={register}
        employees={employees}
        departments={deptRows}
      />
    </main>
  );
}
