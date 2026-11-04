/**
 * Local play fixtures for AI chat: every migrated designer form gets
 *   1) one submission filed by --employee (pending with AITEST-APPR), and
 *   2) one submission filed by AITEST-STAFF waiting for that employee to approve.
 *
 * Usage:
 *   npx tsx scripts/seed-ai-play-fixtures.ts --employee-code DEV001
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { and, asc, eq } from 'drizzle-orm';
import { addDays } from '../src/lib/seal-requests/validate';
import { taipeiToday } from '../src/lib/taipei-date';
import { MIGRATION_BATCHES } from '../src/lib/custom-forms/migrated';
import { installMigratedForm } from '../src/lib/custom-forms/migrated/install';
import * as customService from '../src/lib/custom-forms/service';
import { getDb } from '../src/lib/db';
import {
  approvalSteps,
  assets,
  budgetCodes,
  departments,
  employees,
  formDefinitions,
  formSubmissions,
  projectMembers,
  projects,
  suppliers,
} from '../src/lib/db/schema';

/** Bump when you need a fresh set (idempotent keys keep old rows otherwise). */
const SEED_NS_BASE = 'ai-play:v4';

const APPROVER = {
  id: '00000000-0000-0000-0000-00000000a001',
  employeeCode: 'AITEST-APPR',
  name: 'AI測試簽核員',
  googleEmail: 'ai-test-approver@localhost.test',
};

const STAFF = {
  id: '00000000-0000-0000-0000-00000000a002',
  employeeCode: 'AITEST-STAFF',
  name: 'AI測試申請人',
  googleEmail: 'ai-test-staff@localhost.test',
};

const FIX_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b001',
  code: '115AI-PLAY',
};
const FIX_PRODUCT = {
  id: '00000000-0000-0000-0000-00000000c001',
  code: 'AI-PLAY-P',
  name: 'AI 測試產品專案',
};
const FIX_REVENUE = {
  id: '00000000-0000-0000-0000-00000000c002',
  code: 'AI-PLAY-R',
  name: 'AI 測試營收專案',
};
const FIX_P_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b002',
  code: '115AI-PLAY-P',
};
const FIX_R_BUDGET = {
  id: '00000000-0000-0000-0000-00000000b003',
  code: '115AI-PLAY-R',
};
function assetIdsFor(code: string) {
  // Stable UUIDs derived from employee code so each player gets own assets.
  const dig = (s: string, n: number) => {
    let h = n * 2654435761;
    for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
  };
  return {
    a1: { id: `00000000-0000-4000-8000-${dig(code, 1)}0001`, tag: `AI-PLAY-${code}-1` },
    a2: { id: `00000000-0000-4000-8000-${dig(code, 2)}0002`, tag: `AI-PLAY-${code}-2` },
    mine: [
      {
        id: `00000000-0000-4000-8000-${dig(code, 3)}0003`,
        tag: `TD-IT-${code}-01`,
        name: 'MacBook Pro 16" (M4 Max)',
        itemKind: '資訊設備',
        location: '台北辦公室 3F',
        unit: '台',
        remark: '個人配發筆電（範例）',
      },
      {
        id: `00000000-0000-4000-8000-${dig(code, 4)}0004`,
        tag: `TD-IT-${code}-02`,
        name: 'Dell UltraSharp 27" 4K 螢幕',
        itemKind: '資訊設備',
        location: '台北辦公室 3F 座位區',
        unit: '台',
        remark: '外接螢幕（範例）',
      },
      {
        id: `00000000-0000-4000-8000-${dig(code, 5)}0005`,
        tag: `TD-LAB-${code}-03`,
        name: '車載光達測試模組 (Velodyne Puck)',
        itemKind: '研發設備',
        location: 'AI Lab 測試車位',
        unit: '組',
        remark: '自駕感知測試用（範例）',
      },
    ],
  };
}

/** Forms that continue another form (need an approved source) — seed later if PR exists. */
const CHAIN_KEYS = new Set(['purchase-order', 'acceptance', 'procurement-payment']);

function assertLocalDatabase(url: string) {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(`Refusing to seed non-local database host: ${host}`);
  }
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

