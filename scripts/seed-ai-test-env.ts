/**
 * Fixed, labelled test data for the AI assistant acceptance runs (disposable
 * `_test` database only). Idempotent: every row has a fixed id or idempotency
 * key, so re-running neither duplicates nor rewrites history.
 *
 * Everything that has a business service goes through it: submissions are
 * created with customService.createSubmission and approved / returned by the
 * real approvers with approveSubmissionStep / returnSubmissionStep; the
 * company profile is saved through upsertCompanyProfile as the admin. No
 * shortcut that could bypass approval is added to the application.
 *
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *     npx tsx scripts/seed-ai-test-env.ts [--manifest out.json]
 *
 * Roles (tests/integration/fixtures/base.sql + this script):
 *   A 申請人  T-STAFF   測試員工      (T-RD)
 *   B 申請人  T-STAFF-B 測試員工乙    (T-RD)   — added here
 *   C 簽核者  T-MGR     測試主管      (T-RD manager)
 *   D 管理員  T-GM      測試總經理    (admin)
 */
import { writeFileSync } from 'node:fs';
import { and, asc, eq } from 'drizzle-orm';
import { createSession } from '../src/lib/auth/sessions';
import { runWithSessionToken } from '../src/lib/auth/current-employee';
import { getCompanyProfileByCode, upsertCompanyProfile } from '../src/lib/company/service';
import { isValidTaiwanTaxId } from '../src/lib/company/tax-id';
import { MIGRATION_BATCHES } from '../src/lib/custom-forms/migrated';
import { installMigratedForm } from '../src/lib/custom-forms/migrated/install';
import * as customService from '../src/lib/custom-forms/service';
import { getDb, getSql } from '../src/lib/db';
import { BUSINESS_TRIP_FORM } from '../src/lib/custom-forms/migrated/business-trip';
import { publishDefinition } from '../src/lib/custom-forms/publish';
import {
  approvalSteps,
  employees,
  formDefinitions,
  formDefinitionVersions,
  formSubmissions,
  notifications,
  projectMembers,
  projects,
} from '../src/lib/db/schema';

export const TEST_PEOPLE = {
  A: { id: '20000000-0000-0000-0000-000000000001', code: 'T-STAFF', name: '測試員工' },
  B: { id: '20000000-0000-0000-0000-0000000000b1', code: 'T-STAFF-B', name: '測試員工乙' },
  C: { id: '20000000-0000-0000-0000-000000000002', code: 'T-MGR', name: '測試主管' },
  D: { id: '20000000-0000-0000-0000-000000000004', code: 'T-GM', name: '測試總經理' },
} as const;

export const TEST_PROJECTS = [
  { id: '30000000-0000-0000-0000-00000000000a', code: 'T-PRJ-A', name: '測試專案 A', kind: 'product' },
  { id: '30000000-0000-0000-0000-00000000000b', code: 'T-PRJ-B', name: '測試專案 B', kind: 'revenue' },
  // 「A 無權使用的專案」：restricted, only B is a member.
  { id: '30000000-0000-0000-0000-00000000000c', code: 'T-PRJ-X', name: '測試限制專案 X', kind: 'product', restricted: true },
];

const RD_DEPT = '10000000-0000-0000-0000-000000000001';
const NS = 'ai-acceptance:v1';

type TripSpec = {
  key: string;
  by: keyof typeof TEST_PEOPLE;
  outcome: 'approved' | 'returned' | 'pending';
  returnReason?: string;
  data: Record<string, unknown>;
};

const trip = (start: string, end: string, location: string, purpose: string, itinerary: string) => ({
  tripStartAt: start,
  tripEndAt: end,
  location,
  purpose: `[測試] ${purpose}`,
  itinerary,
  advanceAmount: 0,
});

