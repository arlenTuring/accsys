import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ACTIVE_ASSET_STATUSES, type AssetStatus } from '@/lib/asset-transfers/constants';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  assetTransferItems,
  assetTransfers,
  assets,
  budgetCodes,
  departments,
  employees,
  procurementCases,
  projects,
} from '@/lib/db/schema';

const FORM = 'asset_transfer' as const;

/** `managerId` is the manager of the employee's department (pre-fills the 保管單位主管 fields). */
export type EmployeeOption = { id: string; name: string; departmentName: string; managerId: string | null };
export type AssetOption = {
  id: string;
  tag: string;
  name: string;
  quantity: number;
  status: AssetStatus;
  custodianId: string;
  custodianName: string;
  location: string;
};
export type UsageBudgetOption = { id: string; label: string };

export type AssetTransferSummary = {
  id: string;
  caseNumber: string;
  status: string;
  applicationDate: string;
  firstAsset: string;
  lineCount: number;
  appliedAt: Date | null;
};

export type AssetTransferQueueItem = {
  formType: typeof FORM;
  id: string;
  caseNumber: string;
  applicantName: string;
  totalAmount: null;
};

export type AssetTransferDetail = {
  id: string;
  caseNumber: string;
  status: string;
  version: number;
  currentStepOrder: number | null;
  applicantEmployeeId: string;
  applicantName: string;
  departmentId: string;
  departmentName: string;
  useDepartmentId: string;
  useDepartmentName: string;
  useBudgetCodeId: string;
  useBudgetLabel: string;
  applicationDate: string;
  transferTypes: string[];
  remark: string | null;
  parties: {
    originalCustodian: { id: string; name: string };
    newCustodian: { id: string; name: string };
    otherCustodian: { id: string; name: string } | null;
    originalManager: { id: string; name: string };
    newManager: { id: string; name: string };
    otherManager: { id: string; name: string } | null;
  };
  appliedAt: Date | null;
  items: {
    lineNo: number;
    assetId: string;
    assetTag: string;
    assetName: string;
    quantity: number;
    originalCustodianName: string;
    originalLocation: string;
    reason: string;
    newCustodianEmployeeId: string;
    newCustodianName: string;
    newLocation: string;
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

export async function getEmployeeOptions(): Promise<EmployeeOption[]> {
  return getDb()
    .select({
      id: employees.id,
      name: employees.name,
      departmentName: departments.name,
      managerId: departments.managerEmployeeId,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.accessEnabled, true))
    .orderBy(asc(departments.name), asc(employees.name));
}

/** Assets still in the register, by 財產編號. */
export async function getAssetOptions(): Promise<AssetOption[]> {
  const rows = await getDb()
    .select({
      id: assets.id,
      tag: assets.tag,
      name: assets.name,
      quantity: assets.quantity,
      status: assets.status,
      custodianId: assets.custodianEmployeeId,
      custodianName: employees.name,
      location: assets.location,
    })
    .from(assets)
    .innerJoin(employees, eq(employees.id, assets.custodianEmployeeId))
    .where(inArray(assets.status, [...ACTIVE_ASSET_STATUSES]))
    .orderBy(asc(assets.tag));
  return rows.map((r) => ({ ...r, status: r.status as AssetStatus }));
}

/** "亞灣2.0：5G AIoT規模化加值體感育樂服務：劉君怡" — project codes first, then department codes. */
export async function getUsageBudgetOptions(): Promise<UsageBudgetOption[]> {
  const owner = alias(employees, 'owner');
  const rows = await getDb()
    .select({
      id: budgetCodes.id,
      code: budgetCodes.code,
      category: budgetCodes.category,
      departmentName: departments.name,
      projectName: projects.name,
      ownerName: owner.name,
    })
    .from(budgetCodes)
    .leftJoin(owner, eq(owner.id, budgetCodes.ownerEmployeeId))
    .leftJoin(departments, eq(departments.id, budgetCodes.departmentId))
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .orderBy(asc(budgetCodes.code));
  const base = (r: (typeof rows)[number]) => `${r.projectName ?? r.departmentName ?? r.code}：${r.ownerName ?? '未指定負責人'}`;
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(base(r), (seen.get(base(r)) ?? 0) + 1);
  return [...rows]
    .sort((a, b) => Number(!a.projectName) - Number(!b.projectName))
    .map((r) => ({ id: r.id, label: (seen.get(base(r)) ?? 0) > 1 ? `${base(r)}（${r.category}｜${r.code}）` : base(r) }));
}

export async function getMyAssetTransfers(): Promise<AssetTransferSummary[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: assetTransfers.id,
      caseNumber: procurementCases.caseNumber,
      status: assetTransfers.status,
      applicationDate: assetTransfers.applicationDate,
      appliedAt: assetTransfers.appliedAt,
    })
    .from(assetTransfers)
    .innerJoin(procurementCases, eq(procurementCases.id, assetTransfers.procurementCaseId))
    .where(eq(assetTransfers.applicantEmployeeId, employee.id))
    .orderBy(desc(assetTransfers.createdAt));
  if (rows.length === 0) return [];
  const lines = await db
    .select({ id: assetTransferItems.assetTransferId, tag: assetTransferItems.assetTag, name: assetTransferItems.assetName })
    .from(assetTransferItems)
    .where(
      inArray(
        assetTransferItems.assetTransferId,
        rows.map((r) => r.id)
      )
    )
    .orderBy(asc(assetTransferItems.lineNo));
  const byForm = new Map<string, { first: string; n: number }>();
  for (const l of lines) {
    const cur = byForm.get(l.id);
    if (cur) cur.n++;
    else byForm.set(l.id, { first: `${l.tag}｜${l.name}`, n: 1 });
  }
  return rows.map((r) => ({ ...r, firstAsset: byForm.get(r.id)?.first ?? '', lineCount: byForm.get(r.id)?.n ?? 0 }));
}

