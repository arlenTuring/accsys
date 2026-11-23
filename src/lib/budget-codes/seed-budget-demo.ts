import { ensureBudgetFormsPublished } from '@/lib/custom-forms/queries';

type SeedEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
};

const initializedEmployees = new Set<string>();

/**
 * 僅確保預算申請單與預算變更單的表單定義已發佈（不再自動塞入任何虛擬／範例預算派發通知、草稿或歷史紀錄）。
 */
export async function ensureEmployeeBudgetTasksAndHistory(
  employee: SeedEmployee
): Promise<void> {
  if (!employee?.id) return;
  if (initializedEmployees.has(employee.id)) return;
  try {
    await ensureBudgetFormsPublished(employee.id);
    initializedEmployees.add(employee.id);
  } catch (err) {
    console.warn('[ensureEmployeeBudgetTasksAndHistory] skipped:', err);
  }
}
