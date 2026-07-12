import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseSeedWorkbook } from './lib/parse-seed-workbook';
import { getRequiredEnv } from '../src/lib/env';

config({ path: '.env.local' });

const SEED_FILE = 'reference/20260709_請採驗費用申請單.xlsx';

async function main() {
  const supabase = createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  );

  const { employees, budgetCodes, suppliers } = parseSeedWorkbook(SEED_FILE);

  const departmentByCode = new Map<string, { name: string; managerName: string }>();
  for (const emp of employees) {
    if (!departmentByCode.has(emp.departmentCode)) {
      departmentByCode.set(emp.departmentCode, {
        name: emp.departmentName,
        managerName: emp.managerName,
      });
    }
  }

  for (const [code, dept] of departmentByCode) {
    const { error } = await supabase
      .from('departments')
      .upsert({ code, name: dept.name }, { onConflict: 'code' });
    if (error) throw error;
  }

  const { data: departmentRows, error: departmentReadError } = await supabase
    .from('departments')
    .select('id, code');
  if (departmentReadError) throw departmentReadError;
  const departmentIdByCode = new Map(departmentRows.map((d) => [d.code, d.id]));

  for (const emp of employees) {
    const departmentId = departmentIdByCode.get(emp.departmentCode);
    if (!departmentId) {
      console.warn(`跳過員工 ${emp.name}：找不到部門代碼 ${emp.departmentCode}`);
      continue;
    }

    const { error } = await supabase.from('employees').upsert(
      {
        employee_code: emp.employeeCode,
        name: emp.name,
        department_id: departmentId,
        title: emp.title,
        is_general_manager: emp.title === '執行長' || emp.title === '總經理',
        is_chairman: emp.title === '董事長',
      },
      { onConflict: 'employee_code' }
    );
    if (error) throw error;
  }

  const { data: employeeRows, error: employeeReadError } = await supabase
    .from('employees')
    .select('id, name');
  if (employeeReadError) throw employeeReadError;

  for (const [code, dept] of departmentByCode) {
    const departmentId = departmentIdByCode.get(code);
    const manager = employeeRows.find((e) => e.name === dept.managerName);
    if (!manager) {
      console.warn(`跳過部門主管設定：部門 ${code} 找不到員工「${dept.managerName}」`);
      continue;
    }
    const { error } = await supabase
      .from('departments')
      .update({ manager_employee_id: manager.id })
      .eq('id', departmentId);
    if (error) throw error;
  }

  const { data: refreshedDepartments, error: refreshedDeptError } = await supabase
    .from('departments')
    .select('id, code, manager_employee_id');
  if (refreshedDeptError) throw refreshedDeptError;
  const managerIdByDeptCode = new Map(
    refreshedDepartments.map((d) => [d.code, d.manager_employee_id])
  );

  const uniqueBudgetCodes = new Map(budgetCodes.map((b) => [b.code, b]));
  let insertedBudgetCodeCount = 0;
  let importedProjectScopedBudgetCodeCount = 0;
  for (const budget of uniqueBudgetCodes.values()) {
    const departmentId = departmentIdByCode.get(budget.departmentCode);
    const { error } = await supabase.from('budget_codes').upsert(
      {
        code: budget.code,
        department_id: departmentId ?? null,
        project_code: departmentId ? null : budget.departmentCode,
        category: budget.category,
        fiscal_year: budget.fiscalYear,
        annual_budget_amount: budget.annualBudgetAmount,
        owner_employee_id: departmentId ? (managerIdByDeptCode.get(budget.departmentCode) ?? null) : null,
      },
      { onConflict: 'code' }
    );
    if (error) throw error;
    insertedBudgetCodeCount += 1;
    if (!departmentId) importedProjectScopedBudgetCodeCount += 1;
  }

  for (const supplier of suppliers) {
    const { error } = await supabase.from('suppliers').upsert(
      {
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        contact_name: supplier.contactName,
      },
      { onConflict: 'name' }
    );
    if (error) throw error;
  }

  console.log(
    `匯入完成：${departmentByCode.size} 個部門、${employees.length} 位員工、${insertedBudgetCodeCount} 個預算編號（其中 ${importedProjectScopedBudgetCodeCount} 個為專案型）、${suppliers.length} 家供應商。`
  );
  if (importedProjectScopedBudgetCodeCount > 0) {
    console.log(
      `提醒：${importedProjectScopedBudgetCodeCount} 個專案型預算編號目前沒有預算負責人（owner_employee_id 為 null），無法用於建立請購單，需要有 admin 權限的人到 Supabase Studio 手動指定每一筆的負責人。`
    );
  }
  console.log(
    '提醒：所有員工預設角色為 staff，且尚未設定 google_email。請於 Supabase Studio 手動：' +
      '(1) 補上每位員工的 google_email 才能登入，(2) 將財會與系統管理員設為對應角色 (finance / admin)。'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
