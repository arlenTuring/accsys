import { parseFlow } from '@/lib/approval/flow/parse';
import type { Condition, FlowBlock, FlowDef } from '@/lib/approval/flow/types';
import { allFields, isDisplayOnly, parseFormSchema, type FieldType, type FormSchema } from './schema';

/**
 * A definition version = field schema + approval flow. Both are validated on
 * their own, then the flow's field references are checked against the schema
 * so a published flow can never point at a missing or wrongly typed field.
 */

export type ParsedDefinition = { ok: true; schema: FormSchema; flow: FlowDef } | { ok: false; errors: string[] };

const FIELD_SOURCE_TYPES = {
  /** An employee field stands for that employee's department. */
  department: ['department', 'employee'],
  employee: ['employee'],
  budget_code: ['budget_code'],
  asset: ['asset'],
} satisfies Record<string, FieldType[]>;

export function parseDefinition(rawSchema: unknown, rawFlow: unknown): ParsedDefinition {
  const s = parseFormSchema(rawSchema);
  const f = parseFlow(rawFlow);
  const errors = [...(s.ok ? [] : s.errors), ...(f.ok ? [] : f.errors.map((e) => `簽核流程 ${e}`))];
  if (!s.ok || !f.ok) return { ok: false, errors };

  const types = new Map(allFields(s.schema).filter((x) => !isDisplayOnly(x)).map((x) => [x.id, x.type]));
  const needField = (fieldId: string | undefined, allowed: readonly FieldType[], where: string) => {
    const type = types.get(fieldId ?? '');
    if (!type) errors.push(`簽核流程「${where}」：參考的表單欄位不存在`);
    else if (!allowed.includes(type)) errors.push(`簽核流程「${where}」：參考的表單欄位類型不符`);
  };
  const visitCondition = (c: Condition, where: string) => {
    if ('all' in c) c.all.forEach((x) => visitCondition(x, where));
    else if ('any' in c) c.any.forEach((x) => visitCondition(x, where));
    else if ('not' in c) visitCondition(c.not, where);
    else if (!c.field.startsWith('$') && !types.has(c.field)) errors.push(`簽核流程「${where}」：條件參考的表單欄位不存在`);
  };
  const visit = (blocks: FlowBlock[]) => {
    for (const b of blocks) {
      if (b.type === 'condition') {
        b.branches.forEach((br) => {
          visitCondition(br.when, `${b.label}／${br.label}`);
          visit(br.blocks);
        });
        visit(b.otherwise.blocks);
        continue;
      }
      const src = b.source;
      if ((src.kind === 'department_manager' || src.kind === 'org_chain') && src.of === 'field') {
        needField(src.fieldId, FIELD_SOURCE_TYPES.department, b.label);
      } else if (src.kind === 'job_role' && src.scope === 'field_department') {
        needField(src.fieldId, FIELD_SOURCE_TYPES.department, b.label);
      } else if (src.kind === 'form_party') {
        if (src.party === 'field_employee') needField(src.fieldId, FIELD_SOURCE_TYPES.employee, b.label);
        if (src.party === 'budget_owner') needField(src.fieldId, FIELD_SOURCE_TYPES.budget_code, b.label);
        if (src.party === 'asset_custodian') needField(src.fieldId, FIELD_SOURCE_TYPES.asset, b.label);
      }
    }
  };
  visit(f.flow.blocks);
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, schema: s.schema, flow: f.flow };
}
