/**
 * Isolation fixtures for trip companion candidate search (TEST001–TEST009).
 * Marked with employee codes TEST*; never emails real staff.
 *
 *   npx tsx scripts/seed-companion-candidates-fixtures.ts
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../src/lib/db';
import {
  departments,
  employees,
  formDefinitions,
  formDefinitionVersions,
  formSubmissions,
  procurementCases,
} from '../src/lib/db/schema';

const CASES: Array<{
  code: string;
  name: string;
  start: string;
  end: string;
  location: string;
  purpose: string;
  status: 'approved' | 'pending_approval';
  sameDept: boolean;
}> = [
  { code: 'TEST001', name: '測試同仁甲', start: '2026-11-10', end: '2026-11-12', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST002', name: '測試同仁乙', start: '2026-11-09', end: '2026-11-11', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST003', name: '測試同仁丙', start: '2026-11-12', end: '2026-11-14', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST004', name: '測試同仁丁', start: '2026-11-14', end: '2026-11-15', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST005', name: '測試同仁戊', start: '2026-11-10', end: '2026-11-12', location: '台南', purpose: '測試專案 B', status: 'approved', sameDept: true },
  { code: 'TEST006', name: '測試同仁己', start: '2026-11-10', end: '2026-11-12', location: '新竹', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST007', name: '測試同仁庚', start: '2026-11-25', end: '2026-11-26', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: true },
  { code: 'TEST008', name: '測試同仁辛', start: '2026-11-10', end: '2026-11-12', location: '台南', purpose: '測試專案 A', status: 'approved', sameDept: false },
  { code: 'TEST009', name: '測試同仁甲', start: '2026-11-10', end: '2026-11-12', location: '台南', purpose: '測試專案 A', status: 'pending_approval', sameDept: true },
];

async function main() {
  const db = getDb();
  const [deptA] = await db.select().from(departments).where(eq(departments.active, true)).limit(1);
  if (!deptA) throw new Error('no department');
  let [deptB] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.active, true), sql`${departments.id} <> ${deptA.id}`))
    .limit(1);
  if (!deptB) deptB = deptA;

  const [def] = await db.select().from(formDefinitions).where(eq(formDefinitions.key, 'business-trip')).limit(1);
  if (!def) throw new Error('business-trip form missing');
  const [ver] = await db
    .select()
    .from(formDefinitionVersions)
    .where(eq(formDefinitionVersions.definitionId, def.id))
    .limit(1);
  if (!ver) throw new Error('business-trip version missing');

  for (const c of CASES) {
    const deptId = c.sameDept ? deptA.id : deptB.id;
    let [emp] = await db.select().from(employees).where(eq(employees.employeeCode, c.code)).limit(1);
    if (!emp) {
      [emp] = await db
        .insert(employees)
        .values({
          employeeCode: c.code,
          name: c.name,
          departmentId: deptId,
          title: '測試',
          role: 'staff',
          accessEnabled: true,
        })
        .returning();
    } else {
      await db
        .update(employees)
        .set({ name: c.name, departmentId: deptId, accessEnabled: true, disabledAt: null, disabledReason: null })
        .where(eq(employees.id, emp.id));
    }

    const formNumber = `BT-TEST-${c.code}`;
    const [existing] = await db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.formNumber, formNumber))
      .limit(1);
    if (existing) {
      console.log('skip existing', formNumber);
      continue;
    }

    const caseId = randomUUID();
    await db.insert(procurementCases).values({
      id: caseId,
      caseNumber: `PC-${formNumber}`,
      createdByEmployeeId: emp.id,
      caseType: 'custom',
    });

    await db.insert(formSubmissions).values({
      procurementCaseId: caseId,
      definitionId: def.id,
      versionId: ver.id,
      formNumber,
      applicantEmployeeId: emp.id,
      departmentId: deptId,
      status: c.status,
      data: {
        tripStartAt: `${c.start}T09:00`,
        tripEndAt: `${c.end}T18:00`,
        location: c.location,
        purpose: c.purpose,
        _fixture: 'companion_candidates',
      },
      filedByEmployeeId: emp.id,
    });
    console.log('seeded', formNumber, c.name, c.status);
  }

  console.log('Done. Target trip: 2026-11-10–12 台南 / 測試專案 A');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
