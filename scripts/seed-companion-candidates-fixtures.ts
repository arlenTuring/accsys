/**
 * Isolation fixtures for trip companion candidate search (TEST001–TEST009).
 * Marked with employee codes TEST*; never emails real staff.
 *
 *   npx tsx scripts/seed-companion-candidates-fixtures.ts
 */
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
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
  { code: '0019', name: '呂京霖', start: '2026-11-10', end: '2026-11-12', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'approved', sameDept: true },
  { code: '0020', name: '何宗璟', start: '2026-11-09', end: '2026-11-11', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'approved', sameDept: true },
  { code: '0023', name: '李嘉偉', start: '2026-11-12', end: '2026-11-14', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'approved', sameDept: true },
  { code: '0025', name: '王冠傑', start: '2026-11-14', end: '2026-11-15', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'approved', sameDept: true },
  { code: '0066', name: '劉又誠', start: '2026-11-10', end: '2026-11-12', location: '台南市政府交通局智慧交控中心', purpose: '台南智慧交通控制中心 V2X 號誌優先對接測試', status: 'approved', sameDept: true },
  { code: '0069', name: '陳侑良', start: '2026-11-10', end: '2026-11-12', location: '新竹縣竹北市高鐵自駕場域', purpose: '新竹竹北高鐵自駕接駁車隊例行維護與定位校正', status: 'approved', sameDept: true },
  { code: '0076', name: '陳奕儒', start: '2026-11-25', end: '2026-11-26', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'approved', sameDept: true },
  { code: '0046', name: '賴昭宇', start: '2026-11-10', end: '2026-11-12', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士底盤線控系統聯調支援', status: 'approved', sameDept: false },
  { code: '0077', name: '陳劭穎', start: '2026-11-10', end: '2026-11-12', location: '台南沙崙智慧綠能科學城', purpose: '台南沙崙自駕巴士場域實車道路測試與感測器聯調', status: 'pending_approval', sameDept: true },
];

async function main() {
  const db = getDb();
  const [adsDept] = await db.select().from(departments).where(eq(departments.code, 'ADS')).limit(1);
  const [vdDept] = await db.select().from(departments).where(eq(departments.code, 'VD')).limit(1);
  const [fallbackDept] = await db.select().from(departments).where(eq(departments.active, true)).limit(1);
  const deptA = adsDept ?? fallbackDept;
  if (!deptA) throw new Error('no department');
  const deptB = vdDept ?? deptA;

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
          title: '工程師',
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

    const formNumber = `20261108BT${c.code}`;
    const [existing] = await db
      .select({ id: formSubmissions.id })
      .from(formSubmissions)
      .where(eq(formSubmissions.formNumber, formNumber))
      .limit(1);
    if (existing) {
      await db
        .update(formSubmissions)
        .set({ departmentId: deptId, applicantEmployeeId: emp.id })
        .where(eq(formSubmissions.id, existing.id));
      console.log('updated existing', formNumber);
      continue;
    }

    const caseId = randomUUID();
    await db.insert(procurementCases).values({
      id: caseId,
      caseNumber: `TD11511BT${c.code}`,
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
        itinerary: 'Day 1：場域實車測試與感測器校正\nDay 2：數據收集與系統聯調驗證',
        advanceAmount: 0,
      },
      filedByEmployeeId: emp.id,
    });
    console.log('seeded', formNumber, c.name, c.status);
  }

  console.log('Done. Target trip: 2026-11-10–12 台南沙崙智慧綠能科學城 / 台南沙崙自駕巴士場域實車道路測試與感測器聯調');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
