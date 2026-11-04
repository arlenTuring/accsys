import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import {
  approvalSteps,
  budgetCodes,
  employees,
  formDefinitions,
  formSubmissions,
  procurementCases,
} from '@/lib/db/schema';

const DEMO_BATCH_TAG = 'DEMO-APPR-V2';

type DemoSpec = {
  slug: string;
  formKey: string;
  numberPrefix: string;
  totalAmount: string | null;
  buildData: (budgetId: string | null) => Record<string, unknown>;
  /**
   * If true, creates a 3-step chain where Step 1 is already approved by another manager,
   * Step 2 is current (`pending` for the logged-in user), and Step 3 is waiting.
   * Otherwise creates a 2-step chain where Step 1 is `pending` for the logged-in user.
   */
  atSecondStep: boolean;
  step1Label: string;
  step2Label: string;
  step3Label?: string;
};

const DEMO_SPECS: DemoSpec[] = [
  {
    slug: 'bt-01',
    formKey: 'business-trip',
    numberPrefix: 'BT',
    totalAmount: '0',
    atSecondStep: false,
    step1Label: '申請單位主管',
    step2Label: '總經理',
    buildData: () => ({
      tripStartAt: '2026-11-12T09:00',
      tripEndAt: '2026-11-13T18:00',
      location: '新竹縣竹北市（竹北高鐵自駕測試場域）',
      purpose: '赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調',
      itinerary: 'Day 1：實車感測器校正與封閉場域測試\nDay 2：開放道路路線測試與數據回收',
      advanceAmount: 0,
    }),
  },
  {
    slug: 'pr-02',
    formKey: 'purchase-request',
    numberPrefix: 'PR',
    totalAmount: '68500',
    atSecondStep: true,
    step1Label: '申請單位主管',
    step2Label: '部門複核主管',
    step3Label: '總經理',
    buildData: (budgetId) => ({
      neededWithinDays: 14,
      items: {
        rows: [
          {
            budgetCodeId: budgetId ?? '',
            description: 'NVIDIA Jetson AGX Orin 64GB 工業級車載邊緣運算模組',
            quantity: 1,
            estimatedAmount: '56000',
          },
          {
            budgetCodeId: budgetId ?? '',
            description: '車規級抗震 NVMe SSD 4TB 高速資料紀錄碟',
            quantity: 2,
            estimatedAmount: '12500',
          },
        ],
      },
    }),
  },
  {
    slug: 'exp-03',
    formKey: 'department-expense',
    numberPrefix: 'DE',
    totalAmount: '24800',
    atSecondStep: true,
    step1Label: '申請單位主管',
    step2Label: '預算複核主管',
    step3Label: '財會覆核',
    buildData: (budgetId) => ({
      budgetCodeId: budgetId ?? '',
      items: {
        rows: [
          {
            category: '資訊與雲端服務費',
            description: 'Q4 自駕感知演算法雲端 GPU 訓練叢集與高精地圖標註服務費',
            currency: 'TWD',
            amount: '24800',
          },
        ],
      },
      remark: '研發模型訓練與驗證雲端運算報支',
      payeeType: 'applicant',
      expectedPaymentDate: '2026-11-25',
      paymentMethod: 'transfer',
      remittanceInfo: '玉山銀行 內湖分行 0482-940-182736',
    }),
  },
  {
    slug: 'seal-04',
    formKey: 'contract-seal',
    numberPrefix: 'CS',
    totalAmount: '0',
    atSecondStep: false,
    step1Label: '權責部門主管',
    step2Label: '總經理',
    buildData: () => ({
      urgency: 'normal',
      expectedCompletionDate: '2026-11-15',
      remark: '法務已審閱合約條款，雙方無異議請准予用印',
      documentType: 'nda',
      seals: ['contract_seal'],
      lendSeal: false,
      periodStart: '2026-11-15',
      periodEnd: '2027-11-14',
      totalAmount: 0,
      counterparty: '宏碁智通股份有限公司',
      subject: '2026 年度智慧園區無人接駁車合作備忘錄（MOU）暨保密協議',
      ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'],
    }),
  },
  {
    slug: 'te-05',
    formKey: 'travel-expense',
    numberPrefix: 'TE',
    totalAmount: '6420',
    atSecondStep: false,
    step1Label: '申請單位主管',
    step2Label: '財會核銷',
    buildData: (budgetId) => ({
      budgetCodeId: budgetId ?? '',
      advanceAmount: '0',
      tripStartDate: '2026-10-29',
      tripEndDate: '2026-10-30',
      purpose: '高雄港區無人載具 POC 概念驗證現場部署與客戶驗收差旅報支',
      tripOrderNo: '20261028BT0011',
      companions: '無',
      reportItems: {
        rows: [
          {
            tripDate: '2026-10-29',
            location: '高雄市港區測試場',
            itinerary: '車隊定位系統架設與現場聯調測試',
            timeSlot: '09:00-18:00',
          },
          {
            tripDate: '2026-10-30',
            location: '高雄市港區測試場',
            itinerary: '客戶現場動態展示與驗收會議',
            timeSlot: '09:30-17:30',
          },
        ],
      },
      costItems: {
        rows: [
          {
            expenseDate: '2026-10-29',
            category: '交通費',
            fromStation: '台北南港',
            toStation: '高雄左營',
            summary: '高鐵來回標準車廂車票',
            currency: 'TWD',
            amount: '2980',
          },
          {
            expenseDate: '2026-10-29',
            category: '住宿費',
            fromStation: '高雄市',
            toStation: '高雄市',
            summary: '出差商務旅館住宿一晚（憑統編發票實報實銷）',
            currency: 'TWD',
            amount: '3440',
          },
        ],
      },
    }),
  },
];