async function ensureEmployee(
  deptId: string,
  person: { id: string; employeeCode: string; name: string; googleEmail: string }
) {
  await getDb()
    .insert(employees)
    .values({
      id: person.id,
      employeeCode: person.employeeCode,
      name: person.name,
      departmentId: deptId,
      title: 'AI 測試（非正式）',
      googleEmail: person.googleEmail,
      role: 'staff',
      accessEnabled: true,
      isGeneralManager: false,
      isChairman: false,
    })
    .onConflictDoUpdate({
      target: employees.id,
      set: {
        name: person.name,
        departmentId: deptId,
        accessEnabled: true,
        isGeneralManager: false,
        isChairman: false,
      },
    });
}

async function ensureMaster(deptId: string, ownerId: string) {
  const db = getDb();
  await db
    .insert(projects)
    .values({ id: FIX_PRODUCT.id, code: FIX_PRODUCT.code, name: FIX_PRODUCT.name, kind: 'product' })
    .onConflictDoNothing();
  await db
    .insert(projects)
    .values({ id: FIX_REVENUE.id, code: FIX_REVENUE.code, name: FIX_REVENUE.name, kind: 'revenue' })
    .onConflictDoNothing();
  for (const pid of [FIX_PRODUCT.id, FIX_REVENUE.id]) {
    await db
      .insert(projectMembers)
      .values({ projectId: pid, employeeId: ownerId })
      .onConflictDoNothing();
    await db
      .insert(projectMembers)
      .values({ projectId: pid, employeeId: STAFF.id })
      .onConflictDoNothing();
  }
  await db
    .insert(budgetCodes)
    .values({
      id: FIX_BUDGET.id,
      code: FIX_BUDGET.code,
      departmentId: deptId,
      category: 'AI測試',
      fiscalYear: '115',
      annualBudgetAmount: '1000000',
      ownerEmployeeId: ownerId,
    })
    .onConflictDoNothing();
  await db
    .insert(budgetCodes)
    .values({
      id: FIX_P_BUDGET.id,
      code: FIX_P_BUDGET.code,
      projectId: FIX_PRODUCT.id,
      category: '材料費',
      fiscalYear: '115',
      annualBudgetAmount: '500000',
      ownerEmployeeId: ownerId,
    })
    .onConflictDoNothing();
  await db
    .insert(budgetCodes)
    .values({
      id: FIX_R_BUDGET.id,
      code: FIX_R_BUDGET.code,
      projectId: FIX_REVENUE.id,
      category: '材料費',
      fiscalYear: '115',
      annualBudgetAmount: '500000',
      ownerEmployeeId: ownerId,
    })
    .onConflictDoNothing();
}

async function ensureAssets(
  pair: ReturnType<typeof assetIdsFor>,
  actorEmployeeId: string,
  actorDepartmentId: string
) {
  const db = getDb();
  for (const a of [pair.a1, pair.a2]) {
    await db
      .insert(assets)
      .values({
        id: a.id,
        tag: a.tag,
        name: 'AI 測試財產',
        custodianEmployeeId: STAFF.id,
        location: 'AI Lab',
      })
      .onConflictDoNothing();
  }
  for (const m of pair.mine) {
    await db
      .insert(assets)
      .values({
        id: m.id,
        tag: m.tag,
        name: m.name,
        itemKind: m.itemKind,
        location: m.location,
        unit: m.unit,
        remark: m.remark,
        custodianEmployeeId: actorEmployeeId,
        custodyDepartmentId: actorDepartmentId,
        status: 'in_custody',
      })
      .onConflictDoUpdate({
        target: assets.id,
        set: {
          name: m.name,
          itemKind: m.itemKind,
          location: m.location,
          unit: m.unit,
          remark: m.remark,
          custodianEmployeeId: actorEmployeeId,
          custodyDepartmentId: actorDepartmentId,
          status: 'in_custody',
        },
      });
  }
}

function sealDate() {
  return addDays(taipeiToday(), 5);
}

function expensePayee(supplierId: string) {
  return {
    payeeType: 'supplier',
    payeeSupplierId: supplierId,
    expectedPaymentDate: '2099-06-15',
    paymentMethod: 'transfer',
    remittanceInfo: '台灣銀行 測試分行 AI測試 012345678901',
  };
}

