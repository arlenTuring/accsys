import { and, asc, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  budgetCodes,
  departments,
  employees,
  procurementCases,
  projects,
  travelExpenseCostItems,
  travelExpenseReportItems,
  travelExpenses,
} from '@/lib/db/schema';

export type TravelExpenseSummary = {
  id: string;
  caseNumber: string;
  status: string;
  formDate: string;
  tripStartDate: string;
  tripEndDate: string;
  purpose: string;
  totalAmount: number;
};

export type TravelExpenseQueueItem = { id: string; caseNumber: string; applicantName: string; totalAmount: number };

export type TravelBudgetOption = { id: string; label: string };

export type TravelExpenseDetail = {
  id: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentName: string;
  budgetCodeId: string;
  budgetLabel: string;
  formDate: string;
  advanceAmount: string;
  tripStartDate: string;
  tripEndDate: string;
  purpose: string;
  tripOrderNo: string;
  companions: string;
  totalAmount: string;
  reportItems: { lineNo: number; tripDate: string; location: string; itinerary: string; timeSlot: string }[];
  costItems: {
    lineNo: number;
    expenseDate: string;
    category: string;
    fromStation: string | null;
    toStation: string | null;
    mileage: string | null;
    summary: string;
    currency: string;
    amount: string;
    exchangeRate: string;
    twdAmount: string;
  }[];
  steps: {
    stepOrder: number;
    approverEmployeeId: string | null;
    approverName: string;
    approverRole: string;
    status: string;
    comment: string | null;
  }[];
};

/** "高雄自駕車：劉君怡" — project (or department) and budget owner; category added when the label repeats. */
export async function getTravelBudgetOptions(): Promise<TravelBudgetOption[]> {
  const codes = (await getBudgetCodeList()).filter((c) => c.ownerName);
  const base = (c: (typeof codes)[number]) => `${c.projectName ?? c.departmentName ?? c.code}：${c.ownerName}`;
  const seen = new Map<string, number>();
  for (const c of codes) seen.set(base(c), (seen.get(base(c)) ?? 0) + 1);
  return codes.map((c) => ({
    id: c.id,
    label: (seen.get(base(c)) ?? 0) > 1 ? `${base(c)}（${c.category}｜${c.code}）` : base(c),
  }));
}

export async function getMyTravelExpenses(): Promise<TravelExpenseSummary[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const rows = await getDb()
    .select({
      id: travelExpenses.id,
      caseNumber: procurementCases.caseNumber,
      status: travelExpenses.status,
      formDate: travelExpenses.formDate,
      tripStartDate: travelExpenses.tripStartDate,
      tripEndDate: travelExpenses.tripEndDate,
      purpose: travelExpenses.purpose,
      totalAmount: travelExpenses.totalAmount,
    })
    .from(travelExpenses)
    .innerJoin(procurementCases, eq(procurementCases.id, travelExpenses.procurementCaseId))
    .where(eq(travelExpenses.applicantEmployeeId, employee.id))
    .orderBy(desc(travelExpenses.createdAt));
  return rows.map((r) => ({ ...r, totalAmount: Number(r.totalAmount) }));
}

export async function getMyTravelExpenseApprovalQueue(): Promise<TravelExpenseQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({
      id: travelExpenses.id,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      totalAmount: travelExpenses.totalAmount,
    })
    .from(approvalSteps)
    .innerJoin(travelExpenses, eq(travelExpenses.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, travelExpenses.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, travelExpenses.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, 'travel_expense'),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(travelExpenses.status, 'pending_approval'),
        eq(travelExpenses.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(travelExpenses.createdAt));
  return rows.map((r) => ({ ...r, totalAmount: Number(r.totalAmount) }));
}

export async function getTravelExpenseDetail(id: string): Promise<TravelExpenseDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, 'travel_expense', id))) return null;
  const db = getDb();
  const applicant = alias(employees, 'applicant');
  const owner = alias(employees, 'owner');
  const [row] = await db
    .select({
      te: travelExpenses,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      departmentName: departments.name,
      ownerName: owner.name,
      projectName: projects.name,
      budgetCode: budgetCodes.code,
    })
    .from(travelExpenses)
    .innerJoin(procurementCases, eq(procurementCases.id, travelExpenses.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, travelExpenses.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, travelExpenses.departmentId))
    .innerJoin(owner, eq(owner.id, travelExpenses.budgetOwnerEmployeeId))
    .innerJoin(budgetCodes, eq(budgetCodes.id, travelExpenses.budgetCodeId))
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .where(eq(travelExpenses.id, id));
  if (!row) return null;

  let budgetScope = row.projectName;
  if (!budgetScope) {
    const [codeRow] = await db
      .select({ name: departments.name })
      .from(budgetCodes)
      .innerJoin(departments, eq(departments.id, budgetCodes.departmentId))
      .where(eq(budgetCodes.id, row.te.budgetCodeId));
    budgetScope = codeRow?.name ?? row.budgetCode;
  }

  const [reportItems, costItems, steps] = await Promise.all([
    db
      .select()
      .from(travelExpenseReportItems)
      .where(eq(travelExpenseReportItems.travelExpenseId, id))
      .orderBy(asc(travelExpenseReportItems.lineNo)),
    db
      .select()
      .from(travelExpenseCostItems)
      .where(eq(travelExpenseCostItems.travelExpenseId, id))
      .orderBy(asc(travelExpenseCostItems.lineNo)),
    db
      .select({
        stepOrder: approvalSteps.stepOrder,
        approverEmployeeId: approvalSteps.approverEmployeeId,
        approverName: employees.name,
        approverRole: approvalSteps.approverRole,
        status: approvalSteps.status,
        comment: approvalSteps.comment,
      })
      .from(approvalSteps)
      .innerJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
      .where(and(eq(approvalSteps.formType, 'travel_expense'), eq(approvalSteps.formId, id)))
      .orderBy(asc(approvalSteps.stepOrder)),
  ]);

  const te = row.te;
  return {
    id: te.id,
    caseNumber: row.caseNumber,
    status: te.status,
    version: te.version,
    currentStepOrder: te.currentStepOrder,
    applicantEmployeeId: te.applicantEmployeeId,
    applicantName: row.applicantName,
    departmentName: row.departmentName,
    budgetCodeId: te.budgetCodeId,
    budgetLabel: `${budgetScope}：${row.ownerName}`,
    formDate: te.formDate,
    advanceAmount: te.advanceAmount,
    tripStartDate: te.tripStartDate,
    tripEndDate: te.tripEndDate,
    purpose: te.purpose,
    tripOrderNo: te.tripOrderNo,
    companions: te.companions,
    totalAmount: te.totalAmount,
    reportItems: reportItems.map((r) => ({
      lineNo: r.lineNo,
      tripDate: r.tripDate,
      location: r.location,
      itinerary: r.itinerary,
      timeSlot: r.timeSlot,
    })),
    costItems: costItems.map((c) => ({
      lineNo: c.lineNo,
      expenseDate: c.expenseDate,
      category: c.category,
      fromStation: c.fromStation,
      toStation: c.toStation,
      mileage: c.mileage,
      summary: c.summary,
      currency: c.currency,
      amount: c.amount,
      exchangeRate: c.exchangeRate,
      twdAmount: c.twdAmount,
    })),
    steps,
  };
}
