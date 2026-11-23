import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  enrichWithSnapshots,
  formatWaitingDuration,
  type ApprovalProgress,
} from '@/lib/ai-chat/approval-snapshot';
import { factsFor, loadFormFacts } from '@/lib/ai-chat/form-facts';
import {
  APPLICATION_CATEGORY_LABELS,
  type MyApplicationCategoryKey,
} from '@/lib/applications/my-applications';
import { getDb } from '@/lib/db';
import {
  acceptances,
  approvalSteps,
  assetTransfers,
  contractSealRequests,
  departmentExpenses,
  departments,
  employees,
  expenseRequests,
  formCategories,
  formDefinitions,
  formSubmissions,
  generalSealRequests,
  invoiceSealRequests,
  minorExpenses,
  procurementCases,
  projectExpenses,
  purchaseOrders,
  purchaseRequests,
  revenueExpenses,
  travelExpenses,
} from '@/lib/db/schema';
import {
  loadEmailApprovalDocumentSummary,
  type EmailApprovalDocumentSummary,
} from '@/lib/email/submission-detail-html';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';

export type CompanyApprovalTrackingStatusTab =
  | 'all'
  | 'pending_approval'
  | 'returned'
  | 'approved'
  | 'withdrawn';

export type CompanyApprovalTrackingItem = {
  id: string;
  formType: FormType;
  formKey?: string;
  formLabel: string;
  categoryKey: MyApplicationCategoryKey;
  categoryLabel: string;
  caseNumber: string;
  procurementCaseNumber: string | null;
  applicantId: string;
  applicantName: string;
  departmentCode: string;
  departmentName: string;
  status: string;
  totalAmount: number | null;
  currency?: string;
  dateLabel: string;
  dateIso: string;
  sortTimestamp: number;
  href: string;
  summary: string;
  progress: ApprovalProgress | null;
  currentNodeLabel: string | null;
  pendingApproverNames: string[];
  waitingFor: string | null;
  returnReason: string | null;
  returnedByName: string | null;
  /** Preloaded inner content & step-by-step approval records for instant expansion */
  detail: EmailApprovalDocumentSummary | null;
};

