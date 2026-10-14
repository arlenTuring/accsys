import { flowFieldIds } from '@/lib/approval/flow/references';
import type { FlowDef } from '@/lib/approval/flow/types';
import { allFields, type FieldOption, type FormSchema } from '@/lib/custom-forms/schema';
import { isIsoDate } from '@/lib/seal-requests/validate';

/** Simulator inputs: the form fields a flow looks at. Client-safe (the designer builds the inputs live). */

export type SimInputKind = 'number' | 'text' | 'date' | 'select' | 'checkboxes' | 'boolean' | 'employee' | 'department' | 'budget_code' | 'project';
export type SimInput = { id: string; label: string; kind: SimInputKind; options: FieldOption[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND: Record<string, SimInputKind> = {
  number: 'number',
  money: 'number',
  table: 'number',
  text: 'text',
  textarea: 'text',
  date: 'date',
  select: 'select',
  radio: 'select',
  checkboxes: 'checkboxes',
  boolean: 'boolean',
  employee: 'employee',
  department: 'department',
  budget_code: 'budget_code',
  project: 'project',
};

/** The form fields the flow looks at (conditions, field-based approvers), as simulator inputs. */
export function simulationInputs(schema: FormSchema, flow: FlowDef): SimInput[] {
  const fields = allFields(schema);
  return flowFieldIds(flow).flatMap((id): SimInput[] => {
    const [tableId, columnId] = id.split('.');
    if (columnId) {
      const t = fields.find((x) => x.id === tableId);
      const col = t?.type === 'table' ? t.columns.find((c) => c.id === columnId) : undefined;
      return col?.type === 'budget_code' ? [{ id, label: `${t!.label}的${col.label}`, kind: 'budget_code', options: [] }] : [];
    }
    const f = fields.find((x) => x.id === id);
    const kind = f && KIND[f.type];
    if (!f || !kind) return [];
    const label = f.type === 'table' ? `${f.label}（合計）` : f.label;
    const options = f.type === 'select' || f.type === 'radio' || f.type === 'checkboxes' ? f.options : [];
    return [{ id: f.id, label, kind, options }];
  });
}

/** Keeps only well-formed values for the inputs the flow uses. */
export function sanitizeSimFields(inputs: SimInput[], raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const input of inputs) {
    const v = src[input.id];
    if (v === undefined || v === null || v === '') continue;
    switch (input.kind) {
      case 'number': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
        if (Number.isFinite(n)) out[input.id] = n;
        break;
      }
      case 'text':
        if (typeof v === 'string') out[input.id] = v.slice(0, 200);
        break;
      case 'date':
        if (isIsoDate(v)) out[input.id] = v;
        break;
      case 'select':
        if (input.options.some((o) => o.value === v)) out[input.id] = v;
        break;
      case 'checkboxes':
        if (Array.isArray(v)) out[input.id] = input.options.map((o) => o.value).filter((o) => v.includes(o));
        break;
      case 'boolean':
        if (typeof v === 'boolean') out[input.id] = v;
        break;
      default:
        if (typeof v === 'string' && UUID.test(v)) out[input.id] = v.toLowerCase();
        else if (Array.isArray(v) && input.id.includes('.')) {
          const ids = v.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()).slice(0, 200);
          if (ids.length > 0) out[input.id] = ids;
        }
    }
  }
  return out;
}
