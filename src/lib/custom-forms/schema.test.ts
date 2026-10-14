import { describe, expect, it } from 'vitest';
import { parseDefinition } from './definition';
import { PURCHASE_ADMIN_SAMPLE } from './samples';
import { parseFormSchema, SCHEMA_LIMITS } from './schema';

const clone = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
const section = (fields: unknown[]) => ({ version: 1, sections: [{ id: 's', title: '', fields }] });
const errorsOf = (raw: unknown) => {
  const r = parseFormSchema(raw);
  return r.ok ? [] : r.errors;
};

describe('parseFormSchema', () => {
  it('accepts the code-defined sample and fills defaults', () => {
    const r = parseFormSchema(PURCHASE_ADMIN_SAMPLE.schema);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const subject = r.schema.sections[0].fields[0];
    expect(subject).toMatchObject({ id: 'subject', type: 'text', format: 'plain', help: '', required: true });
    const handler = r.schema.sections[0].fields.find((f) => f.id === 'handler');
    expect(handler).toMatchObject({ required: false, width: 2, showInHeader: false });
  });

  it.each([
    ['not an object', null, '格式不正確'],
    ['no sections', { version: 1, sections: [] }, '區段'],
    ['unknown field type', section([{ id: 'a', type: 'script', label: 'A' }]), '元件類型'],
    ['bad field id', section([{ id: '1a', type: 'text', label: 'A' }]), '代號'],
    ['duplicate field id', section([{ id: 'a', type: 'text', label: 'A' }, { id: 'a', type: 'text', label: 'B' }]), '重複'],
    ['missing label', section([{ id: 'a', type: 'text' }]), '名稱'],
    ['select without options', section([{ id: 'a', type: 'select', label: 'A', options: [] }]), '選項'],
    ['duplicate option', section([{ id: 'a', type: 'radio', label: 'A', options: [{ value: 'x', label: 'X' }, { value: 'x', label: 'Y' }] }]), '重複'],
    ['min > max', section([{ id: 'a', type: 'number', label: 'A', min: 5, max: 1 }]), '最小值'],
    ['amount on text', section([{ id: 'a', type: 'text', label: 'A', semantic: 'amount' }]), '不能標記'],
    [
      'two amount fields',
      section([
        { id: 'a', type: 'money', label: 'A', semantic: 'amount' },
        { id: 'b', type: 'money', label: 'B', semantic: 'amount' },
      ]),
      '只能有一個',
    ],
    ['visibleWhen looking forward', section([{ id: 'a', type: 'text', label: 'A', visibleWhen: { field: 'b', op: 'filled' } }, { id: 'b', type: 'text', label: 'B' }]), '排在前面'],
    ['visibleWhen bad op', section([{ id: 'b', type: 'text', label: 'B' }, { id: 'a', type: 'text', label: 'A', visibleWhen: { field: 'b', op: 'like', value: 'x' } }]), '比較方式'],
    [
      'formula on text column',
      section([{ id: 't', type: 'table', label: 'T', columns: [{ id: 'q', label: 'Q', type: 'number' }, { id: 'x', label: 'X', type: 'text', formula: { op: 'multiply', of: ['q', 'q'] } }] }]),
      '只有數字或金額欄',
    ],
    [
      'formula money × money',
      section([
        {
          id: 't',
          type: 'table',
          label: 'T',
          columns: [
            { id: 'a', label: 'A', type: 'money' },
            { id: 'b', label: 'B', type: 'money' },
            { id: 'c', label: 'C', type: 'money', formula: { op: 'multiply', of: ['a', 'b'] } },
          ],
        },
      ]),
      '金額 × 數字',
    ],
    [
      'amount table totals a number column',
      section([{ id: 't', type: 'table', label: 'T', semantic: 'amount', totalColumn: 'q', columns: [{ id: 'q', label: 'Q', type: 'number' }] }]),
      '金額欄作為合計欄',
    ],
    ['two attachment fields', section([{ id: 'a', type: 'attachments', label: 'A' }, { id: 'b', type: 'attachments', label: 'B' }]), '最多一個附件'],
    ['notice without text', section([{ id: 'n', type: 'notice', label: 'N' }]), '內容'],
  ])('rejects %s', (_name, raw, message) => {
    const errors = errorsOf(raw);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toContain(message);
  });

  it('caps the number of fields', () => {
    const fields = Array.from({ length: SCHEMA_LIMITS.fields + 1 }, (_, i) => ({ id: `f${i}`, type: 'text', label: `F${i}` }));
    expect(errorsOf(section(fields)).join()).toContain('欄位總數');
  });
});

describe('parseDefinition', () => {
  it('accepts the sample (flow references match the schema)', () => {
    expect(parseDefinition(PURCHASE_ADMIN_SAMPLE.schema, PURCHASE_ADMIN_SAMPLE.flow)).toMatchObject({ ok: true });
  });

  it('rejects a flow that points at a missing field', () => {
    const flow = clone<{ blocks: { source?: { fieldId?: string } }[] }>(PURCHASE_ADMIN_SAMPLE.flow);
    flow.blocks[1].source!.fieldId = 'nope';
    const r = parseDefinition(PURCHASE_ADMIN_SAMPLE.schema, flow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('不存在');
  });

  it('rejects a flow that points at a field of the wrong type', () => {
    const flow = clone<{ blocks: { source?: { fieldId?: string } }[] }>(PURCHASE_ADMIN_SAMPLE.flow);
    flow.blocks[1].source!.fieldId = 'subject'; // budget owner from a text field
    const r = parseDefinition(PURCHASE_ADMIN_SAMPLE.schema, flow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('類型不符');
  });

  it('rejects a condition on a missing field', () => {
    const flow = clone<{ blocks: { branches?: { when: { field: string } }[] }[] }>(PURCHASE_ADMIN_SAMPLE.flow);
    flow.blocks[4].branches![0].when.field = 'ghost';
    const r = parseDefinition(PURCHASE_ADMIN_SAMPLE.schema, flow);
    expect(r.ok).toBe(false);
  });
});