const TRIPS: TripSpec[] = [
  { key: `${NS}:trip:taichung-1`, by: 'A', outcome: 'approved', data: trip('2026-10-14T09:00', '2026-10-14T18:00', '台中市西屯區', '台中客戶需求訪談', '上午訪談，下午場勘') },
  { key: `${NS}:trip:taichung-2`, by: 'A', outcome: 'approved', data: trip('2026-10-21T08:30', '2026-10-21T17:00', '台中市南屯區', '台中設備驗收', '設備驗收與簽署驗收單') },
  { key: `${NS}:trip:hsinchu`, by: 'A', outcome: 'approved', data: trip('2026-10-22T09:00', '2026-10-23T18:00', '新竹市', '新竹供應商稽核', '兩日供應商稽核') },
  {
    key: `${NS}:trip:returned`,
    by: 'A',
    outcome: 'returned',
    returnReason: '[測試] 請補上客戶拜訪行程與預估交通方式後再送出。',
    data: trip('2026-11-10T09:00', '2026-11-10T17:00', '高雄市', '高雄客戶說明會', '說明會'),
  },
  { key: `${NS}:trip:pending`, by: 'A', outcome: 'pending', data: trip('2026-11-12T09:00', '2026-11-12T18:00', '桃園市', '桃園產線評估', '產線評估') },
  { key: `${NS}:trip:b-pending`, by: 'B', outcome: 'pending', data: trip('2026-11-13T09:00', '2026-11-13T12:00', '台北市', 'B 的台北會議', '會議') },
];

/** Enough pending items for C to span more than two notification batches (launcher batch = 20). */
const FLOOD_COUNT = 45;

function guard() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) {
    throw new Error('refusing to seed: DATABASE_URL must point at a disposable *_test database');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('refusing to seed a non-local host');
  delete process.env.SMTP_HOST; // never mail anyone
}

function testTaxId(prefix: string): string {
  for (let i = 0; i < 10; i++) {
    const id = `${prefix}${i}`;
    if (isValidTaiwanTaxId(id)) return id;
  }
  throw new Error('no valid tax id for prefix');
}

async function statusOf(id: string) {
  const [row] = await getDb()
    .select({ status: formSubmissions.status, version: formSubmissions.version, formNumber: formSubmissions.formNumber })
    .from(formSubmissions)
    .where(eq(formSubmissions.id, id))
    .limit(1);
  if (!row) throw new Error(`missing submission ${id}`);
  return row;
}

async function pendingApprover(id: string): Promise<string> {
  const [step] = await getDb()
    .select({ approver: approvalSteps.approverEmployeeId })
    .from(approvalSteps)
    .where(and(eq(approvalSteps.formType, 'custom'), eq(approvalSteps.formId, id), eq(approvalSteps.status, 'pending')))
    .orderBy(asc(approvalSteps.stepOrder))
    .limit(1);
  if (!step?.approver) throw new Error(`no pending approver for ${id}`);
  return step.approver;
}

async function approveAll(id: string) {
  for (let i = 0; i < 10; i++) {
    const s = await statusOf(id);
    if (s.status === 'approved') return;
    if (s.status !== 'pending_approval') throw new Error(`cannot approve ${id}: ${s.status}`);
    const r = await customService.approveSubmissionStep({ id: await pendingApprover(id) }, id, s.version);
    if (!r.ok) throw new Error(`approve failed: ${JSON.stringify(r)}`);
  }
  throw new Error('approval did not finish');
}

async function returnOnce(id: string, reason: string) {
  const s = await statusOf(id);
  if (s.status === 'returned') return;
  if (s.status !== 'pending_approval') throw new Error(`cannot return ${id}: ${s.status}`);
  const r = await customService.returnSubmissionStep({ id: await pendingApprover(id) }, id, reason, s.version);
  if (!r.ok) throw new Error(`return failed: ${JSON.stringify(r)}`);
}

