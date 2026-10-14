import type { FlowDef } from '@/lib/approval/flow/types';
import type { FieldType, FormSchema } from '@/lib/custom-forms/schema';
import { FIELD_TYPE_LABELS } from './blank';

/**
 * Publish checks that compare a draft with what was published before.
 * Client-safe: the designer shows them live, the server repeats them.
 */

/** Field id -> type (and last label) over every published version. */
export type PublishedFieldTypes = Record<string, { type: FieldType; label: string }>;

/** Collects field types from stored version schemas, oldest first (unknown shapes are skipped). */
export function collectFieldTypes(schemas: unknown[]): PublishedFieldTypes {
  const out: PublishedFieldTypes = {};
  for (const raw of schemas) {
    const sections = (raw as { sections?: unknown })?.sections;
    if (!Array.isArray(sections)) continue;
    for (const s of sections) {
      const fields = (s as { fields?: unknown })?.fields;
      if (!Array.isArray(fields)) continue;
      for (const f of fields as { id?: unknown; type?: unknown; label?: unknown }[]) {
        if (typeof f?.id === 'string' && typeof f.type === 'string') {
          out[f.id] = { type: f.type as FieldType, label: typeof f.label === 'string' ? f.label : f.id };
        }
      }
    }
  }
  return out;
}

/**
 * Submissions store values by field id, so an id once published keeps its
 * type in every later version (lists and reports read old and new together).
 */
export function fieldTypeConflicts(schema: FormSchema, published: PublishedFieldTypes): string[] {
  const out: string[] = [];
  for (const f of schema.sections.flatMap((s) => s.fields)) {
    const before = published[f.id];
    if (before && before.type !== f.type) {
      out.push(
        `欄位「${f.label}」（代號 ${f.id}）在已發佈的版本是「${FIELD_TYPE_LABELS[before.type] ?? before.type}」，不能改成「${FIELD_TYPE_LABELS[f.type]}」；請改用新的欄位代號`
      );
    }
  }
  return out;
}

export type ChangeSummary = {
  added: string[];
  removed: string[];
  modified: string[];
  sectionsChanged: boolean;
  /** 允許代為申請 was turned on or off. */
  onBehalfChanged: boolean;
  /** 財產清冊串接 was added, removed or re-mapped. */
  assetRegisterChanged: boolean;
  flowChanged: boolean;
};

const json = (v: unknown) => JSON.stringify(v);

/** What a publish changes compared with the current version (null = first publish). */
export function changeSummary(prev: { schema: FormSchema; flow: FlowDef } | null, next: { schema: FormSchema; flow: FlowDef }): ChangeSummary {
  const nextFields = next.schema.sections.flatMap((s) => s.fields);
  if (!prev) {
    return {
      added: nextFields.map((f) => f.label),
      removed: [],
      modified: [],
      sectionsChanged: true,
      onBehalfChanged: false,
      assetRegisterChanged: false,
      flowChanged: true,
    };
  }
  const prevFields = prev.schema.sections.flatMap((s) => s.fields);
  const prevById = new Map(prevFields.map((f) => [f.id, f]));
  const nextIds = new Set(nextFields.map((f) => f.id));
  // Added / removed fields are reported on their own; only moves of shared fields count as a layout change.
  const layout = (schema: FormSchema) =>
    schema.sections.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      fields: s.fields.filter((f) => prevById.has(f.id) && nextIds.has(f.id)).map((f) => f.id),
    }));
  return {
    added: nextFields.filter((f) => !prevById.has(f.id)).map((f) => f.label),
    removed: prevFields.filter((f) => !nextIds.has(f.id)).map((f) => f.label),
    modified: nextFields.filter((f) => prevById.has(f.id) && json(prevById.get(f.id)) !== json(f)).map((f) => f.label),
    sectionsChanged: json(layout(prev.schema)) !== json(layout(next.schema)),
    onBehalfChanged: (prev.schema.onBehalf === true) !== (next.schema.onBehalf === true),
    assetRegisterChanged: json(prev.schema.assetRegister ?? null) !== json(next.schema.assetRegister ?? null),
    flowChanged: json(prev.flow) !== json(next.flow),
  };
}

export function hasChanges(c: ChangeSummary): boolean {
  return (
    c.added.length + c.removed.length + c.modified.length > 0 || c.sectionsChanged || c.onBehalfChanged || c.assetRegisterChanged || c.flowChanged
  );
}
