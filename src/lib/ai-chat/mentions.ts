import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { departments, employees } from '@/lib/db/schema';

export type MentionEmployee = {
  id: string;
  employeeCode: string;
  name: string;
  departmentId: string;
  departmentName: string;
  title: string | null;
};

export async function listActiveEmployeesForMention(): Promise<MentionEmployee[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      title: employees.title,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.accessEnabled, true))
    .orderBy(asc(departments.sortOrder), asc(departments.name), asc(employees.name));
  return rows;
}

/**
 * Extract `@Name` or `@Name（Dept）` tokens from a user message and match them
 * against active company employees so the model receives unambiguous identity hints.
 */
export async function buildMentionContextHint(message: string): Promise<string | null> {
  if (!message.includes('@') && !message.includes('＠')) return null;
  const tokenRegex = /[@＠]([^\s@＠,，。！!？?、；;：:「」『』（）()]{1,24})/g;
  const rawTokens = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(message)) !== null) {
    const token = m[1]?.trim();
    if (token) rawTokens.add(token);
  }
  if (rawTokens.size === 0) return null;

  const roster = await listActiveEmployeesForMention();
  const matched: MentionEmployee[] = [];
  const seenIds = new Set<string>();

  for (const tok of rawTokens) {
    const lower = tok.toLowerCase();
    for (const emp of roster) {
      if (seenIds.has(emp.id)) continue;
      const nameHit =
        emp.name.toLowerCase() === lower ||
        tok.startsWith(emp.name) ||
        emp.employeeCode.toLowerCase() === lower;
      if (nameHit) {
        seenIds.add(emp.id);
        matched.push(emp);
      }
    }
  }

  if (matched.length === 0) return null;
  const lines = matched.map(
    (e) =>
      `- @${e.name} → 員工姓名：${e.name}｜工號：${e.employeeCode}｜部門：${e.departmentName}${e.title ? `｜職稱：${e.title}` : ''}（填入人員欄位時請直接傳 "${e.name}（${e.departmentName}）" 或 "${e.name}"，若表單同時需要該人員所屬部門可填 "${e.departmentName}"）`
  );
  return [
    '【使用者以 @ 標註的公司員工】',
    '使用者在訊息中透過 `@姓名` 指定了特定員工（例如資產轉移的新保管人、同行人員、職務代理人或對象）：',
    ...lines,
  ].join('\n');
}
