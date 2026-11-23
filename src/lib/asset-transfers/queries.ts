import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ACTIVE_ASSET_STATUSES, type AssetStatus } from '@/lib/asset-transfers/constants';
import { listInventoryHandoverForms } from '@/lib/assets/inventory-forms';
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
  formDefinitions,
  formSubmissionAssetLines,
  formSubmissions,
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
    .where(eq(budgetCodes.active, true))
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

export type AssetRecordKind = 'inventory' | 'transfer_in' | 'transfer_out';
export type AssetRecordStage = 'in_progress' | 'under_review' | 'archived';

export type AssetListRecordItem = {
  id: string;
  kind: AssetRecordKind;
  kindLabel: string;
  title: string;
  caseNumber: string;
  subtitle: string;
  stage: AssetRecordStage;
  statusLabel: string;
  dateText: string;
  sortTime: number;
  href: string;
};

/**
 * 財產清單紀錄：整合「盤點的單子」、「別人轉移給他的單子（轉入）」與「他轉移出去的單子（轉出）」，
 * 並區分為「執行中／審核中」與「歷史封存紀錄」。
 */
export async function getMyAssetListRecords(): Promise<AssetListRecordItem[]> {
  const employee = await getCurrentEmployee();
  if (!employee) return [];
  const db = getDb();

  const [handoverForms, empRows] = await Promise.all([
    listInventoryHandoverForms(employee),
    db.select({ id: employees.id, name: employees.name }).from(employees),
  ]);
  const empNameById = new Map(empRows.map((e) => [e.id, e.name]));

  const records: AssetListRecordItem[] = [];

  // 1. 盤點的單子（財產清點單）
  for (const f of handoverForms) {
    if (
      f.custodianEmployeeId !== employee.id &&
      f.inspectorEmployeeId !== employee.id
    ) {
      continue;
    }
    const isLocked = f.status === 'locked';
    const isCustodianDone =
      f.totalLines > 0 && f.custodianConfirmedLines >= f.totalLines;

    let stage: AssetRecordStage = 'in_progress';
    let statusLabel = '執行中';
    if (isLocked) {
      stage = 'archived';
      statusLabel = '已封存';
    } else if (isCustodianDone) {
      stage = 'under_review';
      statusLabel = '審核中';
    }

    const href =
      stage === 'in_progress' && f.custodianEmployeeId === employee.id
        ? `/assets/mine?handoverId=${encodeURIComponent(f.id)}`
        : `/assets/inventory-forms/${encodeURIComponent(f.id)}`;

    const dateIso = f.dispatchedAt || f.scheduledAt || '';
    const dateText = dateIso ? dateIso.slice(0, 10).replaceAll('-', '/') : '—';
    const parsedTime = Date.parse(dateIso);

    records.push({
      id: `inv-${f.id}`,
      kind: 'inventory',
      kindLabel: '盤點單',
      title: `【財產清點單 ${f.formNumber}】`,
      caseNumber: f.formNumber,
      subtitle: `共 ${f.totalLines} 項財產 · 保管人：${f.custodianName} · 清點人：${f.inspectorName}`,
      stage,
      statusLabel,
      dateText,
      sortTime: Number.isNaN(parsedTime) ? 0 : parsedTime,
      href,
    });
  }

  // 2. 舊版資產異動單（別人轉移給我 / 我轉移出去）
  const legacyTransfers = await db
    .select({
      id: assetTransfers.id,
      caseNumber: procurementCases.caseNumber,
      status: assetTransfers.status,
      applicationDate: assetTransfers.applicationDate,
      applicantEmployeeId: assetTransfers.applicantEmployeeId,
      originalCustodianEmployeeId: assetTransfers.originalCustodianEmployeeId,
      newCustodianEmployeeId: assetTransfers.newCustodianEmployeeId,
      otherCustodianEmployeeId: assetTransfers.otherCustodianEmployeeId,
      createdAt: assetTransfers.createdAt,
    })
    .from(assetTransfers)
    .innerJoin(
      procurementCases,
      eq(procurementCases.id, assetTransfers.procurementCaseId)
    )
    .where(
      or(
        eq(assetTransfers.applicantEmployeeId, employee.id),
        eq(assetTransfers.originalCustodianEmployeeId, employee.id),
        eq(assetTransfers.newCustodianEmployeeId, employee.id),
        eq(assetTransfers.otherCustodianEmployeeId, employee.id)
      )
    )
    .orderBy(desc(assetTransfers.createdAt));

  if (legacyTransfers.length > 0) {
    const legacyLines = await db
      .select({
        transferId: assetTransferItems.assetTransferId,
        tag: assetTransferItems.assetTag,
        name: assetTransferItems.assetName,
        origId: assetTransferItems.originalCustodianEmployeeId,
        newId: assetTransferItems.newCustodianEmployeeId,
      })
      .from(assetTransferItems)
      .where(
        inArray(
          assetTransferItems.assetTransferId,
          legacyTransfers.map((t) => t.id)
        )
      )
      .orderBy(asc(assetTransferItems.lineNo));

    const linesByTransfer = new Map<string, typeof legacyLines>();
    for (const l of legacyLines) {
      const arr = linesByTransfer.get(l.transferId) ?? [];
      arr.push(l);
      linesByTransfer.set(l.transferId, arr);
    }

    for (const t of legacyTransfers) {
      const tLines = linesByTransfer.get(t.id) ?? [];
      const firstLine = tLines[0];
      const assetSummary = firstLine
        ? `${firstLine.tag} ${firstLine.name}${tLines.length > 1 ? `（等 ${tLines.length} 項）` : ''}`
        : '資產異動';

      const isIncoming =
        (t.newCustodianEmployeeId === employee.id ||
          tLines.some((l) => l.newId === employee.id)) &&
        t.originalCustodianEmployeeId !== employee.id &&
        !tLines.some((l) => l.origId === employee.id);

      const kind: AssetRecordKind = isIncoming ? 'transfer_in' : 'transfer_out';
      const kindLabel = isIncoming ? '別人轉移給我' : '我轉移出去';

      const origName =
        empNameById.get(t.originalCustodianEmployeeId) ?? '原保管人';
      const newName = empNameById.get(t.newCustodianEmployeeId) ?? '新保管人';

      let stage: AssetRecordStage = 'under_review';
      let statusLabel = '審核中';
      if (t.status === 'draft' || t.status === 'returned') {
        stage = 'in_progress';
        statusLabel = t.status === 'returned' ? '執行中（退回修改）' : '執行中';
      } else if (t.status === 'pending_approval') {
        stage = 'under_review';
        statusLabel = '審核中';
      } else {
        stage = 'archived';
        statusLabel =
          t.status === 'approved'
            ? '已封存（已核准）'
            : t.status === 'rejected'
              ? '已駁回'
              : '已撤回';
      }

      records.push({
        id: `leg-${t.id}`,
        kind,
        kindLabel,
        title: `【資產異動單 ${t.caseNumber}】`,
        caseNumber: t.caseNumber,
        subtitle: `${assetSummary} · ${origName} → ${newName}`,
        stage,
        statusLabel,
        dateText: t.applicationDate.replaceAll('-', '/'),
        sortTime: t.createdAt.getTime(),
        href: `/asset-transfers/${t.id}`,
      });
    }
  }

  // 3. 新版表單引擎之資產異動單（別人轉移給我 / 我轉移出去）
  const customLinesForMe = await db
    .select({ submissionId: formSubmissionAssetLines.submissionId })
    .from(formSubmissionAssetLines)
    .where(
      or(
        eq(formSubmissionAssetLines.originalCustodianEmployeeId, employee.id),
        eq(formSubmissionAssetLines.newCustodianEmployeeId, employee.id)
      )
    );
  const matchedSubIds = [
    ...new Set(customLinesForMe.map((x) => x.submissionId)),
  ];

  const customSubs = await db
    .select({
      id: formSubmissions.id,
      formKey: formDefinitions.key,
      formNumber: formSubmissions.formNumber,
      status: formSubmissions.status,
      applicantEmployeeId: formSubmissions.applicantEmployeeId,
      filedByEmployeeId: formSubmissions.filedByEmployeeId,
      data: formSubmissions.data,
      createdAt: formSubmissions.createdAt,
    })
    .from(formSubmissions)
    .innerJoin(
      formDefinitions,
      eq(formDefinitions.id, formSubmissions.definitionId)
    )
    .where(
      and(
        eq(formDefinitions.legacyFormType, 'asset_transfer'),
        matchedSubIds.length > 0
          ? or(
              eq(formSubmissions.applicantEmployeeId, employee.id),
              eq(formSubmissions.filedByEmployeeId, employee.id),
              inArray(formSubmissions.id, matchedSubIds)
            )
          : or(
              eq(formSubmissions.applicantEmployeeId, employee.id),
              eq(formSubmissions.filedByEmployeeId, employee.id)
            )
      )
    )
    .orderBy(desc(formSubmissions.createdAt));

  if (customSubs.length > 0) {
    const allCustomLines = await db
      .select({
        submissionId: formSubmissionAssetLines.submissionId,
        tag: formSubmissionAssetLines.assetTag,
        name: formSubmissionAssetLines.assetName,
        origId: formSubmissionAssetLines.originalCustodianEmployeeId,
        newId: formSubmissionAssetLines.newCustodianEmployeeId,
      })
      .from(formSubmissionAssetLines)
      .where(
        inArray(
          formSubmissionAssetLines.submissionId,
          customSubs.map((s) => s.id)
        )
      )
      .orderBy(asc(formSubmissionAssetLines.lineNo));

    const linesBySub = new Map<string, typeof allCustomLines>();
    for (const l of allCustomLines) {
      const arr = linesBySub.get(l.submissionId) ?? [];
      arr.push(l);
      linesBySub.set(l.submissionId, arr);
    }

    for (const s of customSubs) {
      const sLines = linesBySub.get(s.id) ?? [];
      const dataObj = (s.data ?? {}) as Record<string, unknown>;
      const dataOrigId =
        typeof dataObj.originalCustodianEmployeeId === 'string'
          ? dataObj.originalCustodianEmployeeId
          : '';
      const dataNewId =
        typeof dataObj.newCustodianEmployeeId === 'string'
          ? dataObj.newCustodianEmployeeId
          : '';

      const isRelevant =
        s.applicantEmployeeId === employee.id ||
        s.filedByEmployeeId === employee.id ||
        dataOrigId === employee.id ||
        dataNewId === employee.id ||
        sLines.some(
          (l) => l.origId === employee.id || l.newId === employee.id
        );
      if (!isRelevant) continue;

      const isIncoming =
        (dataNewId === employee.id ||
          sLines.some((l) => l.newId === employee.id)) &&
        dataOrigId !== employee.id &&
        !sLines.some((l) => l.origId === employee.id);

      const kind: AssetRecordKind = isIncoming ? 'transfer_in' : 'transfer_out';
      const kindLabel = isIncoming ? '別人轉移給我' : '我轉移出去';

      const firstLine = sLines[0];
      const assetSummary = firstLine
        ? `${firstLine.tag} ${firstLine.name}${sLines.length > 1 ? `（等 ${sLines.length} 項）` : ''}`
        : '資產異動';

      const origName =
        empNameById.get(firstLine?.origId || dataOrigId) ?? '原保管人';
      const newName =
        empNameById.get(firstLine?.newId || dataNewId) ?? '新保管人';

      let stage: AssetRecordStage = 'under_review';
      let statusLabel = '審核中';
      if (s.status === 'draft' || s.status === 'returned') {
        stage = 'in_progress';
        statusLabel = s.status === 'returned' ? '執行中（退回修改）' : '執行中';
      } else if (s.status === 'pending_approval') {
        stage = 'under_review';
        statusLabel = '審核中';
      } else {
        stage = 'archived';
        statusLabel =
          s.status === 'approved'
            ? '已封存（已核准）'
            : s.status === 'rejected'
              ? '已駁回'
              : '已撤回';
      }

      records.push({
        id: `cus-${s.id}`,
        kind,
        kindLabel,
        title: `【資產異動單 ${s.formNumber}】`,
        caseNumber: s.formNumber,
        subtitle: `${assetSummary} · ${origName} → ${newName}`,
        stage,
        statusLabel,
        dateText: s.createdAt.toISOString().slice(0, 10).replaceAll('-', '/'),
        sortTime: s.createdAt.getTime(),
        href: `/f/${s.formKey}/${s.id}`,
      });
    }
  }

  return records.sort((a, b) => b.sortTime - a.sortTime);
}

