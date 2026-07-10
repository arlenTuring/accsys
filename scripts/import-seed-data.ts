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
  let skippedProjectScopedBudgetCodeCount = 0;
  for (const budget of uniqueBudgetCodes.values()) {
    const departmentId = departmentIdByCode.get(budget.departmentCode);
    if (!departmentId) {
      skippedProjectScopedBudgetCodeCount += 1;
      continue;
    }
    const { error } = await supabase.from('budget_codes').upsert(
      {
        code: budget.code,
        department_id: departmentId,
        category: budget.category,
        fiscal_year: budget.fiscalYear,
        annual_budget_amount: budget.annualBudgetAmount,
        owner_employee_id: managerIdByDeptCode.get(budget.departmentCode) ?? null,
      },
      { onConflict: 'code' }
    );
    if (error) throw error;
    insertedBudgetCodeCount += 1;
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
    `匯入完成：${departmentByCode.size} 個部門、${employees.length} 位員工、${insertedBudgetCodeCount} 個預算編號、${suppliers.length} 家供應商。`
  );
  if (skippedProjectScopedBudgetCodeCount > 0) {
    console.log(
      `已略過 ${skippedProjectScopedBudgetCodeCount} 個專案型預算編號（部門代號欄位填的是專案代碼，不在 8 個部門代碼中）——這批專案預算的部門歸屬解析留待後續任務處理，本次匯入僅涵蓋部門型預算。`
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
