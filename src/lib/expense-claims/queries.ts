import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { approvalSteps, budgetCodes, departments, employees, procurementCases, projects, suppliers } from '@/lib/db/schema';
import { EDITIONS, EXPENSE_EDITIONS, type ExpenseEdition, type ExpenseFormType } from '@/lib/expense-claims/editions';
import { canSeeRemittance, maskRemittance } from '@/lib/expense-claims/mask';
import { CLAIM_TABLES } from '@/lib/expense-claims/tables';

export type ExpenseClaimSummary = {
  edition: ExpenseEdition;
  id: string;
  caseNumber: string;
  status: string;
  applicationDate: string;
  departmentName: string;
  firstItem: string;
  lineCount: number;
  totalAmount: number;
  createdAt: Date;
};

export type ExpenseClaimQueueItem = {
  formType: ExpenseFormType;
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: number;
};

/** `scopeName` is the department of a department code (used to follow the 申請部門). */
export type ExpenseBudgetOption = { id: string; scopeName: string; label: string };
export type PayeeSupplierOption = { id: string; name: string };

export type ExpenseClaimDetail = {
  id: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentId: string;
  departmentName: string;
  budgetCodeId: string;
  budgetLabel: string;
  applicationDate: string;
  remark: string | null;
  payeeType: string;
  payeeSupplierId: string | null;
  payeeSupplierName: string | null;
  expectedPaymentDate: string;
  paymentMethod: string;
  remittanceInfo: string;
  totalAmount: string;
  items: {
    lineNo: number;
    category: string;
    description: string;
    currency: string;
    exchangeRate: string;
    amount: string;
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

/** "管理部：吳旭東" / "T0.9內部自研案：李明潔" — codes of the edition's scope; category added when the label repeats. */
export async function getExpenseBudgetOptions(edition: ExpenseEdition): Promise<ExpenseBudgetOption[]> {
  if (!(await getCurrentEmployee())) return [];
  const scope = EDITIONS[edition].budgetScope;
  const owner = alias(employees, 'owner');
  const rows = await getDb()
    .select({
      id: budgetCodes.id,
      code: budgetCodes.code,
      category: budgetCodes.category,
      departmentName: departments.name,
      projectName: projects.name,
      projectKind: projects.kind,
      ownerName: owner.name,
    })
    .from(budgetCodes)
    .innerJoin(owner, eq(owner.id, budgetCodes.ownerEmployeeId))
    .leftJoin(departments, eq(departments.id, budgetCodes.departmentId))
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .orderBy(asc(budgetCodes.code));
  const codes = rows
    .filter((c) => (scope === 'department' ? c.departmentName : c.projectKind === scope))
    .map((c) => ({ ...c, scopeName: (scope === 'department' ? c.departmentName : c.projectName)! }));
  const base = (c: (typeof codes)[number]) => `${c.scopeName}：${c.ownerName}`;
  const seen = new Map<string, number>();
  for (const c of codes) seen.set(base(c), (seen.get(base(c)) ?? 0) + 1);
  return codes.map((c) => ({
    id: c.id,
    scopeName: c.scopeName,
    label: (seen.get(base(c)) ?? 0) > 1 ? `${base(c)}（${c.category}｜${c.code}）` : base(c),
  }));
}

export function getDepartmentOptions(): Promise<{ id: string; name: string }[]> {
  return getDb().select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name));
}

export function getPayeeSupplierOptions(): Promise<PayeeSupplierOption[]> {
  return getDb().select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name));
}

async function myClaims(edition: ExpenseEdition, employeeId: string): Promise<ExpenseClaimSummary[]> {
  const db = getDb();
  const { header, items } = CLAIM_TABLES[edition];
  const rows = await db
    .select({
      id: header.id,
      caseNumber: procurementCases.caseNumber,
      status: header.status,
      applicationDate: header.applicationDate,
      departmentName: departments.name,
      totalAmount: header.totalAmount,
      createdAt: header.createdAt,
    })
    .from(header)
    .innerJoin(procurementCases, eq(procurementCases.id, header.procurementCaseId))
    .innerJoin(departments, eq(departments.id, header.departmentId))
    .where(eq(header.applicantEmployeeId, employeeId));
  if (rows.length === 0) return [];

  const lines = await db
    .select({ claimId: items.claimId, category: items.category, description: items.description })
    .from(items)
    .innerJoin(header, eq(header.id, items.claimId))
    .where(eq(header.applicantEmployeeId, employeeId))
    .orderBy(asc(items.lineNo));
  const byClaim = new Map<string, { first: string; n: number }>();
  for (const l of lines) {
    const cur = byClaim.get(l.claimId);
    if (cur) cur.n++;
    else byClaim.set(l.claimId, { first: `${l.category}｜${l.description}`, n: 1 });
  }

  return rows.map((r) => ({
    ...r,
    edition,
    firstItem: byClaim.get(r.id)?.first ?? '',
    lineCount: byClaim.get(r.id)?.n ?? 0,
    totalAmount: Number(r.totalAmount),
  }));
}

