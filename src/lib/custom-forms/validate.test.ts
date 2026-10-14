import { describe, expect, it } from 'vitest';
import { PURCHASE_ADMIN_SAMPLE } from './samples';
import { parseFormSchema, type FormSchema } from './schema';
import { validateSubmission } from './validate';

const TODAY = '2026-10-13';
const BUDGET = '11111111-1111-4111-8111-111111111111';
const EMP = '22222222-2222-4222-8222-222222222222';

function schemaOf(raw: unknown): FormSchema {
  const r = parseFormSchema(raw);
  if (!r.ok) throw new Error(r.errors.join());
  return r.schema;
}
const sample = schemaOf(PURCHASE_ADMIN_SAMPLE.schema);
const one = (fields: unknown[]) => schemaOf({ version: 1, sections: [{ id: 's', fields }] });

const valid = () => ({
  subject: '  文具採購 ',
  urgency: 'normal',
  neededBy: '2026-10-20',
  budget: BUDGET,
  handler: '',
  needsIt: false,
  items: { rows: [{ name: '原子筆', qty: '10', unitPrice: '12.5', amount: '999999' }, { name: '', qty: '', unitPrice: '' }], total: '1' },
});

describe('validateSubmission', () => {
  it('normalizes values, recomputes formulas and totals, promotes semantic fields', () => {
    const r = validateSubmission(sample, valid(), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.subject).toBe('文具採購');
    expect(r.value.data.handler).toBeNull();
    // Client-sent amount/total are ignored; the blank row is dropped.
    expect(r.value.data.items).toEqual({ rows: [{ name: '原子筆', qty: 10, unitPrice: '12.50', amount: '125.00' }], total: '125.00' });
    expect(r.value.flowFields.items).toBe('125.00');
    expect(r.value.promoted).toEqual({ totalAmount: '125.00', budgetCodeId: BUDGET, projectId: null });
    expect(r.value.refs.budgetCodes).toEqual([BUDGET]);
    expect(r.value.attachmentsRequired).toBe(false);
  });

  it('drops hidden fields and enforces required only when visible', () => {
    const hidden = validateSubmission(sample, { ...valid(), itNote: 'should be dropped' }, TODAY);
    expect(hidden.ok && 'itNote' in hidden.value.data).toBe(false);

    const shown = validateSubmission(sample, { ...valid(), needsIt: true }, TODAY);
    expect(shown.ok).toBe(false);
    if (!shown.ok) expect(shown.errors.itNote).toContain('必填');

    const filled = validateSubmission(sample, { ...valid(), needsIt: true, itNote: '安裝印表機' }, TODAY);
    expect(filled.ok && filled.value.data.itNote).toBe('安裝印表機');
  });

  it('reports every invalid field', () => {
    const r = validateSubmission(sample, { ...valid(), subject: '', urgency: 'yesterday', neededBy: '2026-10-01', budget: 'x' }, TODAY);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['budget', 'neededBy', 'subject', 'urgency']);
    expect(r.errors.neededBy).toContain('不可早於今天');
  });

  it('requires at least one line on a required table and validates cells', () => {
    const empty = validateSubmission(sample, { ...valid(), items: { rows: [] } }, TODAY);
    expect(!empty.ok && empty.errors.items).toContain('至少需要 1 列');
    const badCell = validateSubmission(sample, { ...valid(), items: { rows: [{ name: 'x', qty: '1.5', unitPrice: '-3' }] } }, TODAY);
    expect(badCell.ok).toBe(false);
    if (!badCell.ok) {
      expect(badCell.errors['items.0.qty']).toContain('整數');
      expect(badCell.errors['items.0.unitPrice']).toContain('負數');
    }
  });

  it('caps table rows', () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({ name: `n${i}`, qty: 1, unitPrice: 1 }));
    const r = validateSubmission(sample, { ...valid(), items: { rows } }, TODAY);
    expect(!r.ok && r.errors.items).toContain('最多 20 列');
  });

  it('rounds money × number half-up to cents', () => {
    const s = one([
      {
        id: 't',
        type: 'table',
        label: 'T',
        totalColumn: 'amt',
        columns: [
          { id: 'q', label: 'Q', type: 'number', decimals: 3 },
          { id: 'p', label: 'P', type: 'money' },
          { id: 'amt', label: 'A', type: 'money', formula: { op: 'multiply', of: ['p', 'q'] } },
        ],
      },
    ]);
    const r = validateSubmission(s, { t: { rows: [{ q: '0.335', p: '10.01' }, { q: 2, p: '0.01' }] } }, TODAY);
    expect(r.ok && r.value.data.t).toEqual({
      rows: [
        { q: 0.335, p: '10.01', amt: '3.35' },
        { q: 2, p: '0.01', amt: '0.02' },
      ],
      total: '3.37',
    });
  });

  it.each([
    ['email', { type: 'text', format: 'email' }, 'not-an-email', 'Email'],
    ['phone', { type: 'text', format: 'phone' }, 'abc', '電話'],
    ['tax id', { type: 'text', format: 'tax_id' }, '1234567', '統一編號'],
    ['too long', { type: 'text', maxLength: 3 }, 'abcd', '最多 3 字'],
    ['control chars', { type: 'text' }, 'a\u0000b', '不允許'],
    ['number decimals', { type: 'number', decimals: 1 }, '1.25', '1 位小數'],
    ['number max', { type: 'number', max: 10 }, 11, '不可大於'],
    ['money max', { type: 'money', max: 100 }, '100.01', '不可超過'],
    ['money 3 decimals', { type: 'money' }, '1.001', '兩位小數'],
    ['bad date', { type: 'date' }, '2026-02-30', '日期'],
    ['unknown option', { type: 'select', options: [{ value: 'a', label: 'A' }] }, 'b', '選項'],
    ['employee not uuid', { type: 'employee' }, 'me', '無效'],
    ['boolean as string', { type: 'boolean' }, 'true', '格式'],
  ])('rejects %s', (_name, props, input, message) => {
    const s = one([{ id: 'f', label: 'F', ...props }]);
    const r = validateSubmission(s, { f: input }, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.f).toContain(message);
  });

  it('checks checkbox counts and keeps option order', () => {
    const s = one([
      { id: 'c', type: 'checkboxes', label: 'C', required: true, maxSelected: 2, options: ['a', 'b', 'c'].map((v) => ({ value: v, label: v })) },
    ]);
    expect(validateSubmission(s, { c: [] }, TODAY).ok).toBe(false);
    expect(validateSubmission(s, { c: ['a', 'b', 'c'] }, TODAY).ok).toBe(false);
    const r = validateSubmission(s, { c: ['b', 'a', 'a'] }, TODAY);
    expect(r.ok && r.value.data.c).toEqual(['a', 'b']);
  });

  it('marks attachments required only when the attachments field is visible', () => {
    const s = one([
      { id: 'need', type: 'boolean', label: 'N' },
      { id: 'files', type: 'attachments', label: 'F', required: true, visibleWhen: { field: 'need', op: 'eq', value: true } },
    ]);
    expect(validateSubmission(s, { need: false }, TODAY)).toMatchObject({ ok: true, value: { attachmentsRequired: false } });
    expect(validateSubmission(s, { need: true }, TODAY)).toMatchObject({ ok: true, value: { attachmentsRequired: true } });
  });

  it('ignores keys that are not fields and lowercases ids', () => {
    const s = one([{ id: 'who', type: 'employee', label: 'W' }]);
    const r = validateSubmission(s, { who: EMP.toUpperCase(), __proto__: { x: 1 }, extra: 'x' }, TODAY);
    expect(r.ok && r.value.data).toEqual({ who: EMP });
  });
});
