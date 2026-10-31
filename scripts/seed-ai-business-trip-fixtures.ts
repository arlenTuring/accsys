/**
 * Idempotent local fixtures: approved / pending / returned 公出差旅申請單
 * for AI assistant PDF-attach testing.
 *
 * Usage (local DB only):
 *   set -a && . ./.env.local && set +a
 *   unset SMTP_HOST   # block real email
 *   npx tsx scripts/seed-ai-business-trip-fixtures.ts --employee-code DEV001
 *
 * Re-run is safe: fixed idempotency keys; existing fixtures are listed, not duplicated.
 */
import { and, asc, eq } from 'drizzle-orm';
import { getOrCreateApprovedPdfSnapshot } from '../src/lib/ai-chat/approved-pdf';
import { BUSINESS_TRIP_FORM } from '../src/lib/custom-forms/migrated/business-trip';
import { installMigratedForm } from '../src/lib/custom-forms/migrated/install';
import * as customService from '../src/lib/custom-forms/service';
import { getDb } from '../src/lib/db';
import { approvalSteps, departments, employees, formDefinitions, formSubmissions } from '../src/lib/db/schema';

/** Dedicated local approver so DEV001 (applicant+GM) does not auto-skip the whole chain. */
const FIXTURE_APPROVER = {
  id: '00000000-0000-0000-0000-00000000a001',
  employeeCode: 'AITEST-APPR',
  name: 'AI測試簽核員',
  googleEmail: 'ai-test-approver@localhost.test',
};

/** Bump suffix when fixture shape / approval strategy changes (keeps old rows untouched). */
const SEED_NS = 'ai-fixture:business-trip:v2';

type FixtureSpec = {
  key: string;
  title: string;
  outcome: 'approved' | 'pending' | 'returned';
  data: Record<string, unknown>;
};

const FIXTURES: FixtureSpec[] = [
  {
    key: `${SEED_NS}:taichung-visit`,
    title: '[AI測試] 台中客戶拜訪',
    outcome: 'approved',
    data: {
      tripStartAt: '2026-10-20T09:00',
      tripEndAt: '2026-10-20T18:00',
      location: '台中市西屯區',
      purpose: '[AI測試] 台中客戶拜訪｜測試客戶需求訪談',
      itinerary: '上午需求訪談，下午場域勘查',
      advanceAmount: 0,
      approvalProxyNote: '【測試資料／非正式業務核准】簽核代理未啟用',
    },
  },
  {
    key: `${SEED_NS}:hsinchu-device`,
    title: '[AI測試] 新竹設備驗證',
    outcome: 'approved',
    data: {
      tripStartAt: '2026-10-22T08:30',
      tripEndAt: '2026-10-23T18:00',
      location: '新竹市',
      purpose: '[AI測試] 新竹設備驗證｜測試設備整合與驗證',
      itinerary: '第一日安裝測試，第二日驗證與結果整理',
      advanceAmount: 3000,
      approvalProxyNote: '【測試資料／非正式業務核准】簽核代理未啟用',
    },
  },
  {
    key: `${SEED_NS}:tainan-training`,
    title: '[AI測試] 台南教育訓練',
    outcome: 'approved',
    data: {
      tripStartAt: '2026-10-26T09:00',
      tripEndAt: '2026-10-26T19:00',
      location: '台南市',
      purpose: '[AI測試] 台南教育訓練｜測試教育訓練',
      itinerary: '上午課程，下午操作演練',
      advanceAmount: 1500,
      approvalProxyNote: '【測試資料／非正式業務核准】簽核代理未啟用',
    },
  },
  {
    key: `${SEED_NS}:pending-sample`,
    title: '[AI測試] 待簽核公出申請',
    outcome: 'pending',
    data: {
      tripStartAt: '2026-11-03T09:00',
      tripEndAt: '2026-11-03T17:00',
      location: '台北市',
      purpose: '[AI測試] 待簽核公出申請｜負向測試（不可附加核准 PDF）',
      itinerary: '測試用行程，請勿當成正式核准',
      advanceAmount: 0,
      approvalProxyNote: '【測試資料】待簽核',
    },
  },
  {
    key: `${SEED_NS}:returned-sample`,
    title: '[AI測試] 已退回公出申請',
    outcome: 'returned',
    data: {
      tripStartAt: '2026-11-05T10:00',
      tripEndAt: '2026-11-05T16:00',
      location: '高雄市',
      purpose: '[AI測試] 已退回公出申請｜負向測試（不可附加核准 PDF）',
      itinerary: '測試退回流程',
      advanceAmount: 0,
      approvalProxyNote: '【測試資料】已退回',
    },
  },
];

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

