import { describe, expect, it } from 'vitest';
import { mergeCatalog, type FormCategory } from '@/lib/forms/catalog';
import { changeSummary } from '@/lib/form-builder/diff';
import { parseFormSchema, type FormSchema } from './schema';
import { canSeeSensitive, maskSensitive } from './sensitive';
import { minDate, validateSubmission } from './validate';

const TODAY = '2026-10-13';

function schemaOf(raw: unknown): FormSchema {
  const r = parseFormSchema(raw);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r.schema;
}
const errorsOf = (raw: unknown) => {
  const r = parseFormSchema(raw);
  return r.ok ? [] : r.errors;
};
const one = (fields: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, sections: [{ id: 's', fields }], ...extra });

describe('schema: requiredWhen / rules / currencyField / column min / onBehalf', () => {
  it('accepts the new properties and keeps them', () => {
    const s = schemaOf(
      one(
        [
          { id: 'kind', type: 'radio', label: '類型', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
          { id: 'ccy', type: 'select', label: '幣別', options: [{ value: 'USD', label: 'USD' }] },
          { id: 'start', type: 'date', label: '起' },
          {
            id: 'end',
            type: 'date',
            label: '迄',
            rules: [
              { check: { kind: 'compare', op: 'gte', field: 'start' }, message: '迄日不可早於起日' },
              { when: { field: 'kind', op: 'eq', value: 'a' }, check: { kind: 'min_days_from_today', days: 2 }, message: '至少兩天' },
            ],
          },
          { id: 'note', type: 'text', label: '說明', requiredWhen: { field: 'kind', op: 'eq', value: 'b' } },
          {
            id: 'lines',
            type: 'table',
            label: '明細',
            currencyField: 'ccy',
            totalColumn: 'amt',
            columns: [{ id: 'amt', label: '金額', type: 'money', min: 0.01 }],
          },
          { id: 'tax', type: 'money', label: '含稅', currencyField: 'ccy', rules: [{ check: { kind: 'compare', op: 'gte', field: 'lines' }, message: '不可小於合計' }] },
        ],
        { onBehalf: true }
      )
    );
    expect(s.onBehalf).toBe(true);
    const fields = s.sections[0].fields;
    expect(fields.find((f) => f.id === 'end')?.rules).toHaveLength(2);
    expect(fields.find((f) => f.id === 'note')?.requiredWhen).toEqual({ field: 'kind', op: 'eq', value: 'b' });
    const lines = fields.find((f) => f.id === 'lines');
    expect(lines?.currencyField).toBe('ccy');
    expect(lines?.type === 'table' && lines.columns[0].min).toBe(0.01);
  });

  it('rejects rules and references that point forward or at the wrong type', () => {
    expect(errorsOf(one([{ id: 'end', type: 'date', label: '迄', rules: [{ check: { kind: 'compare', op: 'gte', field: 'start' }, message: 'x' }] }, { id: 'start', type: 'date', label: '起' }])).join()).toContain('排在前面');
    expect(errorsOf(one([{ id: 'n', type: 'number', label: '數', rules: [{ check: { kind: 'min_days_from_today', days: 1 }, message: 'x' }] }])).join()).toContain('只有日期');
    expect(errorsOf(one([{ id: 't', type: 'text', label: '文', rules: [{ check: { kind: 'min_days_from_today', days: 1 }, message: 'x' }] }])).join()).toContain('只能設定「不可填入」');
    expect(errorsOf(one([{ id: 'b', type: 'boolean', label: '是否', rules: [{ check: { kind: 'not_equal', value: 'x' }, message: 'x' }] }])).join()).toContain('不能設定檢查規則');
    expect(errorsOf(one([{ id: 'd', type: 'date', label: '日', rules: [{ check: { kind: 'min_days_from_today', days: 1 }, message: '' }] }])).length).toBeGreaterThan(0);
    expect(errorsOf(one([{ id: 'm', type: 'money', label: '額', currencyField: 'ccy' }, { id: 'ccy', type: 'select', label: '幣', options: [{ value: 'USD', label: 'USD' }] }])).length).toBeGreaterThan(0);
    expect(
      errorsOf(one([{ id: 'ccy', type: 'select', label: '幣', options: [{ value: 'USD', label: 'USD' }] }, { id: 'm', type: 'money', label: '額', currencyField: 'ccy', semantic: 'amount' }])).length
    ).toBeGreaterThan(0);
    expect(errorsOf(one([{ id: 'b', type: 'boolean', label: '是否', requiredWhen: { field: 'x', op: 'filled' } }])).length).toBeGreaterThan(0);
    expect(errorsOf(one([{ id: 't', type: 'table', label: '表', columns: [{ id: 'a', label: 'a', type: 'money', min: -1 }] }])).length).toBeGreaterThan(0);
  });
});

describe('validate: the new properties', () => {
  const s = schemaOf(
    one([
      { id: 'kind', type: 'radio', label: '類型', required: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { id: 'start', type: 'date', label: '起', required: true },
      {
        id: 'end',
        type: 'date',
        label: '迄',
        required: true,
        notBeforeToday: true,
        rules: [
          { check: { kind: 'compare', op: 'gte', field: 'start' }, message: '迄日不可早於起日' },
          { when: { field: 'kind', op: 'eq', value: 'a' }, check: { kind: 'min_days_from_today', days: 2 }, message: '至少兩天' },
        ],
      },
      { id: 'note', type: 'text', label: '說明', requiredWhen: { field: 'kind', op: 'eq', value: 'b' } },
      { id: 'lines', type: 'table', label: '明細', required: true, totalColumn: 'amt', columns: [{ id: 'qty', label: '數', type: 'number', required: true, min: 1 }, { id: 'amt', label: '額', type: 'money', required: true, min: 0.01 }] },
      { id: 'tax', type: 'money', label: '含稅', required: true, rules: [{ check: { kind: 'compare', op: 'gte', field: 'lines' }, message: '不可小於合計' }] },
    ])
  );
  const ok = { kind: 'b', start: '2026-10-13', end: '2026-10-14', note: '補充', lines: { rows: [{ qty: '1', amt: '100' }] }, tax: '105' };
  const run = (over: Record<string, unknown>) => validateSubmission(s, { ...ok, ...over }, TODAY);

  it('accepts a valid submission', () => {
    expect(run({}).ok).toBe(true);
  });

  it('applies rules only while their condition holds', () => {
    expect(run({ kind: 'a', note: '' }).ok).toBe(false);
    const r = run({ kind: 'a', note: '' });
    if (!r.ok) expect(r.errors.end).toContain('至少兩天');
    expect(run({ kind: 'a', end: '2026-10-15' }).ok).toBe(true);
  });

  it('compares with earlier fields and table totals', () => {
    const r = run({ start: '2026-10-20', end: '2026-10-19' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.end).toContain('迄日不可早於起日');
    const t = run({ tax: '99.99' });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.errors.tax).toContain('不可小於合計');
  });

  it('makes a field required by condition', () => {
    const r = run({ note: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(['note']);
  });

  it('enforces column minimums', () => {
    const r = run({ lines: { rows: [{ qty: '0', amt: '0' }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['lines.0.amt', 'lines.0.qty']);
  });

  it('minDate combines notBeforeToday with active day rules', () => {
    const end = s.sections[0].fields.find((f) => f.id === 'end')!;
    expect(minDate(end, { kind: 'b' }, TODAY)).toBe('2026-10-13');
    expect(minDate(end, { kind: 'a' }, TODAY)).toBe('2026-10-15');
  });
});

describe('catalog: designer forms replacing hard-coded ones', () => {
  const base: FormCategory[] = [
    {
      id: 'seal',
      title: '用印申請',
      description: '',
      forms: [
        { title: '舊合約類', description: '', href: '/seal-requests/contracts/new', legacyType: 'contract_seal_request' },
        { title: '舊非合約類', description: '', href: '/seal-requests/general/new', legacyType: 'general_seal_request' },
      ],
      records: [{ label: '我的用印申請', href: '/seal-requests' }],
    },
  ];
  const designer = (key: string, legacyFormType: string | null) => ({
    key,
    name: `新${key}`,
    description: '',
    categoryKey: 'seal',
    categoryTitle: '用印申請',
    categoryDescription: '',
    legacyFormType,
  });

  it('takes over the entry in place and keeps the old records link', () => {
    const merged = mergeCatalog([designer('contract-seal', 'contract_seal_request')], base, { contract_seal_request: 'contract-seal' });
    expect(merged[0].forms.map((f) => f.href)).toEqual(['/f/contract-seal/new', '/seal-requests/general/new']);
    expect(merged[0].records).toEqual([{ label: '我的用印申請', href: '/seal-requests' }]);
  });

  it('drops a retired entry for viewers who may not file the replacement', () => {
    const merged = mergeCatalog([], base, { contract_seal_request: 'contract-seal' });
    expect(merged[0].forms.map((f) => f.href)).toEqual(['/seal-requests/general/new']);
  });

  it('leaves built-in entries alone while nothing replaced them', () => {
    const merged = mergeCatalog([designer('other', null)], base, {});
    expect(merged[0].forms.map((f) => f.href)).toEqual(['/seal-requests/contracts/new', '/seal-requests/general/new', '/f/other/new']);
    expect(merged[0].records.map((r) => r.href)).toEqual(['/seal-requests', '/f/other']);
  });
});

describe('table columns: rate / row currency / default / max length / column rules', () => {
  const ccy = { id: 'ccy', label: '幣別', type: 'select', required: true, options: [{ value: 'TWD', label: '新臺幣' }, { value: 'USD', label: '美元' }, { value: 'XYZ', label: '其他' }], default: 'TWD' };
  const amount = { id: 'amt', label: '金額', type: 'money', required: true, min: 0.01, currencyColumn: 'ccy' };
  const rate = { id: 'rate', label: '匯率', type: 'number', required: false, decimals: 6, rateFor: 'ccy' };
  const twd = { id: 'twd', label: '新臺幣', type: 'money', required: false, min: 0.01, formula: { op: 'multiply', of: ['amt', 'rate'] } };
  const table = (columns: unknown[], extra: Record<string, unknown> = {}) => ({ id: 'lines', type: 'table', label: '明細', required: true, columns, totalColumn: 'twd', ...extra });
  const tableErrors = (columns: unknown[], extra: Record<string, unknown> = {}) => errorsOf(one([{ id: 'start', type: 'date', label: '起' }, table(columns, extra)]));

  it('accepts a currency / rate / converted-amount table', () => {
    const s = schemaOf(one([table([ccy, amount, rate, twd])]));
    const col = (s.sections[0].fields[0] as Extract<FormSchema['sections'][0]['fields'][0], { type: 'table' }>).columns;
    expect(col.map((c) => [c.id, c.rateFor ?? c.currencyColumn ?? c.default ?? null])).toEqual([
      ['ccy', 'TWD'],
      ['amt', 'ccy'],
      ['rate', 'ccy'],
      ['twd', null],
    ]);
  });

  it('rejects misconfigured columns', () => {
    expect(tableErrors([amount, ccy, rate, twd]).join()).toBe('');
    expect(tableErrors([ccy, amount, { ...rate, rateFor: 'amt' }, twd]).join()).toContain('匯率欄需對應排在前面的下拉選單');
    expect(tableErrors([amount, rate, ccy, twd]).join()).toContain('匯率欄需對應排在前面的下拉選單');
    expect(tableErrors([ccy, { ...amount, type: 'number', decimals: 0 }, rate, twd]).join()).toContain('只有金額欄可以指定幣別欄');
    expect(tableErrors([{ ...ccy, default: 'EUR' }, amount, rate, twd]).join()).toContain('預設選項不在選項中');
    expect(tableErrors([ccy, amount, rate, twd], { totalColumn: 'amt' }).join()).toContain('每列幣別不同的金額欄不能加總');
    expect(tableErrors([{ id: 'd', label: '日', type: 'date', required: true, rules: [{ check: { kind: 'compare', op: 'gte', field: 'later' }, message: 'x' }] }], { totalColumn: null }).join()).toContain(
      '只能和排在這個明細表前面的日期欄位比較'
    );
    expect(tableErrors([{ id: 't', label: '文字', type: 'text', required: false, rules: [{ check: { kind: 'compare', op: 'gte', field: 'start' }, message: 'x' }] }], { totalColumn: null }).join()).toContain(
      '此欄位類型不能設定檢查規則'
    );
  });

  it('converts exactly, fixes NT$ rows at 1, checks bands and only for known currencies', () => {
    const s = schemaOf(one([table([ccy, amount, rate, twd], { semantic: 'amount' })]));
    const run = (rows: Record<string, unknown>[]) => validateSubmission(s, { lines: { rows } }, TODAY);
    const ok = run([
      { ccy: 'USD', amt: '0.05', rate: '30.1' },
      { ccy: 'TWD', amt: '10', rate: '999' },
      { ccy: 'XYZ', amt: '3', rate: '1000' },
    ]);
    if (!ok.ok) throw new Error(JSON.stringify(ok.errors));
    // 0.05 × 30.1 = 1.505 → 1.51 (half-up), 10 × 1, 3 × 1000
    expect(ok.value.promoted.totalAmount).toBe('3011.51');
    const bad = run([{ ccy: 'USD', amt: '10', rate: '' }, { ccy: 'USD', amt: '10', rate: '0' }]);
    expect(bad.ok ? {} : bad.errors).toEqual({
      'lines.0.rate': '第 1 列「匯率」：外幣請填匯率',
      'lines.1.rate': '第 2 列「匯率」：匯率必須是大於 0 的數字（最多 6 位小數）',
    });
  });

  it('applies text max length and column rules against earlier fields', () => {
    const s = schemaOf(
      one([
        { id: 'start', type: 'date', label: '起' },
        {
          id: 'rows',
          type: 'table',
          label: '行程',
          columns: [
            { id: 'd', label: '日期', type: 'date', required: true, rules: [{ check: { kind: 'compare', op: 'gte', field: 'start' }, message: '不可早於起日' }] },
            { id: 'note', label: '說明', type: 'text', required: false, maxLength: 3 },
          ],
        },
      ])
    );
    const r = validateSubmission(s, { start: '2026-10-05', rows: { rows: [{ d: '2026-10-04', note: 'abcd' }, { d: '2026-10-05', note: 'abc' }] } }, TODAY);
    expect(r.ok ? {} : r.errors).toEqual({ 'rows.0.d': '第 1 列「日期」：不可早於起日', 'rows.0.note': '第 1 列「說明」：最多 3 字' });
  });

  it('caps a computed column only on rows of the listed options', () => {
    const cat = { id: 'cat', label: '項目', type: 'select', required: true, options: [{ value: 'material', label: '材料' }, { value: 'other', label: '其他' }], default: 'material' };
    const capped = { ...twd, rules: [{ check: { kind: 'max', value: 10000 }, when: { column: 'cat', in: ['material'] }, message: '單筆不可超過新臺幣 10,000 元' }] };
    const s = schemaOf(one([table([cat, ccy, amount, rate, capped])]));
    const run = (rows: Record<string, unknown>[]) => validateSubmission(s, { lines: { rows } }, TODAY);
    expect(run([{ cat: 'material', ccy: 'TWD', amt: '10000' }]).ok).toBe(true);
    expect(run([{ cat: 'other', ccy: 'TWD', amt: '50000' }]).ok).toBe(true);
    const over = run([{ cat: 'material', ccy: 'USD', amt: '400', rate: '30' }]);
    expect(over.ok ? {} : over.errors).toEqual({ 'lines.0.twd': '第 1 列「新臺幣」：單筆不可超過新臺幣 10,000 元' });
  });

  it('rejects max rules on dates and when-conditions that are not select options of the same table', () => {
    const cat = { id: 'cat', label: '項目', type: 'select', required: true, options: [{ value: 'a', label: 'A' }] };
    const withRule = (rule: unknown, extra: unknown[] = []) => tableErrors([cat, ...extra, { ...amount, currencyColumn: undefined, rules: [rule] }], { totalColumn: null }).join();
    expect(withRule({ check: { kind: 'max', value: 5 }, when: { column: 'cat', in: ['a'] }, message: 'x' })).toBe('');
    expect(withRule({ check: { kind: 'max', value: 5 }, when: { column: 'cat', in: ['zzz'] }, message: 'x' })).toContain('不在「項目」的選項中');
    expect(withRule({ check: { kind: 'max', value: 5 }, when: { column: 'missing', in: ['a'] }, message: 'x' })).toContain('需為同一明細表的下拉選單欄');
    expect(withRule({ check: { kind: 'max', value: -1 }, message: 'x' })).toContain('上限需為 0 以上');
    expect(
      tableErrors([{ id: 'd', label: '日', type: 'date', required: true, rules: [{ check: { kind: 'max', value: 5 }, message: 'x' }] }], { totalColumn: null }).join()
    ).toContain('日期欄不能設定上限');
  });
});

describe('text not_equal / select default / budget scope / supplier', () => {
  const s = schemaOf(
    one([
      { id: 'pay', type: 'select', label: '付款方式', required: true, options: [{ value: 'transfer', label: '匯款' }, { value: 'cash', label: '現金' }], default: 'transfer' },
      {
        id: 'bank',
        type: 'textarea',
        label: '匯款資訊',
        required: true,
        sensitive: true,
        rules: [{ when: { field: 'pay', op: 'eq', value: 'transfer' }, check: { kind: 'not_equal', value: '無' }, message: '付款方式為匯款時，請填入銀行資訊' }],
      },
      { id: 'budget', type: 'budget_code', label: '預算', required: true, budgetScope: 'revenue' },
      { id: 'vendor', type: 'supplier', label: '廠商', required: false },
    ])
  );
  const B = '11111111-1111-4111-8111-111111111111';
  const V = '22222222-2222-4222-8222-222222222222';

  it('keeps the new options', () => {
    const f = Object.fromEntries(s.sections[0].fields.map((x) => [x.id, x]));
    expect(f.pay.type === 'select' && f.pay.default).toBe('transfer');
    expect(f.bank.type === 'textarea' && f.bank.sensitive).toBe(true);
    expect(f.budget.type === 'budget_code' && f.budget.budgetScope).toBe('revenue');
    expect(f.vendor.type).toBe('supplier');
  });

  it('rejects a default outside the options and an unknown budget scope', () => {
    expect(errorsOf(one([{ id: 'p', type: 'radio', label: '選', options: [{ value: 'a', label: 'A' }], default: 'b' }])).join()).toContain('預設選項不在選項中');
    expect(errorsOf(one([{ id: 'b', type: 'budget_code', label: '預算', budgetScope: 'galaxy' }])).join()).toContain('預算範圍不正確');
  });

  it('applies not_equal (trimmed) only while its condition holds and collects scoped refs', () => {
    const run = (pay: string, bank: string) => validateSubmission(s, { pay, bank, budget: B, vendor: V }, TODAY);
    expect(run('transfer', ' 無 ')).toMatchObject({ ok: false, errors: { bank: '「匯款資訊」：付款方式為匯款時，請填入銀行資訊' } });
    expect(run('cash', '無').ok).toBe(true);
    const ok = run('transfer', '台灣銀行 王小明 123456789');
    if (!ok.ok) throw new Error(JSON.stringify(ok.errors));
    expect(ok.value.refs.budgetScopes).toEqual([{ id: B, scope: 'revenue' }]);
    expect(ok.value.refs.suppliers).toEqual([V]);
    expect(validateSubmission(s, { pay: 'cash', bank: '無', budget: B, vendor: 'not-a-uuid' }, TODAY).ok).toBe(false);
  });
});

describe('sensitive fields', () => {
  const s = schemaOf(one([{ id: 'bank', type: 'text', label: '帳號', sensitive: true }, { id: 'note', type: 'text', label: '備註' }]));
  const parties = { applicantId: 'a', filerId: 'f' };

  it('masks all but the last four digits for viewers outside applicant / filer / finance / admin', () => {
    expect(maskSensitive(s, { bank: '台銀 012-3456789', note: '1234567' })).toEqual({ bank: '台銀 ＊＊＊-＊＊＊6789', note: '1234567' });
    expect(canSeeSensitive({ id: 'a', role: 'staff' }, parties)).toBe(true);
    expect(canSeeSensitive({ id: 'f', role: 'staff' }, parties)).toBe(true);
    expect(canSeeSensitive({ id: 'x', role: 'finance' }, parties)).toBe(true);
    expect(canSeeSensitive({ id: 'x', role: 'admin' }, parties)).toBe(true);
    expect(canSeeSensitive({ id: 'x', role: 'staff' }, parties)).toBe(false);
  });
});

describe('publish summary', () => {
  it('reports turning 代為申請 on or off', () => {
    const flow = { version: 1 as const, blocks: [], options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'auto_approve' as const } };
    const schema: FormSchema = { version: 1, sections: [{ id: 's', title: '', description: '', fields: [] }] };
    expect(changeSummary({ schema, flow }, { schema: { ...schema, onBehalf: true }, flow }).onBehalfChanged).toBe(true);
    expect(changeSummary({ schema, flow }, { schema, flow }).onBehalfChanged).toBe(false);
  });
});
