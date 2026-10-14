import { describe, expect, it } from 'vitest';
import { parseFlow } from '@/lib/approval/flow/parse';
import type { FlowBlock } from '@/lib/approval/flow/types';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { FIELD_TYPES, parseFormSchema, type FormSchema } from '@/lib/custom-forms/schema';
import { PURCHASE_ADMIN_SAMPLE } from '@/lib/custom-forms/samples';
import { emptyFlow, emptySchema, newApprover, newCondition, newField, uniqueId } from './blank';
import { changeSummary, collectFieldTypes, fieldTypeConflicts, hasChanges } from './diff';
import { draftProblem, MAX_DRAFT_BYTES } from './draft';
import { findBlock, flowIds, insertBlock, locate, moveBlock, removeBlock } from './flow-tree';
import { duplicateField, insertField, moveField, schemaFieldIds } from './schema-edit';
import { parseSettings } from './settings';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('designer defaults', () => {
  it('gives every field type defaults the schema parser accepts (關聯單據 still needs a source form)', () => {
    let schema = emptySchema();
    for (const type of FIELD_TYPES) {
      if (type === 'attachments' && schemaFieldIds(schema).some((id) => id.startsWith('attachments'))) continue;
      schema = insertField(schema, 'main', schema.sections[0].fields.length, newField(type, schemaFieldIds(schema)));
    }
    const parsed = parseFormSchema(schema);
    const errors = parsed.ok ? [] : parsed.errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/關聯單據.*需有 1–5 個來源表單/);
    expect(new Set(schemaFieldIds(schema)).size).toBe(FIELD_TYPES.length);
  });

  it('starts with a publishable flow, and flags blocks that still need choices', () => {
    expect(parseFlow(emptyFlow()).ok).toBe(true);
    const flow = emptyFlow();
    flow.blocks.push(newApprover('employee', flowIds(flow.blocks)), newCondition(flowIds(flow.blocks)));
    const parsed = parseFlow(flow);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.errors.join()).toMatch(/指定員工/);
    expect(new Set(flowIds(flow.blocks)).size).toBe(flowIds(flow.blocks).length);
  });

  it('picks the first free id', () => {
    expect(uniqueId('b', ['b1', 'b2', 'b4'])).toBe('b3');
  });
});

describe('flow tree edits', () => {
  const sample = () => clone(PURCHASE_ADMIN_SAMPLE.flow) as unknown as { blocks: FlowBlock[] };

  it('moves blocks within and across lists and refuses a condition inside itself', () => {
    const { blocks } = sample();
    const branch = { conditionId: 'amount_check', branchId: 'over_threshold' };
    const moved = moveBlock(blocks, 'handler', branch, 0);
    expect(locate(moved, 'handler')).toEqual({ ref: branch, index: 0 });
    expect(locate(moved, 'chairman')).toEqual({ ref: branch, index: 1 });
    expect(moveBlock(blocks, 'amount_check', branch, 0)).toBe(blocks);

    const down = moveBlock(blocks, 'dept_manager', null, 2);
    expect(down.map((b) => b.id).slice(0, 3)).toEqual(['budget_owner', 'dept_manager', 'handler']);
    expect(moveBlock(blocks, 'dept_manager', null, 1)).toBe(blocks);
  });

  it('inserts into and removes from nested lists without touching the rest', () => {
    const { blocks } = sample();
    const block = newApprover('job_role', flowIds(blocks));
    const withNew = insertBlock(blocks, { conditionId: 'amount_check', branchId: 'otherwise' }, 0, block);
    expect(findBlock(withNew, block.id)).toEqual(block);
    expect(removeBlock(withNew, block.id)).toEqual(blocks);
    expect(blocks).toEqual(sample().blocks);
  });
});