export async function getMyAssetTransferApprovalQueue(): Promise<AssetTransferQueueItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const applicant = alias(employees, 'applicant');
  const rows = await getDb()
    .select({ id: assetTransfers.id, caseNumber: procurementCases.caseNumber, applicantName: applicant.name })
    .from(approvalSteps)
    .innerJoin(assetTransfers, eq(assetTransfers.id, approvalSteps.formId))
    .innerJoin(procurementCases, eq(procurementCases.id, assetTransfers.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, assetTransfers.applicantEmployeeId))
    .where(
      and(
        eq(approvalSteps.formType, FORM),
        eq(approvalSteps.approverEmployeeId, employee.id),
        eq(approvalSteps.status, 'pending'),
        eq(assetTransfers.status, 'pending_approval'),
        eq(assetTransfers.currentStepOrder, approvalSteps.stepOrder)
      )
    )
    .orderBy(asc(assetTransfers.createdAt));
  return rows.map((r) => ({ ...r, formType: FORM, totalAmount: null }));
}

/** Assets the current employee holds (shown on the hub page to find 財產編號). */
export async function getMyCustodyAssets(): Promise<AssetOption[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  return (await getAssetOptions()).filter((a) => a.custodianId === employee.id);
}

export async function getAssetTransferDetail(id: string): Promise<AssetTransferDetail | null> {
  const actor = await getCurrentEmployee();
  if (!(await canReadForm(actor, FORM, id))) return null;
  const db = getDb();
  const applicant = alias(employees, 'applicant');
  const useDept = alias(departments, 'use_dept');
  const budgetDept = alias(departments, 'budget_dept');
  const owner = alias(employees, 'owner');
  const [row] = await db
    .select({
      form: assetTransfers,
      caseNumber: procurementCases.caseNumber,
      applicantName: applicant.name,
      departmentName: departments.name,
      useDepartmentName: useDept.name,
      budgetCode: budgetCodes.code,
      budgetProjectName: projects.name,
      budgetDeptName: budgetDept.name,
      ownerName: owner.name,
    })
    .from(assetTransfers)
    .innerJoin(procurementCases, eq(procurementCases.id, assetTransfers.procurementCaseId))
    .innerJoin(applicant, eq(applicant.id, assetTransfers.applicantEmployeeId))
    .innerJoin(departments, eq(departments.id, assetTransfers.departmentId))
    .innerJoin(useDept, eq(useDept.id, assetTransfers.useDepartmentId))
    .innerJoin(budgetCodes, eq(budgetCodes.id, assetTransfers.useBudgetCodeId))
    .leftJoin(projects, eq(projects.id, budgetCodes.projectId))
    .leftJoin(budgetDept, eq(budgetDept.id, budgetCodes.departmentId))
    .leftJoin(owner, eq(owner.id, budgetCodes.ownerEmployeeId))
    .where(eq(assetTransfers.id, id));
  if (!row) return null;
  const f = row.form;

  const originalCustodian = alias(employees, 'original_custodian');
  const newCustodian = alias(employees, 'new_custodian');
  const [lines, steps] = await Promise.all([
    db
      .select({
        item: assetTransferItems,
        originalCustodianName: originalCustodian.name,
        newCustodianName: newCustodian.name,
      })
      .from(assetTransferItems)
      .innerJoin(originalCustodian, eq(originalCustodian.id, assetTransferItems.originalCustodianEmployeeId))
      .innerJoin(newCustodian, eq(newCustodian.id, assetTransferItems.newCustodianEmployeeId))
      .where(eq(assetTransferItems.assetTransferId, id))
      .orderBy(asc(assetTransferItems.lineNo)),
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
      .where(and(eq(approvalSteps.formType, FORM), eq(approvalSteps.formId, id)))
      .orderBy(asc(approvalSteps.stepOrder)),
  ]);

  const partyIds = [
    f.originalCustodianEmployeeId,
    f.newCustodianEmployeeId,
    f.otherCustodianEmployeeId,
    f.originalManagerEmployeeId,
    f.newManagerEmployeeId,
    f.otherManagerEmployeeId,
  ].filter((v): v is string => v !== null);
  const names = new Map(
    (await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, partyIds))).map((e) => [
      e.id,
      e.name,
    ])
  );
  const person = (pid: string) => ({ id: pid, name: names.get(pid) ?? '—' });
  const maybe = (pid: string | null) => (pid ? person(pid) : null);

  return {
    id: f.id,
    caseNumber: row.caseNumber,
    status: f.status,
    version: f.version,
    currentStepOrder: f.currentStepOrder,
    applicantEmployeeId: f.applicantEmployeeId,
    applicantName: row.applicantName,
    departmentId: f.departmentId,
    departmentName: row.departmentName,
    useDepartmentId: f.useDepartmentId,
    useDepartmentName: row.useDepartmentName,
    useBudgetCodeId: f.useBudgetCodeId,
    useBudgetLabel: `${row.budgetProjectName ?? row.budgetDeptName ?? row.budgetCode}：${row.ownerName ?? '未指定負責人'}`,
    applicationDate: f.applicationDate,
    transferTypes: f.transferTypes,
    remark: f.remark,
    parties: {
      originalCustodian: person(f.originalCustodianEmployeeId),
      newCustodian: person(f.newCustodianEmployeeId),
      otherCustodian: maybe(f.otherCustodianEmployeeId),
      originalManager: person(f.originalManagerEmployeeId),
      newManager: person(f.newManagerEmployeeId),
      otherManager: maybe(f.otherManagerEmployeeId),
    },
    appliedAt: f.appliedAt,
    items: lines.map(({ item: i, originalCustodianName, newCustodianName }) => ({
      lineNo: i.lineNo,
      assetId: i.assetId,
      assetTag: i.assetTag,
      assetName: i.assetName,
      quantity: i.quantity,
      originalCustodianName,
      originalLocation: i.originalLocation,
      reason: i.reason,
      newCustodianEmployeeId: i.newCustodianEmployeeId,
      newCustodianName,
      newLocation: i.newLocation,
    })),
    steps,
  };
}
