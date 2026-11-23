import { desc, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { createAppDb } from '@/lib/db/app-client';
import { getDb } from '@/lib/db';
import {
  auditEvents,
  formDefinitions,
  formDrafts,
  formSubmissions,
  procurementCases,
} from '@/lib/db/schema';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import {
  DEPARTMENT_ACCOUNT_CATEGORIES,
  PROJECT_ACCOUNT_CATEGORIES,
  buildStandardBudgetCode,
  findStandardAccountCategory,
} from '@/lib/budget-codes/constants';
import { getBudgetCodeList, type BudgetCodeListItem } from '@/lib/budget-codes/queries';
import { ensureEmployeeBudgetTasksAndHistory } from '@/lib/budget-codes/seed-budget-demo';
import {
  BUDGET_CHANGE_KEY,
  BUDGET_REQUEST_KEY,
} from '@/lib/custom-forms/migrated/budget';
import { getProjectList } from '@/lib/projects/queries';
import type {
  BudgetFormRecord,
  BudgetSubmissionLine,
  PublishedAnalysisRecord,
} from './budget-analysis-hub';
import {
  BudgetCodesManager,
  type BudgetPlatformTab,
} from './budget-codes-manager';

const VALID_TABS: readonly BudgetPlatformTab[] = [
  'overview',
  'define',
  'management',
  'analysis',
  'dispatch',
  'projects',
];

function parseRawLines(rawData: Record<string, unknown>): BudgetSubmissionLine[] {
  const bcObj = (rawData.budgetCodes ?? rawData.items) as
    | { rows?: Record<string, unknown>[] }
    | Record<string, unknown>[]
    | undefined;
  const rawRows = Array.isArray(bcObj)
    ? bcObj
    : Array.isArray(bcObj?.rows)
      ? bcObj.rows
      : [];
  return rawRows.map((r) => {
    const std =
      findStandardAccountCategory(String(r.itemCode ?? '')) ??
      findStandardAccountCategory(String(r.category ?? ''));
    return {
      code: String(r.code ?? ''),
      category: String(r.category ?? std?.categoryName ?? ''),
      itemCode: r.itemCode ? String(r.itemCode) : std?.itemCode,
      accountNumber: r.accountNumber
        ? String(r.accountNumber)
        : std?.accountNumber,
      prevApprovedBudget: Number(r.prevApprovedBudget ?? 0) || 0,
      prevActualAmount: Number(r.prevActualAmount ?? 0) || 0,
      m1: Number(r.m1 ?? 0) || 0,
      m2: Number(r.m2 ?? 0) || 0,
      m3: Number(r.m3 ?? 0) || 0,
      m4: Number(r.m4 ?? 0) || 0,
      m5: Number(r.m5 ?? 0) || 0,
      m6: Number(r.m6 ?? 0) || 0,
      m7: Number(r.m7 ?? 0) || 0,
      m8: Number(r.m8 ?? 0) || 0,
      m9: Number(r.m9 ?? 0) || 0,
      m10: Number(r.m10 ?? 0) || 0,
      m11: Number(r.m11 ?? 0) || 0,
      m12: Number(r.m12 ?? 0) || 0,
      annualBudgetAmount: Number(r.annualBudgetAmount ?? 0) || 0,
      description: String(r.description ?? std?.description ?? ''),
    };
  });
}

/**
 * 將部門或專案的預算表補齊完整標準會計科目項次（SE01～SE23、SE99），
 * 確保在預算清單展開時，可以看到該部門／專案完整編列的每一個項次！
 */
function buildCompleteUnitLines(params: {
  scope: 'department' | 'project';
  fiscalYear: string;
  unitCode: string;
  parsedLines: BudgetSubmissionLine[];
  allBudgetCodes: BudgetCodeListItem[];
}): BudgetSubmissionLine[] {
  const { scope, fiscalYear, unitCode, parsedLines, allBudgetCodes } = params;
  const prevFy = String((Number(fiscalYear) || 116) - 1);
  const pool =
    scope === 'department'
      ? DEPARTMENT_ACCOUNT_CATEGORIES
      : PROJECT_ACCOUNT_CATEGORIES;

  const byItemCode = new Map<string, BudgetSubmissionLine>();
  const byCode = new Map<string, BudgetSubmissionLine>();
  for (const l of parsedLines) {
    if (l.itemCode) byItemCode.set(l.itemCode.toUpperCase(), l);
    if (l.code) byCode.set(l.code.toUpperCase(), l);
  }

  const unitCurrCodes = allBudgetCodes.filter(
    (b) =>
      b.fiscalYear === fiscalYear &&
      (scope === 'department'
        ? b.departmentCode === unitCode
        : b.projectCode === unitCode)
  );
  const unitPrevCodes = allBudgetCodes.filter(
    (b) =>
      b.fiscalYear === prevFy &&
      (scope === 'department'
        ? b.departmentCode === unitCode
        : b.projectCode === unitCode)
  );

  const complete: BudgetSubmissionLine[] = pool.map((cat) => {
    const stdCode = buildStandardBudgetCode({
      fiscalYear,
      unitCode,
      itemCode: cat.itemCode,
    });
    const stdPrevCode = buildStandardBudgetCode({
      fiscalYear: prevFy,
      unitCode,
      itemCode: cat.itemCode,
    });

    const existingLine =
      byItemCode.get(cat.itemCode.toUpperCase()) ??
      byCode.get(stdCode.toUpperCase());
    if (existingLine) {
      return {
        ...existingLine,
        code: existingLine.code || stdCode,
        itemCode: cat.itemCode,
        accountNumber: cat.accountNumber,
        category: existingLine.category || cat.categoryName,
        description: existingLine.description || cat.description,
      };
    }

    const dbCurr = unitCurrCodes.find(
      (b) => b.code.trim().toUpperCase() === stdCode.toUpperCase()
    );
    const dbPrev = unitPrevCodes.find(
      (b) => b.code.trim().toUpperCase() === stdPrevCode.toUpperCase()
    );
    const annual = dbCurr?.annualBudgetAmount ?? 0;
    const prevAmt = dbPrev?.annualBudgetAmount ?? 0;
    const perMonth = annual > 0 ? Math.floor(annual / 12) : 0;
    const m12 = annual > 0 ? annual - perMonth * 11 : 0;

    return {
      code: stdCode,
      category: cat.categoryName,
      itemCode: cat.itemCode,
      accountNumber: cat.accountNumber,
      prevApprovedBudget: prevAmt,
      prevActualAmount: prevAmt,
      m1: perMonth,
      m2: perMonth,
      m3: perMonth,
      m4: perMonth,
      m5: perMonth,
      m6: perMonth,
      m7: perMonth,
      m8: perMonth,
      m9: perMonth,
      m10: perMonth,
      m11: perMonth,
      m12,
      annualBudgetAmount: annual,
      description: cat.description,
    };
  });

  // 若有自訂額外項次也保留在後面
  const stdItemCodeSet = new Set(pool.map((c) => c.itemCode.toUpperCase()));
  for (const l of parsedLines) {
    if (l.itemCode && !stdItemCodeSet.has(l.itemCode.toUpperCase())) {
      complete.push(l);
    }
  }

  return complete;
}

export async function renderBudgetPlatformPage(rawTab: string = 'overview') {
  const employee = await getCurrentEmployee();
  if (!employee) redirect('/login');
  if (
    !(employee.permissions.includes('finance.budget') || employee.role === 'admin')
  ) {
    redirect('/dashboard');
  }

  await ensureEmployeeBudgetTasksAndHistory({
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    departmentId: employee.departmentId,
  });

  const initialTab: BudgetPlatformTab = VALID_TABS.includes(
    rawTab as BudgetPlatformTab
  )
    ? (rawTab as BudgetPlatformTab)
    : 'overview';

  const supabase = createAppDb();
  const drizzleDb = getDb();

  const [budgetCodes, projects, deptRes, empRes, supplierRes, budgetDefs, draftRows, analysisLogs] =
    await Promise.all([
      getBudgetCodeList({ includeInactive: true, includeUsage: true }),
      getProjectList(),
      supabase
        .from('departments')
        .select('id, code, name, manager_employee_id')
        .eq('active', true)
        .order('code'),
      supabase
        .from('employees')
        .select('id, employee_code, name, department_id, role, title')
        .eq('access_enabled', true)
        .order('employee_code'),
      supabase
        .from('suppliers')
        .select('id, name, short_name, tax_id, phone, email, contact_name')
        .order('name'),
      drizzleDb
        .select({ id: formDefinitions.id, key: formDefinitions.key })
        .from(formDefinitions)
        .where(
          inArray(formDefinitions.key, [BUDGET_REQUEST_KEY, BUDGET_CHANGE_KEY])
        ),
      drizzleDb
        .select({
          id: formDrafts.id,
          formKey: formDrafts.formKey,
          ownerEmployeeId: formDrafts.ownerEmployeeId,
          title: formDrafts.title,
          data: formDrafts.data,
          updatedAt: formDrafts.updatedAt,
        })
        .from(formDrafts)
        .where(
          inArray(formDrafts.formKey, [BUDGET_REQUEST_KEY, BUDGET_CHANGE_KEY])
        )
        .orderBy(desc(formDrafts.updatedAt)),
      drizzleDb
        .select({
          id: auditEvents.id,
          details: auditEvents.details,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'budget_code.analysis_published'))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(30),
    ]);

  const departments = (deptRes.data ?? []).map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    managerEmployeeId:
      (d as { manager_employee_id?: string | null }).manager_employee_id ?? null,
  }));
  const employees = (empRes.data ?? []).map((e) => ({
    id: e.id,
    employeeCode: e.employee_code,
    name: e.name,
    departmentId: e.department_id,
    role: (e as { role?: string | null }).role ?? 'staff',
    title: (e as { title?: string | null }).title ?? null,
  }));
  const suppliers = (supplierRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    shortName: (s as { short_name?: string | null }).short_name ?? null,
    taxId: (s as { tax_id?: string | null }).tax_id ?? null,
    phone: (s as { phone?: string | null }).phone ?? null,
    email: (s as { email?: string | null }).email ?? null,
    contactName: (s as { contact_name?: string | null }).contact_name ?? null,
  }));

  const deptById = new Map(departments.map((d) => [d.id, d]));
  const deptByCode = new Map(departments.map((d) => [d.code, d]));
  const projByCode = new Map(projects.map((p) => [p.code, p]));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const bcById = new Map(budgetCodes.map((b) => [b.id, b]));
  const defKeyById = new Map(budgetDefs.map((d) => [d.id, d.key]));

  const defIds = budgetDefs.map((d) => d.id);
  const subRows =
    defIds.length > 0
      ? await drizzleDb
          .select({
            id: formSubmissions.id,
            definitionId: formSubmissions.definitionId,
            formNumber: formSubmissions.formNumber,
            applicantEmployeeId: formSubmissions.applicantEmployeeId,
            departmentId: formSubmissions.departmentId,
            status: formSubmissions.status,
            data: formSubmissions.data,
            totalAmount: formSubmissions.totalAmount,
            submittedAt: formSubmissions.submittedAt,
            createdAt: formSubmissions.createdAt,
            caseNumber: procurementCases.caseNumber,
          })
          .from(formSubmissions)
          .innerJoin(
            procurementCases,
            eq(procurementCases.id, formSubmissions.procurementCaseId)
          )
          .where(inArray(formSubmissions.definitionId, defIds))
          .orderBy(desc(formSubmissions.submittedAt))
      : [];

  const formRecords: BudgetFormRecord[] = [];

  for (const s of subRows) {
    const fKey = defKeyById.get(s.definitionId);
    if (fKey !== BUDGET_REQUEST_KEY && fKey !== BUDGET_CHANGE_KEY) continue;
    const raw = (s.data ?? {}) as Record<string, unknown>;
    const appEmp = empById.get(s.applicantEmployeeId);
    const appDept = deptById.get(s.departmentId);

    if (fKey === BUDGET_REQUEST_KEY) {
      const fy = String(raw.fiscalYear ?? '116');
      const scope =
        raw.budgetScope === 'project' ? ('project' as const) : ('department' as const);
      const rawUnitCode =
        scope === 'project'
          ? String(raw.projectCode ?? '')
          : String(raw.departmentCode ?? appDept?.code ?? 'RD01');
      const unitCode = rawUnitCode || appDept?.code || 'RD01';
      const unitObj =
        scope === 'project'
          ? projByCode.get(unitCode)
          : deptByCode.get(unitCode) ?? appDept;
      const parsedLines = parseRawLines(raw);
      const lines = buildCompleteUnitLines({
        scope,
        fiscalYear: fy,
        unitCode,
        parsedLines,
        allBudgetCodes: budgetCodes,
      });
      const total = lines.reduce((acc, l) => acc + l.annualBudgetAmount, 0);

      formRecords.push({
        id: s.id,
        recordSource: 'submission',
        formKey: 'budget-request',
        formNumber: s.formNumber,
        caseNumber: s.caseNumber,
        status: s.status,
        fiscalYear: fy,
        scope,
        unitCode,
        unitName: unitObj?.name || appDept?.name || unitCode,
        applicantName: appEmp?.name || '系統人員',
        applicantCode: appEmp?.employeeCode || '—',
        submittedAt: (s.submittedAt ?? s.createdAt).toISOString(),
        totalAmount: total || Number(s.totalAmount ?? 0) || 0,
        summaryReason: String(raw.reason ?? ''),
        lines,
      });
    } else {
      const targetBc = bcById.get(String(raw.budgetCodeId ?? ''));
      const sourceBc = raw.sourceBudgetCodeId
        ? bcById.get(String(raw.sourceBudgetCodeId))
        : null;
      const fy =
        targetBc?.fiscalYear ||
        (s.formNumber.includes('115') ? '115' : '116');
      const scope = targetBc?.projectCode ? 'project' : 'department';
      const unitCode =
        targetBc?.projectCode ||
        targetBc?.departmentCode ||
        appDept?.code ||
        'RD01';
      const unitName =
        targetBc?.projectName ||
        targetBc?.departmentName ||
        appDept?.name ||
        unitCode;
      const changeAmt =
        Number(raw.changeAmount ?? s.totalAmount ?? 0) || 0;

      formRecords.push({
        id: s.id,
        recordSource: 'submission',
        formKey: 'budget-change',
        formNumber: s.formNumber,
        caseNumber: s.caseNumber,
        status: s.status,
        fiscalYear: fy,
        scope,
        unitCode,
        unitName,
        applicantName: appEmp?.name || '系統人員',
        applicantCode: appEmp?.employeeCode || '—',
        submittedAt: (s.submittedAt ?? s.createdAt).toISOString(),
        totalAmount: changeAmt,
        summaryReason: String(raw.reason ?? ''),
        changeDetails: {
          targetBudgetCode: targetBc?.code ?? String(raw.budgetCodeId ?? '—'),
          targetCategory: targetBc?.category ?? '預算科目',
          changeType: String(raw.changeType ?? 'increase'),
          sourceBudgetCode: sourceBc?.code ?? null,
          currentBudgetAmount: Number(raw.currentBudgetAmount ?? 0) || 0,
          changeAmount: changeAmt,
          newBudgetAmount: Number(raw.newBudgetAmount ?? 0) || 0,
          reason: String(raw.reason ?? ''),
        },
      });
    }
  }

  for (const d of draftRows) {
    if (d.formKey !== BUDGET_REQUEST_KEY && d.formKey !== BUDGET_CHANGE_KEY)
      continue;
    const raw = (d.data ?? {}) as Record<string, unknown>;
    const appEmp = empById.get(d.ownerEmployeeId);
    const appDept = appEmp ? deptById.get(appEmp.departmentId) : undefined;
    if (d.formKey === BUDGET_REQUEST_KEY) {
      const fy = String(raw.fiscalYear ?? '116');
      const scope =
        raw.budgetScope === 'project' ? ('project' as const) : ('department' as const);
      const unitCode =
        scope === 'project'
          ? String(raw.projectCode ?? '')
          : String(raw.departmentCode ?? appDept?.code ?? 'RD01');
      const unitObj =
        scope === 'project'
          ? projByCode.get(unitCode)
          : deptByCode.get(unitCode) ?? appDept;
      const parsedLines = parseRawLines(raw);
      if (parsedLines.length === 0) continue;
      const lines = buildCompleteUnitLines({
        scope,
        fiscalYear: fy,
        unitCode,
        parsedLines,
        allBudgetCodes: budgetCodes,
      });
      const total = lines.reduce((acc, l) => acc + l.annualBudgetAmount, 0);

      formRecords.push({
        id: `draft-${d.id}`,
        recordSource: 'draft',
        formKey: 'budget-request',
        formNumber: `DRAFT-${fy}-${unitCode}`,
        caseNumber: d.title || `${fy} 年度預算編列草稿`,
        status: 'draft',
        fiscalYear: fy,
        scope,
        unitCode,
        unitName: unitObj?.name || unitCode,
        applicantName: appEmp?.name || '填報人員',
        applicantCode: appEmp?.employeeCode || '—',
        submittedAt: d.updatedAt.toISOString(),
        totalAmount: total,
        summaryReason: String(raw.reason ?? d.title ?? ''),
        lines,
      });
    }
  }

  const publishedAnalyses: PublishedAnalysisRecord[] = analysisLogs.map(
    (log) => {
      const meta = (log.details ?? {}) as Record<string, unknown>;
      return {
        id: String(log.id),
        fiscalYear: String(meta.fiscalYear ?? '116'),
        compareYear: String(meta.compareYear ?? '115'),
        reportTitle: String(meta.reportTitle ?? '年度預算分析報告'),
        executiveSummary: String(meta.executiveSummary ?? ''),
        authorName: String(meta.authorName ?? '財會人員'),
        publishedAt: String(
          meta.publishedAt ?? log.occurredAt.toISOString()
        ),
        publishedCount: Number(meta.publishedCount ?? 0) || 0,
        recipientEmployeeIds: Array.isArray(meta.recipientEmployeeIds)
          ? meta.recipientEmployeeIds.map(String)
          : [],
        unitSummaries: Array.isArray(meta.unitSummaries)
          ? (meta.unitSummaries as PublishedAnalysisRecord['unitSummaries'])
          : [],
      };
    }
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <BudgetCodesManager
        budgetCodes={budgetCodes}
        projects={projects}
        departments={departments}
        employees={employees}
        suppliers={suppliers}
        formRecords={formRecords}
        publishedAnalyses={publishedAnalyses}
        initialTab={initialTab}
      />
    </main>
  );
}

export default async function BudgetCodesPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : {};
  return renderBudgetPlatformPage(resolvedParams?.tab ?? 'projects');
}