const fmtDate = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const fmtIsoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDateObj(d: Date | string | null | undefined): Date {
  if (!d) return new Date();
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function mapCustomCategoryKey(rawKey: string | undefined, formKey: string): MyApplicationCategoryKey {
  if (formKey === 'standalone-payment') {
    return 'expense';
  }
  if (
    rawKey === 'procurement' ||
    formKey.includes('purchase') ||
    formKey === 'acceptance' ||
    formKey === 'procurement-payment'
  ) {
    return 'procurement';
  }
  if (
    rawKey === 'expense' ||
    formKey.includes('expense') ||
    formKey.includes('payment') ||
    formKey.includes('trip')
  ) {
    return 'expense';
  }
  if (rawKey === 'seal' || formKey.includes('seal')) {
    return 'seal';
  }
  if (rawKey === 'asset' || formKey.includes('asset')) {
    return 'asset';
  }
  return 'other';
}

export async function getAllCompanyApprovalDocuments(options?: {
  preloadDetailsLimit?: number;
}): Promise<CompanyApprovalTrackingItem[]> {
  const db = getDb();
  const preloadLimit = options?.preloadDetailsLimit ?? 50;

  // 1. Query all custom form submissions across the entire company
  const [
    customRows,
    prRows,
    poRows,
    accRows,
    erRows,
    deptExpRows,
    projExpRows,
    revExpRows,
    minorExpRows,
    travelRows,
    contractSealRows,
    generalSealRows,
    invoiceSealRows,
    assetTransferRows,
  ] = await Promise.all([
    db
      .select({
        id: formSubmissions.id,
        formNumber: formSubmissions.formNumber,
        procCaseNumber: procurementCases.caseNumber,
        status: formSubmissions.status,
        totalAmount: formSubmissions.totalAmount,
        createdAt: formSubmissions.createdAt,
        submittedAt: formSubmissions.submittedAt,
        applicantId: formSubmissions.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
        formKey: formDefinitions.key,
        formName: formDefinitions.name,
        catKey: formCategories.key,
        legacyFormType: formDefinitions.legacyFormType,
      })
      .from(formSubmissions)
      .innerJoin(formDefinitions, eq(formDefinitions.id, formSubmissions.definitionId))
      .innerJoin(formCategories, eq(formCategories.id, formDefinitions.categoryId))
      .leftJoin(procurementCases, eq(procurementCases.id, formSubmissions.procurementCaseId))
      .innerJoin(employees, eq(employees.id, formSubmissions.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, formSubmissions.departmentId))
      .orderBy(desc(formSubmissions.createdAt)),

    db
      .select({
        id: purchaseRequests.id,
        caseNumber: procurementCases.caseNumber,
        status: purchaseRequests.status,
        totalAmount: purchaseRequests.totalAmount,
        requestDate: purchaseRequests.requestDate,
        createdAt: purchaseRequests.createdAt,
        applicantId: purchaseRequests.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(purchaseRequests)
      .innerJoin(procurementCases, eq(procurementCases.id, purchaseRequests.procurementCaseId))
      .innerJoin(employees, eq(employees.id, purchaseRequests.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, purchaseRequests.departmentId))
      .orderBy(desc(purchaseRequests.createdAt)),

    db
      .select({
        id: purchaseOrders.id,
        caseNumber: procurementCases.caseNumber,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        createdAt: purchaseOrders.createdAt,
        applicantId: purchaseOrders.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(purchaseOrders)
      .innerJoin(procurementCases, eq(procurementCases.id, purchaseOrders.procurementCaseId))
      .innerJoin(employees, eq(employees.id, purchaseOrders.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, purchaseOrders.departmentId))
      .orderBy(desc(purchaseOrders.createdAt)),

    db
      .select({
        id: acceptances.id,
        caseNumber: procurementCases.caseNumber,
        status: acceptances.status,
        totalAmount: acceptances.totalAmount,
        acceptanceDate: acceptances.acceptanceDate,
        createdAt: acceptances.createdAt,
        applicantId: acceptances.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(acceptances)
      .innerJoin(procurementCases, eq(procurementCases.id, acceptances.procurementCaseId))
      .innerJoin(employees, eq(employees.id, acceptances.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, acceptances.departmentId))
      .orderBy(desc(acceptances.createdAt)),

    db
      .select({
        id: expenseRequests.id,
        caseNumber: procurementCases.caseNumber,
        status: expenseRequests.status,
        totalAmount: expenseRequests.totalAmount,
        createdAt: expenseRequests.createdAt,
        applicantId: expenseRequests.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(expenseRequests)
      .innerJoin(procurementCases, eq(procurementCases.id, expenseRequests.procurementCaseId))
      .innerJoin(employees, eq(employees.id, expenseRequests.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, expenseRequests.departmentId))
      .orderBy(desc(expenseRequests.createdAt)),

    db
      .select({
        id: departmentExpenses.id,
        caseNumber: procurementCases.caseNumber,
        status: departmentExpenses.status,
        totalAmount: departmentExpenses.totalAmount,
        applicationDate: departmentExpenses.applicationDate,
        remark: departmentExpenses.remark,
        createdAt: departmentExpenses.createdAt,
        applicantId: departmentExpenses.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(departmentExpenses)
      .innerJoin(procurementCases, eq(procurementCases.id, departmentExpenses.procurementCaseId))
      .innerJoin(employees, eq(employees.id, departmentExpenses.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, departmentExpenses.departmentId))
      .orderBy(desc(departmentExpenses.createdAt)),

    db
      .select({
        id: projectExpenses.id,
        caseNumber: procurementCases.caseNumber,
        status: projectExpenses.status,
        totalAmount: projectExpenses.totalAmount,
        applicationDate: projectExpenses.applicationDate,
        remark: projectExpenses.remark,
        createdAt: projectExpenses.createdAt,
        applicantId: projectExpenses.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(projectExpenses)
      .innerJoin(procurementCases, eq(procurementCases.id, projectExpenses.procurementCaseId))
      .innerJoin(employees, eq(employees.id, projectExpenses.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, projectExpenses.departmentId))
      .orderBy(desc(projectExpenses.createdAt)),

    db
      .select({
        id: revenueExpenses.id,
        caseNumber: procurementCases.caseNumber,
        status: revenueExpenses.status,
        totalAmount: revenueExpenses.totalAmount,
        applicationDate: revenueExpenses.applicationDate,
        remark: revenueExpenses.remark,
        createdAt: revenueExpenses.createdAt,
        applicantId: revenueExpenses.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(revenueExpenses)
      .innerJoin(procurementCases, eq(procurementCases.id, revenueExpenses.procurementCaseId))
      .innerJoin(employees, eq(employees.id, revenueExpenses.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, revenueExpenses.departmentId))
      .orderBy(desc(revenueExpenses.createdAt)),

    db
      .select({
        id: minorExpenses.id,
        caseNumber: procurementCases.caseNumber,
        status: minorExpenses.status,
        totalAmount: minorExpenses.totalAmount,
        applicationDate: minorExpenses.applicationDate,
        remark: minorExpenses.remark,
        createdAt: minorExpenses.createdAt,
        applicantId: minorExpenses.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(minorExpenses)
      .innerJoin(procurementCases, eq(procurementCases.id, minorExpenses.procurementCaseId))
      .innerJoin(employees, eq(employees.id, minorExpenses.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, minorExpenses.departmentId))
      .orderBy(desc(minorExpenses.createdAt)),

    db
      .select({
        id: travelExpenses.id,
        caseNumber: procurementCases.caseNumber,
        status: travelExpenses.status,
        totalAmount: travelExpenses.totalAmount,
        formDate: travelExpenses.formDate,
        tripStartDate: travelExpenses.tripStartDate,
        tripEndDate: travelExpenses.tripEndDate,
        purpose: travelExpenses.purpose,
        createdAt: travelExpenses.createdAt,
        applicantId: travelExpenses.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(travelExpenses)
      .innerJoin(procurementCases, eq(procurementCases.id, travelExpenses.procurementCaseId))
      .innerJoin(employees, eq(employees.id, travelExpenses.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, travelExpenses.departmentId))
      .orderBy(desc(travelExpenses.createdAt)),

    db
      .select({
        id: contractSealRequests.id,
        caseNumber: procurementCases.caseNumber,
        status: contractSealRequests.status,
        totalAmount: contractSealRequests.totalAmount,
        applicationDate: contractSealRequests.applicationDate,
        subject: contractSealRequests.subject,
        counterparty: contractSealRequests.counterparty,
        createdAt: contractSealRequests.createdAt,
        applicantId: contractSealRequests.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(contractSealRequests)
      .innerJoin(procurementCases, eq(procurementCases.id, contractSealRequests.procurementCaseId))
      .innerJoin(employees, eq(employees.id, contractSealRequests.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, contractSealRequests.departmentId))
      .orderBy(desc(contractSealRequests.createdAt)),

    db
      .select({
        id: generalSealRequests.id,
        caseNumber: procurementCases.caseNumber,
        status: generalSealRequests.status,
        applicationDate: generalSealRequests.applicationDate,
        documentDescription: generalSealRequests.documentDescription,
        createdAt: generalSealRequests.createdAt,
        applicantId: generalSealRequests.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(generalSealRequests)
      .innerJoin(procurementCases, eq(procurementCases.id, generalSealRequests.procurementCaseId))
      .innerJoin(employees, eq(employees.id, generalSealRequests.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, generalSealRequests.departmentId))
      .orderBy(desc(generalSealRequests.createdAt)),

    db
      .select({
        id: invoiceSealRequests.id,
        caseNumber: procurementCases.caseNumber,
        status: invoiceSealRequests.status,
        totalAmount: invoiceSealRequests.totalAmount,
        currency: invoiceSealRequests.currency,
        applicationDate: invoiceSealRequests.applicationDate,
        customerName: invoiceSealRequests.customerName,
        createdAt: invoiceSealRequests.createdAt,
        applicantId: invoiceSealRequests.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(invoiceSealRequests)
      .innerJoin(procurementCases, eq(procurementCases.id, invoiceSealRequests.procurementCaseId))
      .innerJoin(employees, eq(employees.id, invoiceSealRequests.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, invoiceSealRequests.departmentId))
      .orderBy(desc(invoiceSealRequests.createdAt)),

    db
      .select({
        id: assetTransfers.id,
        caseNumber: procurementCases.caseNumber,
        status: assetTransfers.status,
        applicationDate: assetTransfers.applicationDate,
        remark: assetTransfers.remark,
        transferTypes: assetTransfers.transferTypes,
        createdAt: assetTransfers.createdAt,
        applicantId: assetTransfers.applicantEmployeeId,
        applicantName: employees.name,
        departmentCode: departments.code,
        departmentName: departments.name,
      })
      .from(assetTransfers)
      .innerJoin(procurementCases, eq(procurementCases.id, assetTransfers.procurementCaseId))
      .innerJoin(employees, eq(employees.id, assetTransfers.applicantEmployeeId))
      .innerJoin(departments, eq(departments.id, assetTransfers.departmentId))
      .orderBy(desc(assetTransfers.createdAt)),
  ]);

  type RawBaseItem = {
    id: string;
    formType: FormType;
    formKey?: string;
    formLabel: string;
    categoryKey: MyApplicationCategoryKey;
    categoryLabel: string;
    caseNumber: string;
    procurementCaseNumber: string | null;
    applicantId: string;
    applicantName: string;
    departmentCode: string;
    departmentName: string;
    status: string;
    totalAmount: number | null;
    currency?: string;
    dateLabel: string;
    dateIso: string;
    sortTimestamp: number;
    href: string;
    fallbackSummary?: string;
  };

  // Track which legacy (caseNumber, legacyFormType) are already represented by custom submissions
  const seenCustomCaseSlot = new Set<string>();
  const baseItems: RawBaseItem[] = [];

  for (const s of customRows) {
    const catKey = mapCustomCategoryKey(s.catKey, s.formKey);
    const dt = toDateObj(s.submittedAt ?? s.createdAt);
    if (s.procCaseNumber && s.legacyFormType) {
      seenCustomCaseSlot.add(`${s.procCaseNumber}:${s.legacyFormType}`);
    }
    baseItems.push({
      id: s.id,
      formType: 'custom',
      formKey: s.formKey,
      formLabel: s.formName,
      categoryKey: catKey,
      categoryLabel: APPLICATION_CATEGORY_LABELS[catKey],
      caseNumber: s.formNumber || s.procCaseNumber || s.id.slice(0, 8),
      procurementCaseNumber: s.procCaseNumber ?? null,
      applicantId: s.applicantId,
      applicantName: s.applicantName,
      departmentCode: s.departmentCode,
      departmentName: s.departmentName,
      status: s.status,
      totalAmount: s.totalAmount !== null ? Number(s.totalAmount) : null,
      dateLabel: fmtDate.format(dt),
      dateIso: fmtIsoDate.format(dt),
      sortTimestamp: dt.getTime(),
      href: `/f/${s.formKey}/${s.id}`,
    });
  }

  const pushLegacy = (
    item: Omit<RawBaseItem, 'categoryLabel'> & { checkSlot?: string }
  ) => {
    if (item.checkSlot && seenCustomCaseSlot.has(`${item.caseNumber}:${item.checkSlot}`)) {
      return;
    }
    baseItems.push({
      ...item,
      categoryLabel: APPLICATION_CATEGORY_LABELS[item.categoryKey],
    });
  };

  for (const r of prRows) {
    const dt = toDateObj(r.createdAt);
    pushLegacy({
      id: r.id,
      formType: 'purchase_request',
      formLabel: FORM_LABELS.purchase_request,
      categoryKey: 'procurement',
      caseNumber: r.caseNumber,
      procurementCaseNumber: r.caseNumber,
      applicantId: r.applicantId,
      applicantName: r.applicantName,
      departmentCode: r.departmentCode,
      departmentName: r.departmentName,
      status: r.status,
      totalAmount: Number(r.totalAmount ?? 0),
      dateLabel: String(r.requestDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(r.requestDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.purchase_request}/${r.id}`,
      checkSlot: 'purchase_request',
    });
  }

  for (const o of poRows) {
    const dt = toDateObj(o.createdAt);
    pushLegacy({
      id: o.id,
      formType: 'purchase_order',
      formLabel: FORM_LABELS.purchase_order,
      categoryKey: 'procurement',
      caseNumber: o.caseNumber,
      procurementCaseNumber: o.caseNumber,
      applicantId: o.applicantId,
      applicantName: o.applicantName,
      departmentCode: o.departmentCode,
      departmentName: o.departmentName,
      status: o.status,
      totalAmount: Number(o.totalAmount ?? 0),
      dateLabel: fmtDate.format(dt),
      dateIso: fmtIsoDate.format(dt),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.purchase_order}/${o.id}`,
      checkSlot: 'purchase_order',
    });
  }

  for (const a of accRows) {
    const dt = toDateObj(a.createdAt);
    pushLegacy({
      id: a.id,
      formType: 'acceptance',
      formLabel: FORM_LABELS.acceptance,
      categoryKey: 'procurement',
      caseNumber: a.caseNumber,
      procurementCaseNumber: a.caseNumber,
      applicantId: a.applicantId,
      applicantName: a.applicantName,
      departmentCode: a.departmentCode,
      departmentName: a.departmentName,
      status: a.status,
      totalAmount: Number(a.totalAmount ?? 0),
      dateLabel: String(a.acceptanceDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(a.acceptanceDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.acceptance}/${a.id}`,
      checkSlot: 'acceptance',
    });
  }

  for (const e of erRows) {
    const dt = toDateObj(e.createdAt);
    pushLegacy({
      id: e.id,
      formType: 'expense_request',
      formLabel: FORM_LABELS.expense_request,
      categoryKey: 'procurement',
      caseNumber: e.caseNumber,
      procurementCaseNumber: e.caseNumber,
      applicantId: e.applicantId,
      applicantName: e.applicantName,
      departmentCode: e.departmentCode,
      departmentName: e.departmentName,
      status: e.status,
      totalAmount: Number(e.totalAmount ?? 0),
      dateLabel: fmtDate.format(dt),
      dateIso: fmtIsoDate.format(dt),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.expense_request}/${e.id}`,
      checkSlot: 'expense_request',
    });
  }

  const pushClaimRows = (
    rows: typeof deptExpRows,
    ft: 'department_expense' | 'project_expense' | 'revenue_expense' | 'minor_expense',
    editionPath: 'department' | 'project' | 'revenue' | 'minor'
  ) => {
    for (const c of rows) {
      const dt = toDateObj(c.createdAt);
      pushLegacy({
        id: c.id,
        formType: ft,
        formLabel: FORM_LABELS[ft],
        categoryKey: 'expense',
        caseNumber: c.caseNumber,
        procurementCaseNumber: null,
        applicantId: c.applicantId,
        applicantName: c.applicantName,
        departmentCode: c.departmentCode,
        departmentName: c.departmentName,
        status: c.status,
        totalAmount: Number(c.totalAmount ?? 0),
        dateLabel: String(c.applicationDate || fmtDate.format(dt)).replaceAll('-', '/'),
        dateIso: String(c.applicationDate || fmtIsoDate.format(dt)),
        sortTimestamp: dt.getTime(),
        href: `/expense-claims/${editionPath}/${c.id}`,
        fallbackSummary: c.remark ?? undefined,
        checkSlot: ft,
      });
    }
  };

  pushClaimRows(deptExpRows, 'department_expense', 'department');
  pushClaimRows(projExpRows, 'project_expense', 'project');
  pushClaimRows(revExpRows, 'revenue_expense', 'revenue');
  pushClaimRows(minorExpRows, 'minor_expense', 'minor');

  for (const t of travelRows) {
    const dt = toDateObj(t.createdAt);
    pushLegacy({
      id: t.id,
      formType: 'travel_expense',
      formLabel: FORM_LABELS.travel_expense,
      categoryKey: 'expense',
      caseNumber: t.caseNumber,
      procurementCaseNumber: null,
      applicantId: t.applicantId,
      applicantName: t.applicantName,
      departmentCode: t.departmentCode,
      departmentName: t.departmentName,
      status: t.status,
      totalAmount: Number(t.totalAmount ?? 0),
      dateLabel: String(t.formDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(t.formDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.travel_expense}/${t.id}`,
      fallbackSummary: [t.purpose, `${t.tripStartDate} ～ ${t.tripEndDate}`].filter(Boolean).join(' · '),
      checkSlot: 'travel_expense',
    });
  }

  for (const s of contractSealRows) {
    const dt = toDateObj(s.createdAt);
    pushLegacy({
      id: s.id,
      formType: 'contract_seal_request',
      formLabel: FORM_LABELS.contract_seal_request,
      categoryKey: 'seal',
      caseNumber: s.caseNumber,
      procurementCaseNumber: null,
      applicantId: s.applicantId,
      applicantName: s.applicantName,
      departmentCode: s.departmentCode,
      departmentName: s.departmentName,
      status: s.status,
      totalAmount: Number(s.totalAmount ?? 0),
      dateLabel: String(s.applicationDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(s.applicationDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.contract_seal_request}/${s.id}`,
      fallbackSummary: [s.subject, s.counterparty].filter(Boolean).join(' · '),
      checkSlot: 'contract_seal_request',
    });
  }

  for (const s of generalSealRows) {
    const dt = toDateObj(s.createdAt);
    pushLegacy({
      id: s.id,
      formType: 'general_seal_request',
      formLabel: FORM_LABELS.general_seal_request,
      categoryKey: 'seal',
      caseNumber: s.caseNumber,
      procurementCaseNumber: null,
      applicantId: s.applicantId,
      applicantName: s.applicantName,
      departmentCode: s.departmentCode,
      departmentName: s.departmentName,
      status: s.status,
      totalAmount: null,
      dateLabel: String(s.applicationDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(s.applicationDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.general_seal_request}/${s.id}`,
      fallbackSummary: s.documentDescription,
      checkSlot: 'general_seal_request',
    });
  }

  for (const s of invoiceSealRows) {
    const dt = toDateObj(s.createdAt);
    pushLegacy({
      id: s.id,
      formType: 'invoice_seal_request',
      formLabel: FORM_LABELS.invoice_seal_request,
      categoryKey: 'seal',
      caseNumber: s.caseNumber,
      procurementCaseNumber: null,
      applicantId: s.applicantId,
      applicantName: s.applicantName,
      departmentCode: s.departmentCode,
      departmentName: s.departmentName,
      status: s.status,
      totalAmount: Number(s.totalAmount ?? 0),
      currency: s.currency,
      dateLabel: String(s.applicationDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(s.applicationDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.invoice_seal_request}/${s.id}`,
      fallbackSummary: s.customerName,
      checkSlot: 'invoice_seal_request',
    });
  }

  for (const a of assetTransferRows) {
    const dt = toDateObj(a.createdAt);
    pushLegacy({
      id: a.id,
      formType: 'asset_transfer',
      formLabel: FORM_LABELS.asset_transfer,
      categoryKey: 'asset',
      caseNumber: a.caseNumber,
      procurementCaseNumber: null,
      applicantId: a.applicantId,
      applicantName: a.applicantName,
      departmentCode: a.departmentCode,
      departmentName: a.departmentName,
      status: a.status,
      totalAmount: null,
      dateLabel: String(a.applicationDate || fmtDate.format(dt)).replaceAll('-', '/'),
      dateIso: String(a.applicationDate || fmtIsoDate.format(dt)),
      sortTimestamp: dt.getTime(),
      href: `${FORM_ROUTE_PREFIX.asset_transfer}/${a.id}`,
      fallbackSummary: [a.transferTypes?.join('、'), a.remark].filter(Boolean).join(' · '),
      checkSlot: 'asset_transfer',
    });
  }

  if (baseItems.length === 0) return [];

  const returnedIds = baseItems.filter((i) => i.status === 'returned').map((i) => i.id);

  const [snapshots, factsMap, returnRows] = await Promise.all([
    enrichWithSnapshots(baseItems),
    loadFormFacts(baseItems.map((i) => ({ formType: i.formType, formId: i.id }))),
    returnedIds.length > 0
      ? db
          .select({
            formType: approvalSteps.formType,
            formId: approvalSteps.formId,
            comment: approvalSteps.comment,
            approverName: employees.name,
            actedAt: approvalSteps.actedAt,
          })
          .from(approvalSteps)
          .leftJoin(employees, eq(employees.id, approvalSteps.approverEmployeeId))
          .where(and(inArray(approvalSteps.formId, returnedIds), eq(approvalSteps.status, 'returned')))
          .orderBy(desc(approvalSteps.actedAt))
      : Promise.resolve([]),
  ]);

  const returnByKey = new Map<string, { reason: string | null; byName: string | null }>();
  for (const r of returnRows) {
    const key = `${r.formType}:${r.formId}`;
    if (!returnByKey.has(key)) {
      returnByKey.set(key, {
        reason: r.comment?.trim() || null,
        byName: r.approverName ?? null,
      });
    }
  }

  const statusRank = (s: string) => {
    if (s === 'pending_approval') return 0;
    if (s === 'returned') return 1;
    if (s === 'approved') return 2;
    return 3;
  };

  const sortedSnapshots = [...snapshots].sort((a, b) => {
    const rDiff = statusRank(a.status) - statusRank(b.status);
    if (rDiff !== 0) return rDiff;
    return b.sortTimestamp - a.sortTimestamp;
  });

  // Preload inner content (fields, tables, steps) for top N items so expanding is instant
  const toPreload = sortedSnapshots.slice(0, preloadLimit);
  const preloadedDetails = await Promise.all(
    toPreload.map((item) =>
      loadEmailApprovalDocumentSummary(item.formType, item.id).catch(() => null)
    )
  );
  const detailByKey = new Map<string, EmailApprovalDocumentSummary | null>();
  toPreload.forEach((item, idx) => {
    detailByKey.set(`${item.formType}:${item.id}`, preloadedDetails[idx] ?? null);
  });

  return sortedSnapshots.map((item) => {
    const f = factsFor(factsMap, { formType: item.formType, formId: item.id });
    const factParts = f ? [f.what, f.where, f.when].filter(Boolean).join(' · ') : '';
    const detail = detailByKey.get(`${item.formType}:${item.id}`) ?? null;
    const detailFieldSummary =
      detail?.fields
        .filter((fl) => fl.label !== '單據總金額')
        .slice(0, 2)
        .map((fl) => `${fl.label}：${fl.value}`)
        .join(' · ') ?? '';
    const summary = factParts || item.fallbackSummary || detailFieldSummary || '';

    const snap = item.snapshot;
    const ret = returnByKey.get(`${item.formType}:${item.id}`);

    return {
      id: item.id,
      formType: item.formType,
      formKey: item.formKey,
      formLabel: item.formLabel,
      categoryKey: item.categoryKey,
      categoryLabel: item.categoryLabel,
      caseNumber: item.caseNumber,
      procurementCaseNumber: item.procurementCaseNumber,
      applicantId: item.applicantId,
      applicantName: item.applicantName,
      departmentCode: item.departmentCode,
      departmentName: item.departmentName,
      status: item.status,
      totalAmount: item.totalAmount,
      currency: item.currency,
      dateLabel: item.dateLabel,
      dateIso: item.dateIso,
      sortTimestamp: item.sortTimestamp,
      href: item.href,
      summary,
      progress: snap?.progress ?? null,
      currentNodeLabel: snap?.currentNodeLabel ?? null,
      pendingApproverNames: snap?.pendingApproverNames ?? [],
      waitingFor: snap ? formatWaitingDuration(snap.waitingSinceIso) : null,
      returnReason: ret?.reason ?? null,
      returnedByName: ret?.byName ?? null,
      detail,
    };
  });
}
