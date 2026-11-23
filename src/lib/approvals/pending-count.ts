import { and, eq } from 'drizzle-orm';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
import { listInventoryHandoverForms } from '@/lib/assets/inventory-forms';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { ensureVirtualAndDemoDataPurged } from '@/lib/db/purge-virtual-demo';
import {
  acceptances,
  assetTransfers,
  contractSealRequests,
  departmentExpenses,
  expenseRequests,
  formDrafts,
  formSubmissions,
  generalSealRequests,
  invoiceSealRequests,
  minorExpenses,
  notifications,
  projectExpenses,
  purchaseOrders,
  purchaseRequests,
  revenueExpenses,
  travelExpenses,
} from '@/lib/db/schema';
import {
  activateDueSurveys,
  listPendingSurveysForEmployee,
} from '@/lib/surveys/service';

export type MyTaskCounts = {
  /** 簽核與單據追蹤：待我簽核 + 被退回需我修改補件的單據數 */
  approvalsAndReturned: number;
  /** 年度預算表填報：未讀的預算編列派發通知 + 進行中的預算申請/變更草稿數 */
  budgetTasks: number;
  /** 我的資產管理：待我確認的財產清點單張數 */
  assetHandovers: number;
  /** 我的專屬問卷：待我填寫的問卷數 */
  pendingSurveys: number;
  /** 全部待處理事項加總（用於最左側主導覽列徽章） */
  total: number;
};

async function countReturnedForEmployee(employeeId: string): Promise<number> {
  const db = getDb();
  const [
    pr,
    po,
    acc,
    er,
    te,
    de,
    pe,
    re,
    me,
    csr,
    gsr,
    isr,
    at,
    fs,
  ] = await Promise.all([
    db
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.applicantEmployeeId, employeeId),
          eq(purchaseRequests.status, 'returned')
        )
      ),
    db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.applicantEmployeeId, employeeId),
          eq(purchaseOrders.status, 'returned')
        )
      ),
    db
      .select({ id: acceptances.id })
      .from(acceptances)
      .where(
        and(
          eq(acceptances.applicantEmployeeId, employeeId),
          eq(acceptances.status, 'returned')
        )
      ),
    db
      .select({ id: expenseRequests.id })
      .from(expenseRequests)
      .where(
        and(
          eq(expenseRequests.applicantEmployeeId, employeeId),
          eq(expenseRequests.status, 'returned')
        )
      ),
    db
      .select({ id: travelExpenses.id })
      .from(travelExpenses)
      .where(
        and(
          eq(travelExpenses.applicantEmployeeId, employeeId),
          eq(travelExpenses.status, 'returned')
        )
      ),
    db
      .select({ id: departmentExpenses.id })
      .from(departmentExpenses)
      .where(
        and(
          eq(departmentExpenses.applicantEmployeeId, employeeId),
          eq(departmentExpenses.status, 'returned')
        )
      ),
    db
      .select({ id: projectExpenses.id })
      .from(projectExpenses)
      .where(
        and(
          eq(projectExpenses.applicantEmployeeId, employeeId),
          eq(projectExpenses.status, 'returned')
        )
      ),
    db
      .select({ id: revenueExpenses.id })
      .from(revenueExpenses)
      .where(
        and(
          eq(revenueExpenses.applicantEmployeeId, employeeId),
          eq(revenueExpenses.status, 'returned')
        )
      ),
    db
      .select({ id: minorExpenses.id })
      .from(minorExpenses)
      .where(
        and(
          eq(minorExpenses.applicantEmployeeId, employeeId),
          eq(minorExpenses.status, 'returned')
        )
      ),
    db
      .select({ id: contractSealRequests.id })
      .from(contractSealRequests)
      .where(
        and(
          eq(contractSealRequests.applicantEmployeeId, employeeId),
          eq(contractSealRequests.status, 'returned')
        )
      ),
    db
      .select({ id: generalSealRequests.id })
      .from(generalSealRequests)
      .where(
        and(
          eq(generalSealRequests.applicantEmployeeId, employeeId),
          eq(generalSealRequests.status, 'returned')
        )
      ),
    db
      .select({ id: invoiceSealRequests.id })
      .from(invoiceSealRequests)
      .where(
        and(
          eq(invoiceSealRequests.applicantEmployeeId, employeeId),
          eq(invoiceSealRequests.status, 'returned')
        )
      ),
    db
      .select({ id: assetTransfers.id })
      .from(assetTransfers)
      .where(
        and(
          eq(assetTransfers.applicantEmployeeId, employeeId),
          eq(assetTransfers.status, 'returned')
        )
      ),
    db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(
        and(
          eq(formSubmissions.applicantEmployeeId, employeeId),
          eq(formSubmissions.status, 'returned')
        )
      ),
  ]);

  return (
    pr.length +
    po.length +
    acc.length +
    er.length +
    te.length +
    de.length +
    pe.length +
    re.length +
    me.length +
    csr.length +
    gsr.length +
    isr.length +
    at.length +
    fs.length
  );
}

export async function getPendingApprovalCount(): Promise<number> {
  return (await getMyApprovalQueueAll()).length;
}

export async function getMyTaskCounts(): Promise<MyTaskCounts> {
  await ensureVirtualAndDemoDataPurged().catch(() => {});
  const employee = await getCurrentEmployee();
  if (!employee) {
    return {
      approvalsAndReturned: 0,
      budgetTasks: 0,
      assetHandovers: 0,
      pendingSurveys: 0,
      total: 0,
    };
  }

  await activateDueSurveys().catch(() => {});

  const db = getDb();

  const { getSystemFeatureFlags } = await import('@/lib/feature-flags/service');
  const [
    featureFlags,
    approvalQueue,
    returnedCount,
    handoverForms,
    pendingSurveys,
    unreadBudgetNotices,
  ] = await Promise.all([
    getSystemFeatureFlags(),
    getMyApprovalQueueAll().catch(() => []),
    countReturnedForEmployee(employee.id).catch(() => 0),
    listInventoryHandoverForms(employee).catch(() => []),
    listPendingSurveysForEmployee({
      employeeId: employee.id,
      departmentId: employee.departmentId,
    }).catch(() => []),
    db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientEmployeeId, employee.id),
          eq(notifications.formType, 'budget_dispatch'),
          eq(notifications.isRead, false)
        )
      )
      .catch(() => []),
  ]);

  const openHandoverCount = handoverForms.filter(
    (f) =>
      f.status === 'open' &&
      f.custodianEmployeeId === employee.id &&
      f.custodianConfirmedLines < f.totalLines
  ).length;

  const approvalsAndReturned = approvalQueue.length + returnedCount;
  const budgetTasks = featureFlags.budget_management_platform
    ? unreadBudgetNotices.length
    : 0;
  const assetHandovers = featureFlags.asset_management_module
    ? openHandoverCount
    : 0;
  const surveyCount = featureFlags.company_info_hub
    ? pendingSurveys.length
    : 0;

  return {
    approvalsAndReturned,
    budgetTasks,
    assetHandovers,
    pendingSurveys: surveyCount,
    total: approvalsAndReturned + budgetTasks + assetHandovers + surveyCount,
  };
}