function dataFor(
  key: string,
  title: string,
  supplierId: string,
  assetPair: { a1: { id: string; tag: string }; a2: { id: string; tag: string } }
): { data: Record<string, unknown>; fileCount: number } | null {
  const tag = `[AI玩] ${title}`;
  switch (key) {
    case 'business-trip':
      return {
        fileCount: 0,
        data: {
          tripStartAt: '2026-11-20T09:00',
          tripEndAt: '2026-11-20T18:00',
          location: '台北市',
          purpose: tag,
          itinerary: '測試行程',
          advanceAmount: 0,
        },
      };
    case 'purchase-request':
      return {
        fileCount: 0,
        data: {
          neededWithinDays: 14,
          items: {
            rows: [
              {
                budgetCodeId: FIX_BUDGET.id,
                description: tag,
                quantity: 1,
                estimatedAmount: '3500',
              },
            ],
          },
        },
      };
    case 'standalone-payment':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: { rows: [{ description: tag, amount: '800' }] },
          ...expensePayee(supplierId),
        },
      };
    case 'general-seal':
      return {
        fileCount: 1,
        data: {
          urgency: 'normal',
          expectedCompletionDate: sealDate(),
          remark: tag,
          documentType: 'quotation',
          documentDescription: `${tag} 報價單 1 份`,
          seals: ['invoice_seal'],
          lendSeal: false,
        },
      };
    case 'contract-seal':
      return {
        fileCount: 1,
        data: {
          urgency: 'normal',
          expectedCompletionDate: sealDate(),
          remark: tag,
          documentType: 'nda',
          seals: ['contract_seal'],
          lendSeal: false,
          periodStart: taipeiToday(),
          periodEnd: addDays(taipeiToday(), 365),
          totalAmount: 0,
          counterparty: 'AI測試客戶',
          subject: tag,
          ndaChecks: ['mutual', 'ip_retained', 'penalty_reviewed'],
        },
      };
    case 'invoice-seal':
      return {
        fileCount: 1,
        data: {
          invoiceType: 'duplicate',
          seal: 'invoice_seal',
          customerName: 'AI測試客戶',
          customerAddress: '台北市測試路 1 號',
          customerPhone: '02-00000000',
          currency: 'TWD',
          lines: { rows: [{ itemName: tag, quantity: 1, unitPrice: '1000', amount: '1000' }] },
          totalWithTax: '1050',
        },
      };
    case 'department-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [{ category: '文具用品', description: tag, currency: 'TWD', amount: '500' }],
          },
          remark: tag,
          payeeType: 'applicant',
          expectedPaymentDate: '2099-06-15',
          paymentMethod: 'transfer',
          remittanceInfo: '台灣銀行 測試分行 AI測試 012345678901',
        },
      };
    case 'minor-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          items: {
            rows: [
              {
                category: '材料 (單筆新臺幣10,000元以下)',
                description: tag,
                currency: 'TWD',
                amount: '500',
              },
            ],
          },
          remark: tag,
          ...expensePayee(supplierId),
        },
      };
    case 'project-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_P_BUDGET.id,
          items: {
            rows: [
              {
                category: '材料 (單筆新臺幣10,000元以下)',
                description: tag,
                currency: 'TWD',
                amount: '600',
              },
            ],
          },
          remark: tag,
          ...expensePayee(supplierId),
        },
      };
    case 'revenue-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_R_BUDGET.id,
          items: {
            rows: [{ category: '材料', description: tag, currency: 'TWD', amount: '700' }],
          },
          remark: tag,
          ...expensePayee(supplierId),
        },
      };
    case 'travel-expense':
      return {
        fileCount: 1,
        data: {
          budgetCodeId: FIX_BUDGET.id,
          advanceAmount: '',
          tripStartDate: '2026-11-10',
          tripEndDate: '2026-11-11',
          purpose: tag,
          tripOrderNo: 'AI-PLAY-BT',
          companions: '無',
          reportItems: {
            rows: [{ tripDate: '2026-11-10', location: '台中', itinerary: '測試', timeSlot: '09:00-18:00' }],
          },
          costItems: {
            rows: [
              {
                expenseDate: '2026-11-10',
                category: '交通費',
                fromStation: '台北',
                toStation: '台中',
                summary: '高鐵',
                currency: 'TWD',
                amount: '700',
              },
            ],
          },
        },
      };
    case 'asset-transfer':
      return {
        fileCount: 1,
        data: {
          useDepartmentId: null as unknown as string, // filled by caller
          useBudgetCodeId: FIX_BUDGET.id,
          transferTypes: ['custodian_change'],
          remark: tag,
          items: {
            rows: [
              {
                assetId: title.includes('待我簽核') ? assetPair.a2.id : assetPair.a1.id,
                reason: 'custodian_change',
                newCustodianEmployeeId: APPROVER.id,
                newLocation: 'AI Lab 2',
              },
            ],
          },
          originalCustodianEmployeeId: STAFF.id,
          newCustodianEmployeeId: APPROVER.id,
          otherCustodianEmployeeId: '',
        },
      };
    default:
      return null;
  }
}

