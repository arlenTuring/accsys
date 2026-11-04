import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { actorHas } from '@/lib/authz/access';
import { listAssetFieldDefinitions, countFilledAssetValues } from '@/lib/assets/fields/service';
import { AssetFieldManager } from './asset-field-manager';

export default async function AssetFieldsPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  const allowed =
    (await actorHas(employee, 'finance.assets_fields')) || (await actorHas(employee, 'finance.assets'));
  if (!allowed) redirect('/dashboard');

  const fields = await listAssetFieldDefinitions({ includeHidden: true, includeDeleted: false });
  const withCounts = await Promise.all(
    fields.map(async (f) => ({ ...f, filledCount: await countFilledAssetValues(f.id) }))
  );

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">資產管理</p>
        <h1 className="page-title">資產欄位管理</h1>
        <p className="page-subtitle">
          新增、調整、隱藏與恢復清冊欄位。欄位改名不改 ID；隱藏會保留資料。永久刪除另有權限與確認流程。
        </p>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/assets">
            ← 返回財產保管清冊
          </Link>
        </p>
      </section>
      <AssetFieldManager initialFields={withCounts} />
    </main>
  );
}
