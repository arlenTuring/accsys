import { CONDITION_OPS, type Condition, type ConditionOp } from '@/lib/approval/flow/types';
import { ASSET_TRANSFER_TYPES } from '@/lib/asset-transfers/constants';

/**
 * Field layout of a designer form ("schema" of a definition version). Stored
 * as JSON, so parseFormSchema() validates every shape before it is trusted;
 * the renderer, the server validator and the designer all read this type.
 * Client-safe: no server imports.
 */

export type FieldOption = { value: string; label: string };

export type ColumnType = 'text' | 'number' | 'money' | 'date' | 'select' | 'employee' | 'asset';

export type TableColumn = {
  id: string;
  label: string;
  type: ColumnType;
  required: boolean;
  /** text / select / employee / asset columns: no two rows may hold the same value. */
  unique?: boolean;
  /**
   * select columns: only the options ticked in this earlier checkboxes field
   * (whose options include every option of the column); with coverAll, every
   * ticked option must be used by at least one row.
   */
  pickFrom?: { field: string; coverAll: boolean };
  /** number columns */
  decimals?: number;
  /** select columns */
  options?: FieldOption[];
  /** select columns: option picked on a new row. */
  default?: string;
  /** text columns: longest value (500 when unset). */
  maxLength?: number;
  /** number / money columns: smallest value allowed (also checked on formula results). */
  min?: number | null;
  /** Read-only column the server recomputes (e.g. 數量 × 單價). */
  formula?: { op: 'multiply'; of: [string, string] };
  /**
   * number columns: exchange rate for the currency picked in this earlier
   * select column of the row — fixed at 1 for NT$, otherwise required, > 0
   * and within the plausible band of known currencies.
   */
  rateFor?: string;
  /** money columns: amount is in the currency picked in this select column of the row. */
  currencyColumn?: string;
  /**
   * date / number / money columns: checks against an earlier form field (e.g. 日期 within 出差期間);
   * number / money columns (formula results included) may also have a per-row ceiling.
   */
  rules?: ColumnRule[];
};

export type ColumnRule = {
  check: { kind: 'compare'; op: RuleCompareOp; field: string } | { kind: 'max'; value: number };
  /** Only on rows whose select column (same table) holds one of these options. */
  when?: { column: string; in: string[] };
  message: string;
};

export const BUDGET_SCOPES = ['department', 'product', 'revenue'] as const;
/** Budget codes a budget_code field offers: department codes, or codes of 產品／營收 projects. */
export type BudgetScope = (typeof BUDGET_SCOPES)[number];
export const BUDGET_SCOPE_LABELS: Record<BudgetScope, string> = { department: '部門', product: '產品專案', revenue: '營收專案' };

export type FieldSemantic = 'amount' | 'budget_code' | 'project';

export const RULE_COMPARE_OPS = ['gte', 'gt', 'lte', 'lt'] as const;
export type RuleCompareOp = (typeof RULE_COMPARE_OPS)[number];

/**
 * Cross-field check applied while `when` holds: date / number / money fields
 * (一般件 needs two days' lead time; 結束日 not before 起始日), or a text value
 * that is not allowed (匯款 needs real bank details, not 「無」).
 * Both `when` and `check.field` may only look at fields placed before.
 */
export type FieldRule = {
  when?: Condition;
  check:
    | { kind: 'min_days_from_today'; days: number }
    | { kind: 'compare'; op: RuleCompareOp; field: string }
    | { kind: 'not_equal'; value: string };
  message: string;
};

type FieldBase = {
  id: string;
  label: string;
  help: string;
  required: boolean;
  /** Required only while this holds (in addition to `required`); may test earlier fields. */
  requiredWhen?: Condition;
  /** Columns of a 4-column grid. */
  width: 1 | 2 | 3 | 4;
  /** Shown only while this holds; may test fields placed before this one. */
  visibleWhen?: Condition;
  /** Also shown in the header card of the detail page. */
  showInHeader: boolean;
  /** Copied into a typed column on submit (finance tracking, budget lookups). */
  semantic?: FieldSemantic;
  /** date / number / money fields. */
  rules?: FieldRule[];
  /** money / table fields: an earlier select or radio whose option codes are currency codes (shown instead of NT$). */
  currencyField?: string;
};