async function main() {
  guard();
  const manifestIdx = process.argv.indexOf('--manifest');
  const manifestPath = manifestIdx >= 0 ? process.argv[manifestIdx + 1] : null;
  const db = getDb();

  for (const batch of Object.values(MIGRATION_BATCHES)) {
    for (const form of batch.forms) {
      const outcome = await db.transaction((tx) => installMigratedForm(tx, form, TEST_PEOPLE.D.id, 'publish'));
      if (outcome.outcome !== 'skipped') console.log(`form ${outcome.key}: ${outcome.outcome}`);
    }
  }

  // Existing definitions are left to the form designer by installMigratedForm; the
  // test environment republishes 公出差旅申請單 once when its published version
  // predates the optional 關聯專案 field (same publish service the designer uses).
  const [tripDef] = await db
    .select({ schema: formDefinitionVersions.schema })
    .from(formDefinitions)
    .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
    .where(eq(formDefinitions.key, BUSINESS_TRIP_FORM.key))
    .limit(1);
  if (tripDef && !JSON.stringify(tripDef.schema).includes('"projectId"')) {
    const r = await db.transaction((tx) => publishDefinition(tx, { ...BUSINESS_TRIP_FORM, actorId: TEST_PEOPLE.D.id }));
    console.log(`form business-trip: republished v${r.version} (關聯專案)`);
  }

  await db
    .insert(employees)
    .values({
      id: TEST_PEOPLE.B.id,
      employeeCode: TEST_PEOPLE.B.code,
      name: TEST_PEOPLE.B.name,
      departmentId: RD_DEPT,
      title: '工程師（測試）',
      googleEmail: 'staff-b@example.test',
      role: 'staff',
    })
    .onConflictDoNothing();
  await db.insert(projects).values(TEST_PROJECTS).onConflictDoNothing();
  await db.update(projects).set({ restricted: true }).where(eq(projects.id, TEST_PROJECTS[2].id));
  await db.insert(projectMembers).values({ projectId: TEST_PROJECTS[2].id, employeeId: TEST_PEOPLE.B.id }).onConflictDoNothing();

  // Company profile, saved by admin D through the real service (audit included).
  const adminSession = await createSession(db, { employeeId: TEST_PEOPLE.D.id, identityId: null, ttlMs: 600_000 });
  const taxId = testTaxId('1234567');
  if (!(await getCompanyProfileByCode('default'))) {
    const saved = await runWithSessionToken(adminSession.token, () =>
      upsertCompanyProfile({ legalName: '測試智駕股份有限公司（測試資料）', taxId, nameAliases: ['測試智駕'] })
    );
    if (!saved.ok) throw new Error(`company profile: ${saved.error}`);
  }

  const out: Record<string, { id: string; formNumber: string; status: string }> = {};
  for (const t of TRIPS) {
    const created = await customService.createSubmission({ id: TEST_PEOPLE[t.by].id }, 'business-trip', {
      data: t.data,
      fileCount: 0,
      idempotencyKey: t.key,
    });
    if (!created.ok) throw new Error(`${t.key}: ${JSON.stringify(created)}`);
    if (t.outcome === 'approved') await approveAll(created.submissionId);
    if (t.outcome === 'returned') await returnOnce(created.submissionId, t.returnReason!);
    const s = await statusOf(created.submissionId);
    out[t.key] = { id: created.submissionId, formNumber: s.formNumber, status: s.status };
  }

  for (let i = 1; i <= FLOOD_COUNT; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    const created = await customService.createSubmission({ id: TEST_PEOPLE.B.id }, 'business-trip', {
      data: trip(`2026-12-${day}T09:00`, `2026-12-${day}T12:00`, '台北市', `通知分頁測試 #${i}`, '通知分頁測試'),
      fileCount: 0,
      idempotencyKey: `${NS}:flood:${i}`,
    });
    if (!created.ok) throw new Error(`flood ${i}: ${JSON.stringify(created)}`);
  }

  const notifCount = async (who: string) =>
    (await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.recipientEmployeeId, who))).length;
  const manifest = {
    people: TEST_PEOPLE,
    projects: TEST_PROJECTS,
    companyTaxId: taxId,
    submissions: out,
    notifications: { A: await notifCount(TEST_PEOPLE.A.id), C: await notifCount(TEST_PEOPLE.C.id) },
  };
  for (const [k, v] of Object.entries(out)) console.log(`${v.status.padEnd(16)} ${v.formNumber}  ${k}`);
  console.log(`notifications: A=${manifest.notifications.A} C=${manifest.notifications.C}`);
  if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