/** Both editions, newest first. */
export async function getMyExpenseClaims(): Promise<ExpenseClaimSummary[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const all = (await Promise.all(EXPENSE_EDITIONS.map((e) => myClaims(e, employee.id)))).flat();
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function approvalQueue(edition: ExpenseEdition, employeeId: string): Promise<ExpenseClaimQueueItem[]> {
  const { header } = CLAIM_TABLES[edition];
  const formType = EDITIONS[edition].formType;
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({
      id: header.id,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      totalAmount: header.totalAmount,
    })
    .from(approvalSteps)
    .innerJoin(header, eq(header.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, header.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, header.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, formType),
        eq(approvalSteps.approverEmployeeId, employeeId),
        eq(approvalSteps.status, 'pending'),
        eq(header.status, 'pending_approval'),
        eq(header.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(header.createdAt));
  return rows.map((r) => ({ ...r, formType, totalAmount: Number(r.totalAmount) }));
}

/** Both editions. */
export async function getMyExpenseClaimApprovalQueue(): Promise<ExpenseClaimQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  return (await Promise.all(EXPENSE_EDITIONS.map((e) => approvalQueue(e, employee.id)))).flat();
}

export async function getExpenseClaimDetail(edition: ExpenseEdition, id: string): Promise<ExpenseClaimDetail | null> {
  const formType = EDITIONS[edition].formType;
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, formType, id))) return null;
  const db = getDb();
  const { header, items } = CLAIM_TABLES[edition];
  const applicant = alias(employees, 'applicant');
  const owner = alias(employees, 'owner');
  const budgetDept = alias(departments, 'budget_dept');
  const [row] = await db
    .select({
      claim: header,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      departmentName: departments.name,
      ownerName: owner.name,
      budgetDeptName: budgetDept.name,
      budgetProjectName: projects.name,
      budgetCode: budgetCodes.code,
      supplierName: suppliers.name,
    })
    .from(header)
    .innerJoin(procurementCases, eq(procurementCases.id, header.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, header.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, header.departmentId))
    .innerJoin(owner, eq(owner.id, header.budgetOwnerEmployeeId))
    .innerJoin(budgetCodes, eq(budgetCodes.id, header.budgetCodeId))
    .leftJoin(budgetDept, eq(budgetDept.id, budgetCodes.departmentId))
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .leftJoin(suppliers, eq(suppliers.id, header.payeeSupplierId))
    .where(eq(header.id, id));
  if (!row) return null;

  const [lines, steps] = await Promise.all([
    db.select().from(items).where(eq(items.claimId, id)).orderBy(asc(items.lineNo)),
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
      .where(and(eq(approvalSteps.formType, formType), eq(approvalSteps.formId, id)))
      .orderBy(asc(approvalSteps.stepOrder)),
  ]);

  const c = row.claim;
  return {
    id: c.id,
    caseNumber: row.caseNumber,
    status: c.status,
    version: c.version,
    currentStepOrder: c.currentStepOrder,
    applicantEmployeeId: c.applicantEmployeeId,
    applicantName: row.applicantName,
    departmentId: c.departmentId,
    departmentName: row.departmentName,
    budgetCodeId: c.budgetCodeId,
    budgetLabel: `${row.budgetProjectName ?? row.budgetDeptName ?? row.budgetCode}：${row.ownerName}`,
    applicationDate: c.applicationDate,
    remark: c.remark,
    payeeType: c.payeeType,
    payeeSupplierId: c.payeeSupplierId,
    payeeSupplierName: row.supplierName,
    expectedPaymentDate: c.expectedPaymentDate,
    paymentMethod: c.paymentMethod,
    remittanceInfo: canSeeRemittance(actor, c.applicantEmployeeId) ? c.remittanceInfo : maskRemittance(c.remittanceInfo),
    totalAmount: c.totalAmount,
    items: lines.map((i) => ({
      lineNo: i.lineNo,
      category: i.category,
      description: i.description,
      currency: i.currency,
      exchangeRate: i.exchangeRate,
      amount: i.amount,
      twdAmount: i.twdAmount,
    })),
    steps,
  };
}