describe('schema edits', () => {
  const schema = () => clone(PURCHASE_ADMIN_SAMPLE.schema) as unknown as FormSchema;

  it('moves fields between sections with before-move indexes', () => {
    const s = moveField(schema(), 'subject', 'detail', 1);
    expect(s.sections[1].fields.map((f) => f.id)).toEqual(['items', 'subject', 'files', 'note']);
    expect(moveField(schema(), 'subject', 'basic', 1)).toEqual(schema());
    expect(moveField(schema(), 'subject', 'basic', 2).sections[0].fields[1].id).toBe('subject');
  });

  it('duplicates a field with a fresh id and without its semantic marker', () => {
    const { schema: s, newId } = duplicateField(schema(), 'items');
    const copy = s.sections[1].fields[1];
    expect(copy.id).toBe(newId);
    expect(copy.id).not.toBe('items');
    expect(copy.semantic).toBeUndefined();
    expect(parseFormSchema(s).ok).toBe(true);
  });
});

describe('publish checks', () => {
  const sample = () => {
    const parsed = parseDefinition(PURCHASE_ADMIN_SAMPLE.schema, PURCHASE_ADMIN_SAMPLE.flow);
    if (!parsed.ok) throw new Error(parsed.errors.join());
    return { schema: parsed.schema, flow: parsed.flow };
  };

  it('refuses reusing a published field id with another type', () => {
    const published = collectFieldTypes([PURCHASE_ADMIN_SAMPLE.schema]);
    const next = sample().schema;
    expect(fieldTypeConflicts(next, published)).toEqual([]);
    next.sections[0].fields[0] = { ...next.sections[0].fields[0], type: 'textarea', rows: 4 } as never;
    expect(fieldTypeConflicts(next, published)[0]).toMatch(/主旨.*單行文字.*多行文字/);
  });

  it('summarises added, removed and modified fields and flow changes', () => {
    const prev = sample();
    expect(hasChanges(changeSummary(prev, sample()))).toBe(false);
    const next = sample();
    const basic = next.schema.sections[0];
    basic.fields = basic.fields.filter((f) => f.id !== 'handler');
    basic.fields[0] = { ...basic.fields[0], label: '標題' };
    basic.fields.push(newField('number', schemaFieldIds(next.schema)));
    next.flow = { ...next.flow, options: { ...next.flow.options, whenEmpty: 'block' } };
    const c = changeSummary(prev, next);
    expect(c.removed).toEqual(['承辦人']);
    expect(c.modified).toEqual(['標題']);
    expect(c.added).toEqual(['數字']);
    expect(c.sectionsChanged).toBe(false);
    expect(c.flowChanged).toBe(true);

    const moved = sample();
    moved.schema.sections[0].fields.reverse();
    expect(changeSummary(prev, moved).sectionsChanged).toBe(true);
  });
});

describe('drafts and settings', () => {
  it('accepts incomplete drafts but not shapes the designer cannot load', () => {
    expect(draftProblem(emptySchema(), emptyFlow())).toBeNull();
    expect(draftProblem({ version: 1, sections: [{ id: 'a', title: '', description: '', fields: [{ id: 'x', label: '', type: 'nope' }] }] }, emptyFlow())).toMatch(/欄位/);
    expect(draftProblem(emptySchema(), { version: 1, options: {}, blocks: [{ id: 'c', label: 'c', type: 'condition', branches: 'x' }] })).toMatch(/條件式/);
    expect(draftProblem(emptySchema(), { version: 1, options: {}, blocks: 'x' })).toMatch(/關卡/);
    const big = emptySchema();
    big.sections[0].description = '字'.repeat(Math.ceil(MAX_DRAFT_BYTES / 3) + 10);
    expect(draftProblem(big, emptyFlow())).toMatch(/過大/);
  });

  it('validates publish settings', () => {
    const ok = { key: 'general-seal', name: ' 用印 ', categoryKey: 'seal', numberPrefix: 'SA', visibility: {} };
    expect(parseSettings(ok)).toEqual({ ok: true, value: { ...ok, name: '用印', description: '', sortOrder: 0, visibility: {} } });
    expect(parseSettings({ ...ok, key: 'Bad Key' }).ok).toBe(false);
    expect(parseSettings({ ...ok, numberPrefix: 'sa' }).ok).toBe(false);
    expect(parseSettings({ ...ok, name: '名\u0007稱' }).ok).toBe(false);
    expect(parseSettings({ ...ok, visibility: { departmentIds: ['not-a-uuid'] } }).ok).toBe(false);
    expect(parseSettings({ ...ok, sortOrder: 1.5 }).ok).toBe(false);
  });
});