async function approveAll(actor: { id: string; role: string }, submissionId: string) {
  for (let i = 0; i < 20; i++) {
    const [fs] = await getDb()
      .select({ version: formSubmissions.version, status: formSubmissions.status })
      .from(formSubmissions)
      .where(eq(formSubmissions.id, submissionId))
      .limit(1);
    if (!fs) throw new Error('missing submission');
    if (fs.status === 'approved') return fs;
    if (fs.status !== 'pending_approval') {
      throw new Error(`unexpected status ${fs.status}`);
    }
    const [pending] = await getDb()
      .select({
        approverEmployeeId: approvalSteps.approverEmployeeId,
        stepOrder: approvalSteps.stepOrder,
      })
      .from(approvalSteps)
      .where(
        and(
          eq(approvalSteps.formType, 'custom'),
          eq(approvalSteps.formId, submissionId),
          eq(approvalSteps.status, 'pending')
        )
      )
      .orderBy(asc(approvalSteps.stepOrder))
      .limit(1);
    if (!pending?.approverEmployeeId) {
      throw new Error('no pending approver — check approval flow for business-trip');
    }
    const r = await customService.approveSubmissionStep(
      { id: pending.approverEmployeeId },
      submissionId,
      fs.version
    );
    if (!r.ok) {
      if (r.code === 'conflict') continue;
      throw new Error(`approve failed: ${JSON.stringify(r)}`);
    }
  }
  throw new Error('approval loop exhausted');
}

async function returnOnce(actor: { id: string; role: string }, submissionId: string) {
  const [fs] = await getDb()
    .select({ version: formSubmissions.version, status: formSubmissions.status })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  if (!fs) throw new Error('missing submission');
  if (fs.status === 'returned') return fs;
  const [pending] = await getDb()
    .select({ approverEmployeeId: approvalSteps.approverEmployeeId })
    .from(approvalSteps)
    .where(
      and(
        eq(approvalSteps.formType, 'custom'),
        eq(approvalSteps.formId, submissionId),
        eq(approvalSteps.status, 'pending')
      )
    )
    .orderBy(asc(approvalSteps.stepOrder))
    .limit(1);
  if (!pending?.approverEmployeeId) throw new Error('no pending approver to return');
  const r = await customService.returnSubmissionStep(
    { id: pending.approverEmployeeId },
    submissionId,
    '【AI測試】刻意退回，供負向測試使用',
    fs.version
  );
  if (!r.ok) throw new Error(`return failed: ${JSON.stringify(r)}`);
  const [again] = await getDb()
    .select({ version: formSubmissions.version, status: formSubmissions.status })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, submissionId))
    .limit(1);
  return again!;
}

async function ensureFixtureApprover(departmentId: string) {
  const db = getDb();
  await db
    .insert(employees)
    .values({
      id: FIXTURE_APPROVER.id,
      employeeCode: FIXTURE_APPROVER.employeeCode,
      name: FIXTURE_APPROVER.name,
      departmentId,
      title: 'AI 測試簽核（非正式）',
      googleEmail: FIXTURE_APPROVER.googleEmail,
      role: 'staff',
      accessEnabled: true,
      isGeneralManager: false,
      isChairman: false,
    })
    .onConflictDoUpdate({
      target: employees.id,
      set: {
        name: FIXTURE_APPROVER.name,
        departmentId,
        accessEnabled: true,
        isGeneralManager: false,
        isChairman: false,
      },
    });
}

