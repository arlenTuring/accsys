import type { PickerOptions } from '@/lib/custom-forms/queries';
import { allFields, SOURCE_ROW_KEY, type FieldDef, type FormSchema, type SourceRule, type TableColumn } from '@/lib/custom-forms/schema';
import type { SourceOption } from '@/lib/custom-forms/source';
import type { BuilderSourceForm } from './queries';

type SourceField = Extract<FieldDef, { type: 'source' }>;
type TableField = Extract<FieldDef, { type: 'table' }>;

const SAMPLE_ROWS = 2;

/** Fixed, recognisable ids: the preview never submits, but the picker value must look like a record id. */
export function previewSourceId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function sampleValue(col: TableColumn, row: number, rule: SourceRule, options: Pick<PickerOptions, 'budgetCodes' | 'employees' | 'assets'>): unknown {
  if (rule.rows?.filter?.column === col.id) return rule.rows.filter.value;
  switch (col.type) {
    case 'text':
      return `範例${col.label} ${row + 1}`;
    case 'number':
      return String(Math.max(col.min ?? 1, 1) + row);
    case 'money':
      return String(Math.max(col.min ?? 0, 1000) * (row + 1));
    case 'date':
      return null;
    case 'select':
      return col.default ?? col.options?.[0]?.value ?? null;
    case 'budget_code':
      return options.budgetCodes[0]?.id ?? null;
    case 'employee':
      return options.employees[0]?.id ?? null;
    case 'asset':
      return options.assets[row]?.id ?? null;
  }
}

/**
 * 關聯單據 choices for the designer preview: one made-up approved document per
 * source rule, its rows built from the source form's table (no real
 * submissions are read). Rule conditions and 「案件已有」 are not simulated.
 */
export function previewSourceOptions(
  schema: FormSchema,
  sourceForms: BuilderSourceForm[],
  options: Pick<PickerOptions, 'budgetCodes' | 'employees' | 'assets'>
): SourceOption[] {
  const field = allFields(schema).find((f): f is SourceField => f.type === 'source');
  if (!field) return [];
  return field.sources.flatMap((rule, i) => {
    const form = sourceForms.find((f) => f.key === rule.form);
    if (!form) return [];
    const option: SourceOption = {
      id: previewSourceId(i),
      label: `範例${form.name}（預覽用，非真實單據）`,
      table: rule.rows?.table ?? null,
      rows: [],
      subset: rule.rows?.mode === 'subset',
    };
    const from = rule.rows && allFields(form.schema).find((f): f is TableField => f.type === 'table' && f.id === rule.rows!.from);
    if (rule.rows && from) {
      for (let row = 0; row < SAMPLE_ROWS; row++) {
        const out: Record<string, unknown> = {};
        for (const m of rule.rows.columns) {
          const col = from.columns.find((c) => c.id === m.from);
          out[m.to] = col ? sampleValue(col, row, rule, options) : null;
        }
        out[SOURCE_ROW_KEY] = row;
        option.rows.push(out);
      }
    }
    return [option];
  });
}
