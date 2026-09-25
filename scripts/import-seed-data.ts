import { config } from 'dotenv';
import { createAppDb } from '../src/lib/db/app-client';
import { parseSeedWorkbook } from './lib/parse-seed-workbook';

config({ path: '.env.local' });

const SEED_FILE = 'reference/20260709_請採驗費用申請單.xlsx';

async function main() {
  const db = createAppDb();
  const { employees, budgetCodes, suppliers } = await parseSeedWorkbook(SEED_FILE);

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
    const { error } = await db.from('departments').upsert({ code, name: dept.name }, { onConflict: 'code' });
    if (error) throw error;
  }

  const { data: departmentRows, error: departmentReadError } = await db
    .from('departments')
    .select('id, code');
  if (departmentReadError) throw departmentReadError;
  const departmentIdByCode = new Map(
    (departmentRows as { id: string; code: string }[]).map((d) => [d.code, d.id])
  );

  for (const emp of employees) {
    const departmentId = departmentIdByCode.get(emp.departmentCode);
    if (!departmentId) {
      console.warn(`跳過員工 ${emp.name}：找不到部門代碼 ${emp.departmentCode}`);
      continue;
    }

    const { error } = await db.from('employees').upsert(
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

  const { data: employeeRows, error: employeeReadError } = await db.from('employees').select('id, name');
  if (employeeReadError) throw employeeReadError;

  for (const [code, dept] of departmentByCode) {
    const departmentId = departmentIdByCode.get(code);
    const manager = (employeeRows as { id: string; name: string }[]).find((e) => e.name === dept.managerName);
    if (!manager) {
      console.warn(`跳過部門主管設定：部門 ${code} 找不到員工「${dept.managerName}」`);
      continue;
    }
    const { error } = await db.from('departments').update({ manager_employee_id: manager.id }).eq('id', departmentId);
    if (error) throw error;
  }

  const { data: refreshedDepartments, error: refreshedDeptError } = await db
    .from('departments')
    .select('id, code, manager_employee_id');
  if (refreshedDeptError) throw refreshedDeptError;
  const managerIdByDeptCode = new Map(
    (refreshedDepartments as { code: string; manager_employee_id: string | null }[]).map((d) => [
      d.code,
      d.manager_employee_id,
    ])
  );

  const uniqueBudgetCodes = new Map(budgetCodes.map((b) => [b.code, b]));
  let insertedBudgetCodeCount = 0;
  let importedProjectScopedBudgetCodeCount = 0;
  for (const budget of uniqueBudgetCodes.values()) {
    const departmentId = departmentIdByCode.get(budget.departmentCode);
    let projectId: string | null = null;
    if (!departmentId && budget.departmentCode) {
      const { error: projectError } = await db
        .from('projects')
        .upsert({ code: budget.departmentCode, name: budget.departmentCode }, { onConflict: 'code' });
      if (projectError) throw projectError;
      const { data: project } = await db.from('projects').select('id').eq('code', budget.departmentCode).maybeSingle();
      projectId = (project as { id: string } | null)?.id ?? null;
    }

    const { error } = await db.from('budget_codes').upsert(
      {
        code: budget.code,
        department_id: departmentId ?? null,
        project_id: projectId,
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
    const { error } = await db.from('suppliers').upsert(
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
      `提醒：${importedProjectScopedBudgetCodeCount} 個專案型預算編號目前沒有預算負責人，無法用於建立請購單，請在資料庫指定 owner_employee_id。`
    );
  }
  console.log(
    '提醒：所有員工預設角色為 staff，且尚未設定 google_email。請在資料庫手動：' +
      '(1) 補上每位員工的 google_email 才能登入，(2) 將財會與系統管理員設為 finance / admin。'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