async function main() {
  // Block SMTP for this process even if .env loaded it.
  delete process.env.SMTP_HOST;

  const dbUrl = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');
  assertLocalDatabase(dbUrl);

  const employeeCode = arg('--employee-code');
  const employeeIdArg = arg('--employee-id');
  if (!employeeCode && !employeeIdArg) {
    console.error('Specify the applicant explicitly, e.g.:');
    console.error('  npx tsx scripts/seed-ai-business-trip-fixtures.ts --employee-code DEV001');
    process.exit(2);
  }

  const db = getDb();
  const [actorEmp] = employeeIdArg
    ? await db.select().from(employees).where(eq(employees.id, employeeIdArg)).limit(1)
    : await db.select().from(employees).where(eq(employees.employeeCode, employeeCode!)).limit(1);
  if (!actorEmp || !actorEmp.accessEnabled) {
    throw new Error(`employee not found or disabled: ${employeeCode || employeeIdArg}`);
  }
  const actor = { id: actorEmp.id, role: actorEmp.role };
  console.log('applicant', actorEmp.employeeCode, actorEmp.name, actorEmp.id);
  console.log('db_host', new URL(dbUrl).hostname);
  console.log('smtp_disabled', !process.env.SMTP_HOST);

  await db.transaction(async (tx) => {
    await installMigratedForm(tx, BUSINESS_TRIP_FORM, actor.id, 'publish');
  });
  const [def] = await db.select().from(formDefinitions).where(eq(formDefinitions.key, 'business-trip')).limit(1);
  if (!def?.publishedVersionId) throw new Error('business-trip not published');

  await ensureFixtureApprover(actorEmp.departmentId);

  const [dept] = await db
    .select({ id: departments.id, managerEmployeeId: departments.managerEmployeeId })
    .from(departments)
    .where(eq(departments.id, actorEmp.departmentId))
    .limit(1);
  if (!dept) throw new Error('applicant department missing');
  const previousManagerId = dept.managerEmployeeId;

  // Temporarily point dept manager at the fixture approver so skipApplicant does not
  // collapse the chain to auto_approve when the applicant is also GM/manager.
  await db
    .update(departments)
    .set({ managerEmployeeId: FIXTURE_APPROVER.id })
    .where(eq(departments.id, dept.id));
  console.log('dept_manager_swapped_to', FIXTURE_APPROVER.employeeCode, '(restored after seed)');

  const rows: Array<{
    key: string;
    title: string;
    formNumber: string;
    submissionId: string;
    status: string;
    replayed: boolean;
    pdf?: string;
  }> = [];

  try {
    for (const fx of FIXTURES) {
      const created = await customService.createSubmission(actor, 'business-trip', {
        data: fx.data,
        fileCount: 0,
        idempotencyKey: fx.key,
      });
      if (!created.ok) throw new Error(`${fx.key} create failed: ${JSON.stringify(created)}`);
      const submissionId = created.submissionId;
      const replayed = Boolean(created.replayed);

      let status = 'pending_approval';
      if (fx.outcome === 'approved') {
        const final = await approveAll(actor, submissionId);
        status = final.status;
        if (status !== 'approved') throw new Error(`${fx.key} not approved`);
        const snap = await getOrCreateApprovedPdfSnapshot({
          actor,
          formType: 'custom',
          formId: submissionId,
        });
        if (!snap.ok) throw new Error(`${fx.key} pdf failed: ${snap.error}`);
        rows.push({
          key: fx.key,
          title: fx.title,
          formNumber: created.formNumber,
          submissionId,
          status,
          replayed,
          pdf: snap.snapshot.id,
        });
      } else if (fx.outcome === 'returned') {
        const [fs] = await db
          .select({ status: formSubmissions.status })
          .from(formSubmissions)
          .where(eq(formSubmissions.id, submissionId))
          .limit(1);
        status = fs?.status ?? 'unknown';
        if (status === 'pending_approval') {
          const final = await returnOnce(actor, submissionId);
          status = final.status;
        } else if (status !== 'returned') {
          throw new Error(`${fx.key} expected pending/returned, got ${status}`);
        }
        rows.push({
          key: fx.key,
          title: fx.title,
          formNumber: created.formNumber,
          submissionId,
          status,
          replayed,
        });
      } else {
        const [fs] = await db
          .select({ status: formSubmissions.status })
          .from(formSubmissions)
          .where(eq(formSubmissions.id, submissionId))
          .limit(1);
        status = fs?.status ?? 'pending_approval';
        if (status !== 'pending_approval') {
          throw new Error(`${fx.key} expected pending_approval, got ${status}`);
        }
        rows.push({
          key: fx.key,
          title: fx.title,
          formNumber: created.formNumber,
          submissionId,
          status,
          replayed,
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

  console.log('\n=== AI business-trip fixtures ===');
  for (const r of rows) {
    console.log(
      [
        r.status.padEnd(16),
        r.formNumber,
        r.title,
        `/f/business-trip/${r.submissionId}`,
        r.replayed ? '(existing)' : '(created)',
        r.pdf ? `pdf:${r.pdf.slice(0, 8)}` : '',
      ]
        .filter(Boolean)
        .join('  ')
    );
  }
  console.log('\nVisible to employee:', actorEmp.employeeCode, actorEmp.name);
  console.log('Try in AI chat:');
  console.log('  列出我已核准的公出差旅申請單');
  console.log('  找台中的那張');
  console.log('  把這張核准單 PDF 加到目前的差旅報支草稿');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