export type FieldDef = FieldBase &
  (
    | { type: 'text'; maxLength: number; format: 'plain' | 'email' | 'phone' | 'tax_id'; sensitive?: boolean }
    | { type: 'textarea'; maxLength: number; rows: number; sensitive?: boolean }
    | { type: 'number'; min: number | null; max: number | null; decimals: number }
    | { type: 'money'; max: number | null }
    | { type: 'date'; notBeforeToday: boolean }
    | { type: 'select' | 'radio'; options: FieldOption[]; default?: string }
    | { type: 'checkboxes'; options: FieldOption[]; minSelected: number; maxSelected: number | null }
    | { type: 'boolean'; trueLabel: string; falseLabel: string }
    | { type: 'employee' }
    | { type: 'department' }
    | { type: 'budget_code'; budgetScope?: BudgetScope }
    | { type: 'project' }
    | { type: 'supplier' }
    | { type: 'asset' }
    | { type: 'table'; columns: TableColumn[]; minRows: number; maxRows: number; totalColumn: string | null }
    | { type: 'attachments'; maxFiles: number | null }
    | { type: 'notice'; text: string }
  );

export type FieldType = FieldDef['type'];

export type FormSection = { id: string; title: string; description: string; fields: FieldDef[] };

/**
 * 財產清冊串接: each row of `table` moves one asset. On submit the assets are
 * locked and checked (still in the register, not on another pending form,
 * custodians cover every row); once approved the rows are written into the
 * register. Reason options are asset transfer types (register status after).
 */
export type AssetRegisterLink = {
  table: string;
  columns: { asset: string; reason: string; newCustodian: string; newLocation: string };
  custodians: { original: string; new: string; other: string | null };
};

export type FormSchema = {
  version: 1;
  sections: FormSection[];
  /** 代為申請: the filer may name another employee as applicant, who confirms first. */
  onBehalf?: boolean;
  assetRegister?: AssetRegisterLink;
};

export const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'textarea',
  'number',
  'money',
  'date',
  'select',
  'radio',
  'checkboxes',
  'boolean',
  'employee',
  'department',
  'budget_code',
  'project',
  'supplier',
  'asset',
  'table',
  'attachments',
  'notice',
];

/** Fields that hold no value in the submission data. */
export const isDisplayOnly = (f: FieldDef) => f.type === 'notice' || f.type === 'attachments';

export const SCHEMA_LIMITS = {
  sections: 30,
  fields: 200,
  columns: 20,
  rows: 200,
  options: 200,
  label: 60,
  help: 300,
  notice: 2000,
  textMax: 2000,
  textareaMax: 10000,
  conditionDepth: 4,
  rules: 5,
  ruleMessage: 200,
} as const;

