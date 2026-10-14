import { and, eq, sql } from 'drizzle-orm';
import { simulateFlow, type Simulation } from '@/lib/approval/flow/simulate';
import { isUuid } from '@/lib/authz/forms';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { employees, formDefinitions, formDefinitionVersions } from '@/lib/db/schema';
import { isIsoDate } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';
import { abort, runInTransaction } from '@/lib/workflow/tx';
import { orgGuard, type OrgActor, type OrgResult } from './service';
import { sanitizeSimFields, simulationInputs } from './sim-inputs';

export { sanitizeSimFields, simulationInputs, type SimInput, type SimInputKind } from './sim-inputs';

/** Who would sign a published form for this applicant, date and field values. Writes nothing. */
export async function simulateForm(actor: OrgActor, raw: unknown): Promise<OrgResult<{ simulation: Simulation }>> {
  const denied = await orgGuard(actor, false);
  if (denied) return denied;
  const r = (raw ?? {}) as Record<string, unknown>;
  return runInTransaction('org.simulate', async (tx) => {
    await tx.execute(sql`set transaction read only`);
    if (typeof r.key !== 'string' || r.key.length > 40) abort('validation', '請選擇表單');
    if (!isUuid(r.applicantId)) abort('validation', '請選擇申請人');
    const today = r.date === undefined || r.date === '' ? taipeiToday() : r.date;
    if (!isIsoDate(today)) abort('validation', '日期格式不正確');

    const [row] = await tx
      .select({ schema: formDefinitionVersions.schema, flow: formDefinitionVersions.flow })
      .from(formDefinitions)
      .innerJoin(formDefinitionVersions, eq(formDefinitionVersions.id, formDefinitions.publishedVersionId))
      .where(and(eq(formDefinitions.key, r.key as string), eq(formDefinitions.status, 'published')));
    if (!row) abort('not_found', '找不到已發布的表單');
    const def = parseDefinition(row.schema, row.flow);
    if (!def.ok) abort('validation', '表單定義無法讀取');
    const { schema, flow } = def as Extract<typeof def, { ok: true }>;

    const [applicant] = await tx
      .select({ id: employees.id, departmentId: employees.departmentId })
      .from(employees)
      .where(and(eq(employees.id, r.applicantId as string), eq(employees.accessEnabled, true)));
    if (!applicant) abort('validation', '申請人不存在或已停用');

    const simulation = await simulateFlow(tx, flow, {
      applicantEmployeeId: applicant.id,
      filerEmployeeId: applicant.id,
      departmentId: applicant.departmentId,
      formKey: r.key as string,
      today,
      fields: sanitizeSimFields(simulationInputs(schema, flow), r.fields),
    });
    return { ok: true as const, simulation };
  });
}
