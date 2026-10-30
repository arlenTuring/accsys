import { redirect } from 'next/navigation';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { DEFAULT_COMPANY_CODE, getCompanyProfileByCode } from '@/lib/company/service';
import { CompanyForm } from './company-form';

export default async function CompanyAdminPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (!employee.permissions.includes('master_data.manage') && employee.role !== 'admin') {
    redirect('/dashboard');
  }

  const profile = await getCompanyProfileByCode(DEFAULT_COMPANY_CODE);

  return (
    <main className="page-shell space-y-6">
      <section>
        <p className="section-title">系統管理</p>
        <h1 className="page-title">公司資訊</h1>
        <p className="page-subtitle">
          設定發票買方統編比對用的公司名稱與統一編號。檢核碼正確不代表企業存在或發票可抵稅。未設定時仍可上傳附件，但會顯示「尚未設定公司資訊，無法比對」。
        </p>
      </section>
      <CompanyForm
        initial={
          profile
            ? {
                legalName: profile.legalName,
                taxId: profile.taxId,
                address: profile.address ?? '',
                nameAliases: profile.nameAliases.join('\n'),
                active: profile.active,
                version: profile.version,
              }
            : null
        }
      />
    </main>
  );
}