const ID = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const COLUMN_TYPES: readonly ColumnType[] = ['text', 'number', 'money', 'date', 'select', 'employee', 'asset'];
const UNIQUE_COLUMN_TYPES: readonly ColumnType[] = ['text', 'select', 'employee', 'asset'];
const SEMANTIC_TYPES: Record<FieldSemantic, readonly FieldType[]> = {
  amount: ['money', 'table'],
  budget_code: ['budget_code'],
  project: ['project'],
};
/** Field types a condition can test (scalar or list values). */
const CONDITION_FIELD_TYPES: readonly FieldType[] = [
  'text',
  'number',
  'money',
  'date',
  'select',
  'radio',
  'checkboxes',
  'boolean',
  'employee',
  'department',
  'budget_code',
  'project',
  'asset',
  'table',
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export type ParseSchemaResult = { ok: true; schema: FormSchema } | { ok: false; errors: string[] };

export function parseFormSchema(raw: unknown): ParseSchemaResult {
  const errors: string[] = [];
  const fieldIds = new Set<string>();
  /** field id -> type, of fields placed so far (visibleWhen may only look back). */
  const earlier = new Map<string, FieldType>();
  /** Fields placed so far, for rules that compare against one of them. */
  const earlierDefs = new Map<string, FieldDef>();
  const semantics = new Set<FieldSemantic>();
  let fieldCount = 0;
  let attachmentFields = 0;

  const text = (v: unknown, where: string, max: number, required: boolean): string => {
    if (v === undefined || v === null) {
      if (required) errors.push(`${where}：必填`);
      return '';
    }
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) {
      errors.push(`${where}：需為${required ? ' 1–' : '最多 '}${max} 字`);
      return '';
    }
    return v.trim();
  };
  const int = (v: unknown, where: string, min: number, max: number, fallback: number): number => {
    if (v === undefined || v === null) return fallback;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      errors.push(`${where}：需為 ${min}–${max} 的整數`);
      return fallback;
    }
    return v;
  };
  const optionalNumber = (v: unknown, where: string): number | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${where}：需為數字`);
      return null;
    }
    return v;
  };
  const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
  const options = (v: unknown, where: string): FieldOption[] => {
    if (!Array.isArray(v) || v.length === 0 || v.length > SCHEMA_LIMITS.options) {
      errors.push(`${where}：需有 1–${SCHEMA_LIMITS.options} 個選項`);
      return [];
    }
    const seen = new Set<string>();
    return v.map((o, i) => {
      const at = `${where} 第 ${i + 1} 個選項`;
      if (!isObj(o)) {
        errors.push(`${at}：格式不正確`);
        return { value: '', label: '' };
      }
      const value = text(o.value, `${at} 代碼`, 100, true);
      if (seen.has(value)) errors.push(`${at}：代碼 ${value} 重複`);
      seen.add(value);
      return { value, label: text(o.label, `${at} 名稱`, 100, true) };
    });
  };
  const newId = (v: unknown, where: string, scope: Set<string>): string => {
    if (typeof v !== 'string' || !ID.test(v)) {
      errors.push(`${where}：代號需以英文字母開頭，只含英數字與底線（最多 40 字）`);
      return '';
    }
    if (scope.has(v)) errors.push(`${where}：代號 ${v} 重複`);
    scope.add(v);
    return v;
  };

  const condition = (v: unknown, where: string, depth: number): Condition => {
    if (depth > SCHEMA_LIMITS.conditionDepth || !isObj(v)) {
      errors.push(`${where}：顯示條件格式不正確`);
      return { all: [] };
    }
    if ('all' in v || 'any' in v) {
      const key = 'all' in v ? 'all' : 'any';
      const list = v[key];
      if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
        errors.push(`${where}：條件群組需有 1–20 個條件`);
        return { all: [] };
      }
      const parsed = list.map((c) => condition(c, where, depth + 1));
      return key === 'all' ? { all: parsed } : { any: parsed };
    }
    if ('not' in v) return { not: condition(v.not, where, depth + 1) };
    const field = typeof v.field === 'string' ? v.field : '';
    const type = earlier.get(field);
    if (!type || !CONDITION_FIELD_TYPES.includes(type)) {
      errors.push(`${where}：顯示條件只能參考排在前面的欄位`);
    }
    const op = v.op;
    if (typeof op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(op)) {
      errors.push(`${where}：比較方式不正確`);
      return { all: [] };
    }
    const scalar = (x: unknown) =>
      (typeof x === 'string' && x.length <= 200) || (typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean';
    if (op === 'filled' || op === 'empty') return { field, op };
    if (op === 'in' || op === 'not_in') {
      if (!Array.isArray(v.value) || v.value.length === 0 || v.value.length > 200 || !v.value.every(scalar)) {
        errors.push(`${where}：比較值清單不正確`);
      }
    } else if (!scalar(v.value)) {
      errors.push(`${where}：比較值不正確`);
    }
    return { field, op: op as ConditionOp, value: v.value };
  };

  /** Whether a rule on a date / number value may compare against this earlier field. */
  const comparable = (type: FieldType | ColumnType, fieldId: unknown): boolean => {
    const other = typeof fieldId === 'string' ? earlierDefs.get(fieldId) : undefined;
    if (!other) return false;
    if (type === 'date') return other.type === 'date';
    return other.type === 'number' || other.type === 'money' || (other.type === 'table' && other.totalColumn !== null);
  };

  const columnRules = (v: unknown, type: ColumnType, where: string): ColumnRule[] => {
    if (type !== 'date' && type !== 'number' && type !== 'money') {
      errors.push(`${where}：此欄位類型不能設定檢查規則`);
      return [];
    }
    if (!Array.isArray(v) || v.length > SCHEMA_LIMITS.rules) {
      errors.push(`${where}：檢查規則最多 ${SCHEMA_LIMITS.rules} 條`);
      return [];
    }
    return v.map((r, i): ColumnRule => {
      const at = `${where} 第 ${i + 1} 條檢查規則`;
      const c = isObj(r) && isObj(r.check) ? r.check : null;
      const message = text(isObj(r) ? r.message : undefined, `${at} 提示訊息`, SCHEMA_LIMITS.ruleMessage, true);
      let check: ColumnRule['check'];
      if (c?.kind === 'max') {
        if (type === 'date') errors.push(`${at}：日期欄不能設定上限`);
        if (typeof c.value !== 'number' || !Number.isFinite(c.value) || c.value < 0) errors.push(`${at}：上限需為 0 以上的數字`);
        check = { kind: 'max', value: typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : 0 };
      } else {
        const op = RULE_COMPARE_OPS.find((o) => o === c?.op);
        if (!c || c.kind !== 'compare' || !op) errors.push(`${at}：格式不正確`);
        else if (!comparable(type, c.field)) errors.push(`${at}：只能和排在這個明細表前面的${type === 'date' ? '日期' : '數字、金額或明細合計'}欄位比較`);
        check = { kind: 'compare', op: op ?? 'gte', field: typeof c?.field === 'string' ? c.field : '' };
      }
      const rule: ColumnRule = { check, message };
      const w = isObj(r) ? r.when : undefined;
      if (w !== undefined && w !== null) {
        const list = isObj(w) && Array.isArray(w.in) ? w.in : null;
        if (!isObj(w) || typeof w.column !== 'string' || !list || list.length === 0 || list.length > SCHEMA_LIMITS.options || !list.every((x) => typeof x === 'string')) {
          errors.push(`${at}：適用條件格式不正確`);
        } else {
          rule.when = { column: w.column, in: [...new Set(list as string[])] };
        }
      }
      return rule;
    });
  };

  const column = (v: unknown, where: string, scope: Set<string>): TableColumn => {
    if (!isObj(v)) {
      errors.push(`${where}：格式不正確`);
      return { id: '', label: '', type: 'text', required: false };
    }
    const id = newId(v.id, where, scope);
    const label = text(v.label, `${where} 名稱`, SCHEMA_LIMITS.label, true);
    const type = v.type as ColumnType;
    if (!COLUMN_TYPES.includes(type)) errors.push(`${where}：欄位類型不正確`);
    const col: TableColumn = { id, label, type, required: bool(v.required) };
    if (type === 'number') col.decimals = int(v.decimals, `${where} 小數位數`, 0, 6, 0);
    if (type === 'text' && v.maxLength !== undefined && v.maxLength !== null) {
      col.maxLength = int(v.maxLength, `${where} 字數上限`, 1, SCHEMA_LIMITS.textMax, 500);
    }
    if ((type === 'number' || type === 'money') && v.min !== undefined && v.min !== null) {
      col.min = optionalNumber(v.min, `${where} 最小值`);
      if (type === 'money' && col.min !== null && col.min < 0) errors.push(`${where}：金額最小值不可為負數`);
    }
    if (type === 'select') {
      col.options = options(v.options, where);
      if (v.default !== undefined && v.default !== null && v.default !== '') {
        if (typeof v.default !== 'string' || !col.options.some((o) => o.value === v.default)) errors.push(`${where}：預設選項不在選項中`);
        else col.default = v.default;
      }
    }
    if (v.unique === true) {
      if (!UNIQUE_COLUMN_TYPES.includes(type)) errors.push(`${where}：此欄位類型不能設定「不可重複」`);
      else col.unique = true;
    }
    if (v.pickFrom !== undefined && v.pickFrom !== null) {
      const p = v.pickFrom;
      const src = isObj(p) && typeof p.field === 'string' ? earlierDefs.get(p.field) : undefined;
      if (type !== 'select') errors.push(`${where}：只有下拉選單欄可以限定為已勾選的選項`);
      else if (!src || src.type !== 'checkboxes') errors.push(`${where}：限定選項需對應排在這個明細表前面的核取方塊欄位`);
      else if ((col.options ?? []).some((o) => !src.options.some((x) => x.value === o.value))) {
        errors.push(`${where}：選項需都在「${src.label}」的選項中`);
      } else col.pickFrom = { field: src.id, coverAll: isObj(p) && p.coverAll === true };
    }
    for (const key of ['rateFor', 'currencyColumn'] as const) {
      const ref = v[key];
      if (ref === undefined || ref === null || ref === '') continue;
      if (typeof ref !== 'string') errors.push(`${where}：${key === 'rateFor' ? '匯率' : '幣別'}欄設定不正確`);
      else col[key] = ref;
    }
    if (v.rules !== undefined && v.rules !== null) {
      const list = columnRules(v.rules, type, where);
      if (list.length > 0) col.rules = list;
    }
    if (v.formula !== undefined && v.formula !== null) {
      const f = v.formula;
      if (!isObj(f) || f.op !== 'multiply' || !Array.isArray(f.of) || f.of.length !== 2 || !f.of.every((x) => typeof x === 'string')) {
        errors.push(`${where}：計算式格式不正確`);
      } else {
        col.formula = { op: 'multiply', of: [f.of[0] as string, f.of[1] as string] };
      }
      col.required = false;
    }
    return col;
  };

  const rules = (v: unknown, type: FieldType, name: string): FieldRule[] => {
    const isText = type === 'text' || type === 'textarea';
    if (type !== 'date' && type !== 'number' && type !== 'money' && !isText) {
      errors.push(`${name}：此元件不能設定檢查規則`);
      return [];
    }
    if (!Array.isArray(v) || v.length > SCHEMA_LIMITS.rules) {
      errors.push(`${name}：檢查規則最多 ${SCHEMA_LIMITS.rules} 條`);
      return [];
    }
    return v
      .map((r, i): FieldRule | null => {
        const at = `${name} 第 ${i + 1} 條檢查規則`;
        if (!isObj(r) || !isObj(r.check)) {
          errors.push(`${at}：格式不正確`);
          return null;
        }
        const message = text(r.message, `${at} 提示訊息`, SCHEMA_LIMITS.ruleMessage, true);
        const c = r.check;
        let check: FieldRule['check'];
        if (isText !== (c.kind === 'not_equal')) {
          errors.push(`${at}：${isText ? '文字欄位只能設定「不可填入」規則' : '只有文字欄位可以設定「不可填入」規則'}`);
          return null;
        }
        if (c.kind === 'not_equal') {
          check = { kind: 'not_equal', value: text(c.value, `${at} 不可填入的內容`, 200, true) };
        } else if (c.kind === 'min_days_from_today') {
          if (type !== 'date') errors.push(`${at}：只有日期欄位可以限制天數`);
          check = { kind: 'min_days_from_today', days: int(c.days, `${at} 天數`, 0, 365, 0) };
        } else if (c.kind === 'compare') {
          const op = RULE_COMPARE_OPS.find((o) => o === c.op);
          if (!op) errors.push(`${at}：比較方式不正確`);
          if (!comparable(type, c.field)) errors.push(`${at}：只能和排在前面的${type === 'date' ? '日期' : '數字、金額或明細合計'}欄位比較`);
          check = { kind: 'compare', op: op ?? 'gte', field: typeof c.field === 'string' ? c.field : '' };
        } else {
          errors.push(`${at}：規則類型不正確`);
          return null;
        }
        const rule: FieldRule = { check, message };
        if (r.when !== undefined && r.when !== null) rule.when = condition(r.when, at, 1);
        return rule;
      })
      .filter((r): r is FieldRule => r !== null);
  };

  const checkTable = (columns: TableColumn[], totalColumn: string | null, where: string) => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    for (const c of columns) {
      if (!c.formula) continue;
      if (c.type !== 'number' && c.type !== 'money') errors.push(`${where}「${c.label}」：只有數字或金額欄可以計算`);
      const parts = c.formula.of.map((id) => byId.get(id));
      if (parts.some((p) => !p || p.id === c.id || p.formula || (p.type !== 'number' && p.type !== 'money'))) {
        errors.push(`${where}「${c.label}」：計算式只能使用同一明細表中非計算的數字或金額欄`);
      } else if (parts.filter((p) => p!.type === 'money').length !== (c.type === 'money' ? 1 : 0)) {
        errors.push(`${where}「${c.label}」：金額欄的計算式需為「金額 × 數字」；數字欄只能用數字相乘`);
      }
    }
    columns.forEach((c, i) => {
      if (c.rateFor !== undefined) {
        const ref = columns.slice(0, i).find((x) => x.id === c.rateFor);
        if (c.type !== 'number' || c.formula) errors.push(`${where}「${c.label}」：只有非計算的數字欄可以當匯率欄`);
        else if (ref?.type !== 'select') errors.push(`${where}「${c.label}」：匯率欄需對應排在前面的下拉選單（幣別）欄`);
      }
      if (c.currencyColumn !== undefined) {
        if (c.type !== 'money') errors.push(`${where}「${c.label}」：只有金額欄可以指定幣別欄`);
        else if (byId.get(c.currencyColumn)?.type !== 'select') errors.push(`${where}「${c.label}」：幣別欄需為同一明細表的下拉選單欄`);
      }
      for (const r of c.rules ?? []) {
        if (!r.when) continue;
        const ref = byId.get(r.when.column);
        if (ref?.type !== 'select' || ref.id === c.id) errors.push(`${where}「${c.label}」：檢查規則的適用條件需為同一明細表的下拉選單欄`);
        else if (r.when.in.some((x) => !ref.options?.some((o) => o.value === x))) errors.push(`${where}「${c.label}」：檢查規則的適用選項不在「${ref.label}」的選項中`);
      }
    });
    if (totalColumn !== null) {
      const t = byId.get(totalColumn);
      if (!t || (t.type !== 'number' && t.type !== 'money')) errors.push(`${where}：合計欄需為數字或金額欄`);
      else if (t.currencyColumn !== undefined) errors.push(`${where}：每列幣別不同的金額欄不能加總，請以換算後的金額欄作為合計欄`);
    }
  };

  const field = (v: unknown, where: string): FieldDef | null => {
    if (!isObj(v)) {
      errors.push(`${where}：格式不正確`);
      return null;
    }
    const type = v.type as FieldType;
    if (!FIELD_TYPES.includes(type)) {
      errors.push(`${where}：元件類型不正確`);
      return null;
    }
    const id = newId(v.id, where, fieldIds);
    const label = text(v.label, `${where} 名稱`, SCHEMA_LIMITS.label, true);
    const name = `${where}「${label || id}」`;
    const base: FieldBase = {
      id,
      label,
      help: text(v.help, `${name} 說明`, SCHEMA_LIMITS.help, false),
      required: type === 'notice' || type === 'boolean' ? false : bool(v.required),
      width: ([1, 2, 3, 4] as const).includes(v.width as 1) ? (v.width as 1 | 2 | 3 | 4) : 4,
      showInHeader: bool(v.showInHeader),
    };
    if (v.visibleWhen !== undefined && v.visibleWhen !== null) base.visibleWhen = condition(v.visibleWhen, name, 1);
    if (v.semantic !== undefined && v.semantic !== null) {
      const s = v.semantic as FieldSemantic;
      if (!(s in SEMANTIC_TYPES) || !SEMANTIC_TYPES[s].includes(type)) {
        errors.push(`${name}：此元件不能標記為 ${String(v.semantic)}`);
      } else if (semantics.has(s)) {
        errors.push(`${name}：每張表單只能有一個欄位標記為 ${s}`);
      } else {
        semantics.add(s);
        base.semantic = s;
      }
    }

    let def: FieldDef;
    switch (type) {
      case 'text': {
        const format = (['plain', 'email', 'phone', 'tax_id'] as const).find((f) => f === v.format) ?? 'plain';
        def = { ...base, type, maxLength: int(v.maxLength, `${name} 字數上限`, 1, SCHEMA_LIMITS.textMax, 200), format };
        if (v.sensitive === true) def.sensitive = true;
        break;
      }
      case 'textarea':
        def = {
          ...base,
          type,
          maxLength: int(v.maxLength, `${name} 字數上限`, 1, SCHEMA_LIMITS.textareaMax, 2000),
          rows: int(v.rows, `${name} 列數`, 2, 20, 4),
        };
        if (v.sensitive === true) def.sensitive = true;
        break;
      case 'number': {
        const min = optionalNumber(v.min, `${name} 最小值`);
        const max = optionalNumber(v.max, `${name} 最大值`);
        if (min !== null && max !== null && min > max) errors.push(`${name}：最小值大於最大值`);
        def = { ...base, type, min, max, decimals: int(v.decimals, `${name} 小數位數`, 0, 4, 0) };
        break;
      }
      case 'money': {
        const max = optionalNumber(v.max, `${name} 上限`);
        if (max !== null && max < 0) errors.push(`${name}：上限不可為負數`);
        def = { ...base, type, max };
        break;
      }
      case 'date':
        def = { ...base, type, notBeforeToday: bool(v.notBeforeToday) };
        break;
      case 'select':
      case 'radio': {
        const opts = options(v.options, name);
        def = { ...base, type, options: opts };
        if (v.default !== undefined && v.default !== null && v.default !== '') {
          if (typeof v.default !== 'string' || !opts.some((o) => o.value === v.default)) errors.push(`${name}：預設選項不在選項中`);
          else def.default = v.default;
        }
        break;
      }
      case 'budget_code':
        def = { ...base, type };
        if (v.budgetScope !== undefined && v.budgetScope !== null && v.budgetScope !== '') {
          const scope = BUDGET_SCOPES.find((s) => s === v.budgetScope);
          if (!scope) errors.push(`${name}：預算範圍不正確`);
          else def.budgetScope = scope;
        }
        break;
      case 'checkboxes': {
        const opts = options(v.options, name);
        const minSelected = int(v.minSelected, `${name} 最少選擇`, 0, SCHEMA_LIMITS.options, 0);
        const maxSelected = v.maxSelected === undefined || v.maxSelected === null ? null : int(v.maxSelected, `${name} 最多選擇`, 1, SCHEMA_LIMITS.options, 1);
        if (maxSelected !== null && maxSelected < minSelected) errors.push(`${name}：最多選擇少於最少選擇`);
        def = { ...base, type, options: opts, minSelected, maxSelected };
        break;
      }
      case 'boolean':
        def = {
          ...base,
          type,
          trueLabel: text(v.trueLabel, `${name} 是`, 20, false) || '是',
          falseLabel: text(v.falseLabel, `${name} 否`, 20, false) || '否',
        };
        break;
      case 'table': {
        const scope = new Set<string>();
        const cols = Array.isArray(v.columns) && v.columns.length > 0 && v.columns.length <= SCHEMA_LIMITS.columns ? v.columns : null;
        if (!cols) errors.push(`${name}：需有 1–${SCHEMA_LIMITS.columns} 個欄位`);
        const columns = (cols ?? []).map((c, i) => column(c, `${name} 第 ${i + 1} 欄`, scope));
        const minRows = int(v.minRows, `${name} 最少列數`, 0, SCHEMA_LIMITS.rows, 0);
        const maxRows = int(v.maxRows, `${name} 最多列數`, 1, SCHEMA_LIMITS.rows, 50);
        if (minRows > maxRows) errors.push(`${name}：最少列數大於最多列數`);
        const totalColumn = typeof v.totalColumn === 'string' ? v.totalColumn : null;
        checkTable(columns, totalColumn, name);
        if (base.semantic === 'amount' && columns.find((c) => c.id === totalColumn)?.type !== 'money') {
          errors.push(`${name}：標記為單據金額的明細表需以金額欄作為合計欄`);
        }
        def = { ...base, type, columns, minRows, maxRows, totalColumn };
        break;
      }
      case 'attachments':
        attachmentFields += 1;
        def = {
          ...base,
          type,
          maxFiles: v.maxFiles === undefined || v.maxFiles === null ? null : int(v.maxFiles, `${name} 檔案數上限`, 1, 20, 20),
        };
        break;
      case 'notice':
        def = { ...base, type, text: text(v.text, `${name} 內容`, SCHEMA_LIMITS.notice, true) };
        break;
      default:
        def = { ...base, type } as FieldDef;
    }
    if (v.requiredWhen !== undefined && v.requiredWhen !== null) {
      if (type === 'notice' || type === 'boolean') errors.push(`${name}：此元件不能設定條件式必填`);
      else def.requiredWhen = condition(v.requiredWhen, name, 1);
    }
    if (v.rules !== undefined && v.rules !== null) {
      const list = rules(v.rules, type, name);
      if (list.length > 0) def.rules = list;
    }
    if (v.currencyField !== undefined && v.currencyField !== null) {
      const ref = typeof v.currencyField === 'string' ? earlierDefs.get(v.currencyField) : undefined;
      if (type !== 'money' && type !== 'table') errors.push(`${name}：只有金額或明細表可以指定幣別欄位`);
      else if (!ref || (ref.type !== 'select' && ref.type !== 'radio')) errors.push(`${name}：幣別欄位需為排在前面的下拉選單或單選`);
      else if (def.semantic === 'amount') errors.push(`${name}：標記為單據金額的欄位固定為新臺幣，不能指定幣別欄位`);
      else def.currencyField = ref.id;
    }
    if (id) {
      earlier.set(id, type);
      earlierDefs.set(id, def);
    }
    return def;
  };

  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.sections)) {
    return { ok: false, errors: ['表單欄位定義格式不正確'] };
  }
  if (raw.sections.length === 0 || raw.sections.length > SCHEMA_LIMITS.sections) {
    return { ok: false, errors: [`表單需有 1–${SCHEMA_LIMITS.sections} 個區段`] };
  }
  const sectionIds = new Set<string>();
  const sections: FormSection[] = raw.sections.map((s, i) => {
    const where = `第 ${i + 1} 個區段`;
    if (!isObj(s) || !Array.isArray(s.fields)) {
      errors.push(`${where}：格式不正確`);
      return { id: '', title: '', description: '', fields: [] };
    }
    fieldCount += s.fields.length;
    if (fieldCount > SCHEMA_LIMITS.fields) {
      errors.push(`欄位總數不可超過 ${SCHEMA_LIMITS.fields} 個`);
      return { id: '', title: '', description: '', fields: [] };
    }
    return {
      id: newId(s.id, where, sectionIds),
      title: text(s.title, `${where} 標題`, SCHEMA_LIMITS.label, false),
      description: text(s.description, `${where} 說明`, SCHEMA_LIMITS.help, false),
      fields: s.fields.map((f, j) => field(f, `${where}第 ${j + 1} 個欄位`)).filter((f): f is FieldDef => f !== null),
    };
  });
  if (attachmentFields > 1) errors.push('每張表單最多一個附件欄位');
  if (fieldCount === 0) errors.push('表單至少需要一個欄位');
  const assetRegister = raw.assetRegister === undefined || raw.assetRegister === null ? undefined : parseAssetRegister(raw.assetRegister, earlierDefs, errors);
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  return {
    ok: true,
    schema: { version: 1, sections, ...(raw.onBehalf === true ? { onBehalf: true } : {}), ...(assetRegister ? { assetRegister } : {}) },
  };
}

/** The linked table / columns / custodian fields must exist, have the right type, be required and always shown. */
function parseAssetRegister(raw: unknown, fields: Map<string, FieldDef>, errors: string[]): AssetRegisterLink | undefined {
  const where = '財產清冊串接';
  const r = isObj(raw) ? raw : null;
  const cols = r && isObj(r.columns) ? r.columns : null;
  const people = r && isObj(r.custodians) ? r.custodians : null;
  if (!r || !cols || !people || typeof r.table !== 'string') {
    errors.push(`${where}：設定格式不正確`);
    return undefined;
  }
  const before = errors.length;
  const table = fields.get(r.table);
  if (table?.type !== 'table') {
    errors.push(`${where}：請選擇財產明細表`);
    return undefined;
  }
  if (table.visibleWhen) errors.push(`${where}：明細表「${table.label}」不能設定顯示條件`);
  const column = (key: string, name: string, type: ColumnType, extra?: (c: TableColumn) => string | null): string => {
    const id = cols[key];
    const c = typeof id === 'string' ? table.columns.find((x) => x.id === id) : undefined;
    if (!c || c.type !== type || c.formula) errors.push(`${where}：「${name}」需為明細表中的${COLUMN_TYPE_NAMES[type]}欄`);
    else if (!c.required) errors.push(`${where}：「${name}」欄需設為必填`);
    else {
      const problem = extra?.(c);
      if (problem) errors.push(`${where}：${problem}`);
    }
    return typeof id === 'string' ? id : '';
  };
  const columns = {
    asset: column('asset', '財產', 'asset', (c) => (c.unique ? null : '「財產」欄需設為不可重複')),
    reason: column('reason', '異動原因', 'select', (c) =>
      (c.options ?? []).every((o) => (ASSET_TRANSFER_TYPES as readonly string[]).includes(o.value))
        ? null
        : `「異動原因」欄的選項代碼需為 ${ASSET_TRANSFER_TYPES.join('、')} 其中之一`
    ),
    newCustodian: column('newCustodian', '新保管人員', 'employee'),
    newLocation: column('newLocation', '新保管地點', 'text'),
  };
  const person = (key: string, name: string, required: boolean): string | null => {
    const id = people[key];
    if (!required && (id === undefined || id === null || id === '')) return null;
    const f = typeof id === 'string' ? fields.get(id) : undefined;
    if (f?.type !== 'employee') errors.push(`${where}：「${name}」需為員工欄位`);
    else if (f.visibleWhen) errors.push(`${where}：「${name}」欄位不能設定顯示條件`);
    else if (required && !f.required) errors.push(`${where}：「${name}」欄位需設為必填`);
    return typeof id === 'string' ? id : null;
  };
  const custodians = { original: person('original', '原保管人', true) ?? '', new: person('new', '新保管人', true) ?? '', other: person('other', '其他保管人', false) };
  if (errors.length > before) return undefined;
  return { table: table.id, columns, custodians };
}

const COLUMN_TYPE_NAMES: Record<ColumnType, string> = {
  text: '文字',
  number: '數字',
  money: '金額',
  date: '日期',
  select: '下拉選單',
  employee: '員工',
  asset: '財產',
};

/** Every field in display order. */
export function allFields(schema: FormSchema): FieldDef[] {
  return schema.sections.flatMap((s) => s.fields);
}
