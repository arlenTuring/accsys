import type { FieldDef, FormSchema } from '@/lib/custom-forms/schema';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import type { BuilderOrg } from '@/lib/form-builder/queries';
import type { CondField } from './condition-editor';

/** Lookups the designer panels share (client-side). */

const toOptions = (list: { id: string; label: string }[]) => list.map((o) => ({ value: o.id, label: o.label }));

export function condFieldOf(f: FieldDef, options: PickerOptions): CondField | null {
  switch (f.type) {
    case 'text':
      return { id: f.id, label: f.label, kind: 'text', options: [] };
    case 'number':
    case 'money':
      return { id: f.id, label: f.label, kind: 'number', options: [] };
    case 'table':
      return f.totalColumn ? { id: f.id, label: `${f.label}（合計）`, kind: 'number', options: [] } : null;
    case 'date':
      return { id: f.id, label: f.label, kind: 'date', options: [] };
    case 'select':
    case 'radio':
      return { id: f.id, label: f.label, kind: 'select', options: f.options ?? [] };
    case 'checkboxes':
      return { id: f.id, label: f.label, kind: 'checkboxes', options: f.options ?? [] };
    case 'boolean':
      return { id: f.id, label: f.label, kind: 'boolean', options: [] };
    case 'employee':
      return { id: f.id, label: f.label, kind: 'ref', options: toOptions(options.employees) };
    case 'department':
      return { id: f.id, label: f.label, kind: 'ref', options: toOptions(options.departments) };
    case 'budget_code':
      return { id: f.id, label: f.label, kind: 'ref', options: toOptions(options.budgetCodes) };
    case 'project':
      return { id: f.id, label: f.label, kind: 'ref', options: toOptions(options.projects) };
    case 'asset':
      return { id: f.id, label: f.label, kind: 'ref', options: toOptions(options.assets) };
    default:
      return null;
  }
}

export const allSchemaFields = (schema: FormSchema): FieldDef[] => schema.sections.flatMap((s) => s.fields);

/** Fields placed before `fieldId` that a show-when rule may test. */
export function earlierCondFields(schema: FormSchema, fieldId: string, options: PickerOptions): CondField[] {
  const fields = allSchemaFields(schema);
  const index = fields.findIndex((f) => f.id === fieldId);
  return fields
    .slice(0, index === -1 ? 0 : index)
    .map((f) => condFieldOf(f, options))
    .filter((f): f is CondField => f !== null);
}

/** Everything a flow branch may test: form fields plus applicant values. */
export function flowCondFields(schema: FormSchema, options: PickerOptions, org: BuilderOrg): CondField[] {
  const formFields = allSchemaFields(schema)
    .map((f) => condFieldOf(f, options))
    .filter((f): f is CondField => f !== null);
  return [
    ...formFields,
    { id: '$applicant.department', label: '〔申請人〕所屬部門', kind: 'ref', options: org.departments.map((d) => ({ value: d.id, label: d.name })) },
    { id: '$applicant.orgLevel', label: '〔申請人〕部門層級', kind: 'ref', options: org.levels.map((l) => ({ value: l.code, label: l.name })) },
    { id: '$applicant.jobRoles', label: '〔申請人〕職務類別', kind: 'roles', options: org.jobRoles.map((r) => ({ value: r.code, label: r.name })) },
  ];
}

/** Form fields of the given types, for approver sources that read a field. */
export function fieldsOfType(schema: FormSchema, types: FieldDef['type'][]): { id: string; label: string }[] {
  return allSchemaFields(schema)
    .filter((f) => types.includes(f.type))
    .map((f) => ({ id: f.id, label: f.label }));
}