async function main() {
  delete process.env.SMTP_HOST;
  const dbUrl = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');
  assertLocalDatabase(dbUrl);

  const employeeCode = arg('--employee-code') ?? 'DEV001';
  const SEED_NS = `${SEED_NS_BASE}:${employeeCode}`;
  const db = getDb();
  const [actorEmp] = await db.select().from(employees).where(eq(employees.employeeCode, employeeCode)).limit(1);
  if (!actorEmp?.accessEnabled) throw new Error(`employee not found or disabled: ${employeeCode}`);
  console.log('player', actorEmp.employeeCode, actorEmp.name, actorEmp.id);
  console.log('seed_ns', SEED_NS);

  await ensureEmployee(actorEmp.departmentId, APPROVER);
  await ensureEmployee(actorEmp.departmentId, STAFF);
  await ensureMaster(actorEmp.departmentId, actorEmp.id);
  const assetPair = assetIdsFor(actorEmp.employeeCode);
  await ensureAssets(assetPair, actorEmp.id, actorEmp.departmentId);

  const [supplier] = await db.select({ id: suppliers.id }).from(suppliers).orderBy(asc(suppliers.name)).limit(1);
  if (!supplier) throw new Error('no supplier in database — run seed:demo first');

  // Publish every migrated form (idempotent).
  for (const batch of Object.values(MIGRATION_BATCHES)) {
    for (const form of batch.forms) {
      await db.transaction(async (tx) => {
        const r = await installMigratedForm(tx, form, actorEmp.id, 'publish');
        console.log('form', form.key, r.outcome, r.note);
      });
    }
  }

  const [dept] = await db
    .select({ id: departments.id, managerEmployeeId: departments.managerEmployeeId })
    .from(departments)
    .where(eq(departments.id, actorEmp.departmentId))
    .limit(1);
  if (!dept) throw new Error('department missing');
  const previousManagerId = dept.managerEmployeeId;

  const published = await db
    .select({ key: formDefinitions.key, name: formDefinitions.name })
    .from(formDefinitions)
    .where(eq(formDefinitions.status, 'published'));
  const keys = published.map((p) => p.key).filter((k) => !CHAIN_KEYS.has(k));

  type Row = { key: string; role: 'mine' | 'approve'; formNumber: string; status: string; note: string };
  const rows: Row[] = [];

  const createOne = async (opts: {
    formKey: string;
    role: 'mine' | 'approve';
    applicantId: string;
    managerId: string;
    title: string;
  }) => {
    const packed = dataFor(opts.formKey, opts.title, supplier.id, assetPair);
    if (!packed) return { skipped: true as const, reason: 'no_template' };
    let data = { ...packed.data };
    if (opts.formKey === 'asset-transfer') {
      data = { ...data, useDepartmentId: actorEmp.departmentId };
    }

    await db
      .update(departments)
      .set({ managerEmployeeId: opts.managerId })
      .where(eq(departments.id, dept.id));

    const idem = `${SEED_NS}:${opts.role}:${opts.formKey}`;
    const created = await customService.createSubmission({ id: opts.applicantId }, opts.formKey, {
      data,
      fileCount: packed.fileCount,
      idempotencyKey: idem,
    });
    if (!created.ok) {
      return { skipped: true as const, reason: JSON.stringify(created) };
    }
    const [fs] = await db
      .select({ status: formSubmissions.status })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, created.submissionId))
      .limit(1);
    return {
      skipped: false as const,
      formNumber: created.formNumber,
      status: fs?.status ?? 'unknown',
      replayed: Boolean(created.replayed),
      submissionId: created.submissionId,
    };
  };

  try {
    for (const key of keys) {
      const name = published.find((p) => p.key === key)?.name ?? key;

      const mine = await createOne({
        formKey: key,
        role: 'mine',
        applicantId: actorEmp.id,
        managerId: APPROVER.id,
        title: `我送出的 ${name}`,
      });
      if (mine.skipped) {
        console.log('skip mine', key, mine.reason);
      } else {
        // Advance first gate on fresh multi-step chains so the stepper shows 已簽 / 簽核中 / 待簽.
        let progressNote = mine.replayed ? 'existing' : 'created';
        if (!mine.replayed && mine.status === 'pending_approval') {
          const steps = await db
            .select({
              id: approvalSteps.id,
              stepOrder: approvalSteps.stepOrder,
              status: approvalSteps.status,
            })
            .from(approvalSteps)
            .where(and(eq(approvalSteps.formType, 'custom'), eq(approvalSteps.formId, mine.submissionId)))
            .orderBy(asc(approvalSteps.stepOrder));
          if (steps.length >= 2 && steps[0]?.status === 'pending') {
            const first = steps[0];
            const next = steps[1]!;
            await db
              .update(approvalSteps)
              .set({
                status: 'approved',
                actedAt: new Date(),
                comment: 'AI play seed：第一關已簽（假資料）',
              })
              .where(eq(approvalSteps.id, first.id));
            await db
              .update(formSubmissions)
              .set({ currentStepOrder: next.stepOrder })
              .where(eq(formSubmissions.id, mine.submissionId));
            progressNote = `created; advanced_to_step_${next.stepOrder}`;
          }
        }
        rows.push({
          key,
          role: 'mine',
          formNumber: mine.formNumber,
          status: mine.status,
          note: progressNote,
        });
      }

      const appr = await createOne({
        formKey: key,
        role: 'approve',
        applicantId: STAFF.id,
        managerId: actorEmp.id,
        title: `待我簽核 ${name}`,
      });
      if (appr.skipped) {
        console.log('skip approve', key, appr.reason);
      } else {
        // Confirm first pending is the player when possible.
        const [pending] = await db
          .select({
            approverEmployeeId: approvalSteps.approverEmployeeId,
            stepOrder: approvalSteps.stepOrder,
          })
          .from(approvalSteps)
          .where(
            and(
              eq(approvalSteps.formType, 'custom'),
              eq(approvalSteps.formId, appr.submissionId),
              eq(approvalSteps.status, 'pending')
            )
          )
          .orderBy(asc(approvalSteps.stepOrder))
          .limit(1);
        rows.push({
          key,
          role: 'approve',
          formNumber: appr.formNumber,
          status: appr.status,
          note: `${appr.replayed ? 'existing' : 'created'}; pending=${pending?.approverEmployeeId === actorEmp.id ? 'you' : pending?.approverEmployeeId ?? 'none'}`,
        });
      }
    }
  } finally {
    await db
      .update(departments)
      .set({ managerEmployeeId: previousManagerId })
      .where(eq(departments.id, dept.id));
    console.log('dept_manager_restored', previousManagerId);
  }

  console.log('\n=== AI play fixtures ===');
  for (const r of rows) {
    console.log(`${r.role.padEnd(8)} ${r.status.padEnd(16)} ${r.formNumber.padEnd(18)} ${r.key}  (${r.note})`);
  }
  console.log(`\nPlayer: ${actorEmp.employeeCode}. In AI chat try:`);
  console.log('  幫我看看有什麼還沒簽核的');
  console.log('  我送出去的單簽核到哪了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
