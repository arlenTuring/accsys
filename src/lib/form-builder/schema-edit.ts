import type { FieldDef, FormSchema, FormSection } from '@/lib/custom-forms/schema';
import { uniqueId } from './blank';

/** Immutable edits of a form schema for the designer canvas. Client-safe. */

export const schemaFieldIds = (schema: FormSchema) => schema.sections.flatMap((s) => s.fields.map((f) => f.id));

export function locateField(schema: FormSchema, id: string): { sectionId: string; index: number } | null {
  for (const s of schema.sections) {
    const index = s.fields.findIndex((f) => f.id === id);
    if (index !== -1) return { sectionId: s.id, index };
  }
  return null;
}

const mapSection = (schema: FormSchema, sectionId: string, fn: (s: FormSection) => FormSection): FormSchema => ({
  ...schema,
  sections: schema.sections.map((s) => (s.id === sectionId ? fn(s) : s)),
});

export function insertField(schema: FormSchema, sectionId: string, index: number, field: FieldDef): FormSchema {
  return mapSection(schema, sectionId, (s) => ({ ...s, fields: [...s.fields.slice(0, index), field, ...s.fields.slice(index)] }));
}

export function removeField(schema: FormSchema, id: string): FormSchema {
  return { ...schema, sections: schema.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== id) })) };
}

export function updateField(schema: FormSchema, id: string, fn: (f: FieldDef) => FieldDef): FormSchema {
  return { ...schema, sections: schema.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (f.id === id ? fn(f) : f)) })) };
}

/** Moves a field to `index` of a section (index counted before the move). */
export function moveField(schema: FormSchema, id: string, sectionId: string, index: number): FormSchema {
  const from = locateField(schema, id);
  if (!from || !schema.sections.some((s) => s.id === sectionId)) return schema;
  const field = schema.sections.find((s) => s.id === from.sectionId)!.fields[from.index];
  const target = from.sectionId === sectionId && from.index < index ? index - 1 : index;
  if (from.sectionId === sectionId && target === from.index) return schema;
  return insertField(removeField(schema, id), sectionId, target, field);
}

/** A copy placed right after the original, with a fresh id. */
export function duplicateField(schema: FormSchema, id: string): { schema: FormSchema; newId: string | null } {
  const at = locateField(schema, id);
  if (!at) return { schema, newId: null };
  const original = schema.sections.find((s) => s.id === at.sectionId)!.fields[at.index];
  const copy = { ...structuredClone(original), id: uniqueId(`${original.id.slice(0, 35)}_`, schemaFieldIds(schema)), label: `${original.label}（複製）`.slice(0, 60) };
  // A semantic marks the one field of its kind, so the copy does not take it.
  delete copy.semantic;
  return { schema: insertField(schema, at.sectionId, at.index + 1, copy as FieldDef), newId: copy.id };
}

export function moveSection(schema: FormSchema, id: string, delta: -1 | 1): FormSchema {
  const i = schema.sections.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= schema.sections.length) return schema;
  const sections = [...schema.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...schema, sections };
}

export function addSection(schema: FormSchema): { schema: FormSchema; id: string } {
  const id = uniqueId('section', schema.sections.map((s) => s.id));
  return { schema: { ...schema, sections: [...schema.sections, { id, title: '新區段', description: '', fields: [] }] }, id };
}