const seededInProcess = new Set<string>();
const inFlightByEmployee = new Map<string, Promise<number>>();

async function runSeedForEmployee(
  employee: { id: string; employeeCode: string },
  force: boolean
): Promise<number> {
  const db = getDb();

  const empHex = employee.id.replace(/-/g, '').slice(0, 4).toUpperCase();

  if (!force) {
    const existing = await db.execute<{ cnt: number }>(sql`
      select count(*)::int as cnt
      from approval_steps a
      join form_submissions s on s.id = a.form_id
      join procurement_cases pc on pc.id = s.procurement_case_id
      where a.form_type = 'custom'
        and a.approver_employee_id = ${employee.id}
        and pc.case_number like ${`${DEMO_BATCH_TAG}-${empHex}%`}
    `);
    if ((existing[0]?.cnt ?? 0) > 0) {
      seededInProcess.add(employee.id);
      return 0;
    }
  }

  const otherEmps = await db
    .select({
      id: employees.id,
      name: employees.name,
      departmentId: employees.departmentId,
      employeeCode: employees.employeeCode,
      isGeneralManager: employees.isGeneralManager,
    })
    .from(employees)
    .where(and(eq(employees.accessEnabled, true), ne(employees.id, employee.id)))
    .orderBy(asc(employees.employeeCode))
    .limit(20);

  const realColleagues = otherEmps.filter((e) => !e.employeeCode.startsWith('AITEST'));
  const pool = realColleagues.length >= 2 ? realColleagues : otherEmps;
  if (pool.length === 0) return 0;

  const gmOrFinal =
    otherEmps.find((e) => e.isGeneralManager) ??
    pool[pool.length - 1] ??
    pool[0]!;

  const [bCode] = await db
    .select({ id: budgetCodes.id })
    .from(budgetCodes)
    .orderBy(asc(budgetCodes.code))
    .limit(1);
  const budgetId = bCode?.id ?? null;

  const defs = await db
    .select({
      id: formDefinitions.id,
      key: formDefinitions.key,
      publishedVersionId: formDefinitions.publishedVersionId,
    })
    .from(formDefinitions)
    .where(eq(formDefinitions.status, 'published'));
  const defByKey = new Map(
    defs
      .filter((d): d is typeof d & { publishedVersionId: string } => Boolean(d.publishedVersionId))
      .map((d) => [d.key, d])
  );

  const batchSuffix = force
    ? `${empHex}${Date.now().toString(36).slice(-3).toUpperCase()}`
    : `${empHex}01`;

  let createdCount = 0;

  for (let i = 0; i < DEMO_SPECS.length; i++) {
    const spec = DEMO_SPECS[i]!;
    const def = defByKey.get(spec.formKey);
    if (!def) continue;

    const applicant = pool[i % pool.length]!;
    const firstApprover = pool[(i + 1) % pool.length]!;
    const caseNumber = `${DEMO_BATCH_TAG}-${batchSuffix}-${i + 1}`;
    const formNumber = `20261104${spec.numberPrefix}8${batchSuffix}${i + 1}`;
    const hoursAgo = (i + 2) * 3;

    await db.transaction(async (tx) => {
      const [existingCase] = await tx
        .select({ id: procurementCases.id })
        .from(procurementCases)
        .where(eq(procurementCases.caseNumber, caseNumber))
        .limit(1);
      if (existingCase) return;

      const [pc] = await tx
        .insert(procurementCases)
        .values({
          caseNumber,
          createdByEmployeeId: applicant.id,
          caseType: 'custom',
        })
        .returning({ id: procurementCases.id });

      const currentStepOrder = spec.atSecondStep ? 2 : 1;

      const [sub] = await tx
        .insert(formSubmissions)
        .values({
          procurementCaseId: pc.id,
          definitionId: def.id,
          versionId: def.publishedVersionId,
          formNumber,
          filedByEmployeeId: applicant.id,
          applicantEmployeeId: applicant.id,
          departmentId: applicant.departmentId,
          status: 'pending_approval',
          currentStepOrder,
          data: spec.buildData(budgetId),
          totalAmount: spec.totalAmount,
          budgetCodeId: budgetId,
          submittedAt: sql`now() - make_interval(hours => ${hoursAgo})`,
          createdAt: sql`now() - make_interval(hours => ${hoursAgo})`,
          updatedAt: sql`now() - make_interval(hours => ${hoursAgo})`,
        })
        .returning({ id: formSubmissions.id });

      if (spec.atSecondStep) {
        const actedHoursAgo = Math.max(1, hoursAgo - 2);
        await tx.insert(approvalSteps).values([
          {
            formType: 'custom',
            formId: sub.id,
            stepOrder: 1,
            approverRole: 'department_manager',
            stepLabel: spec.step1Label,
            approverEmployeeId: firstApprover.id,
            status: 'approved',
            comment: '確認符合部門需求，同意呈核。',
            actedAt: sql`now() - make_interval(hours => ${actedHoursAgo})`,
          },
          {
            formType: 'custom',
            formId: sub.id,
            stepOrder: 2,
            approverRole: 'budget_owner',
            stepLabel: spec.step2Label,
            approverEmployeeId: employee.id,
            status: 'pending',
          },
          {
            formType: 'custom',
            formId: sub.id,
            stepOrder: 3,
            approverRole: 'general_manager',
            stepLabel: spec.step3Label ?? '總經理',
            approverEmployeeId: gmOrFinal.id,
            status: 'pending',
          },
        ]);
      } else {
        await tx.insert(approvalSteps).values([
          {
            formType: 'custom',
            formId: sub.id,
            stepOrder: 1,
            approverRole: 'department_manager',
            stepLabel: spec.step1Label,
            approverEmployeeId: employee.id,
            status: 'pending',
          },
          {
            formType: 'custom',
            formId: sub.id,
            stepOrder: 2,
            approverRole: 'general_manager',
            stepLabel: spec.step2Label,
            approverEmployeeId: gmOrFinal.id,
            status: 'pending',
          },
        ]);
      }

      createdCount++;
    });
  }

  seededInProcess.add(employee.id);
  return createdCount;
}

/**
 * Ensures the logged-in employee has realistic pending approval examples to test.
 * Concurrent calls for the same employee share a single in-flight promise.
 */
export async function ensureDemoPendingApprovals(opts?: { force?: boolean }): Promise<number> {
  const employee = await getCurrentEmployee();
  if (!employee) return 0;

  const force = Boolean(opts?.force);
  if (!force && seededInProcess.has(employee.id)) return 0;

  const existingPromise = inFlightByEmployee.get(employee.id);
  if (existingPromise && !force) return existingPromise;

  const promise = runSeedForEmployee(employee, force)
    .catch((err) => {
      console.error('[ensureDemoPendingApprovals] error:', err);
      return 0;
    })
    .finally(() => {
      inFlightByEmployee.delete(employee.id);
    });

  inFlightByEmployee.set(employee.id, promise);
  return promise;
}
