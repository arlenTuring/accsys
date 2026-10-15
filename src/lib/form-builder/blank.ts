import {
  DEFAULT_FLOW_OPTIONS,
  type ApproverBlock,
  type ApproverSource,
  type ApproverSourceKind,
  type ConditionBlock,
  type FlowDef,
} from '@/lib/approval/flow/types';
import type { FieldDef, FieldType, FormSchema, TableColumn } from '@/lib/custom-forms/schema';

/**
 * Starting points for the designer: an empty form, new fields and new flow
 * blocks with sensible defaults, and the labels the designer shows for each
 * kind. Client-safe.
 */

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '單行文字',
  textarea: '多行文字',
  number: '數字',
  money: '金額',
  date: '日期',
  select: '下拉選單',
  radio: '單選',
  checkboxes: '複選',
  boolean: '是／否',
  employee: '員工選擇',
  department: '部門選擇',
  budget_code: '預算編號',
  project: '專案',
  supplier: '廠商',
  asset: '財產',
  source: '關聯單據',
  table: '明細表',
  attachments: '附件上傳',
  notice: '說明區塊',
};

export const FIELD_GROUPS: { title: string; types: FieldType[] }[] = [
  { title: '基本輸入', types: ['text', 'textarea', 'number', 'money', 'date', 'select', 'radio', 'checkboxes', 'boolean'] },
  { title: '組織與主檔', types: ['employee', 'department', 'budget_code', 'project', 'supplier', 'asset'] },
  { title: '組合', types: ['table', 'source'] },
  { title: '附件與說明', types: ['attachments', 'notice'] },
];

export const SOURCE_LABELS: Record<ApproverSourceKind, string> = {
  employee: '指定員工',
  department_manager: '部門主管',
  department_members: '部門成員',
  org_chain: '組織層級',
  form_party: '表單關係人',
  employee_group: '員工群組',
  job_role: '職務類別',
};

/** Lengths of an admin-created entry category. */
export const CATEGORY_LIMITS = { title: 20, description: 100 } as const;

/** `${prefix}${n}` with the smallest n not in `taken`. */
export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n += 1) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}

export function emptySchema(): FormSchema {
  return { version: 1, sections: [{ id: 'main', title: '申請內容', description: '', fields: [] }] };
}

export function emptyFlow(): FlowDef {
  return {
    version: 1,
    blocks: [{ id: 'b1', type: 'approver', label: '部門主管', source: { kind: 'department_manager', of: 'applicant', levelsUp: 0 }, onUnresolved: 'block' }],
    options: { ...DEFAULT_FLOW_OPTIONS },
  };
}

const WIDE: readonly FieldType[] = ['textarea', 'checkboxes', 'table', 'attachments', 'notice'];

export function newField(type: FieldType, takenIds: Iterable<string>): FieldDef {
  const base = {
    id: uniqueId(type === 'budget_code' ? 'budget' : type, takenIds),
    label: FIELD_TYPE_LABELS[type],
    help: '',
    required: false,
    width: (WIDE.includes(type) ? 4 : 2) as 2 | 4,
    showInHeader: false,
  };
  const options = [
    { value: 'opt1', label: '選項 1' },
    { value: 'opt2', label: '選項 2' },
  ];
  switch (type) {
    case 'text':
      return { ...base, type, maxLength: 200, format: 'plain' };
    case 'textarea':
      return { ...base, type, maxLength: 2000, rows: 4 };
    case 'number':
      return { ...base, type, min: null, max: null, decimals: 0 };
    case 'money':
      return { ...base, type, max: null };
    case 'date':
      return { ...base, type, notBeforeToday: false };
    case 'select':
    case 'radio':
      return { ...base, type, options };
    case 'checkboxes':
      return { ...base, type, options, minSelected: 0, maxSelected: null };
    case 'boolean':
      return { ...base, type, trueLabel: '是', falseLabel: '否' };
    case 'table':
      return {
        ...base,
        type,
        label: '明細',
        columns: [
          { id: 'item', label: '項目', type: 'text', required: true },
          { id: 'amount', label: '金額', type: 'money', required: true },
        ],
        minRows: 0,
        maxRows: 20,
        totalColumn: 'amount',
      };
    case 'source':
      return { ...base, type, required: true, sources: [] };
    case 'attachments':
      return { ...base, type, label: '附件', maxFiles: null };
    case 'notice':
      return { ...base, type, label: '注意事項', text: '請在這裡輸入說明文字。' };
    default:
      return { ...base, type } as FieldDef;
  }
}

export function newColumn(takenIds: Iterable<string>): TableColumn {
  return { id: uniqueId('col', takenIds), label: '欄位', type: 'text', required: false };
}

export function newSource(kind: ApproverSourceKind): ApproverSource {
  switch (kind) {
    case 'employee':
      return { kind, employeeId: '' };
    case 'department_manager':
      return { kind, of: 'applicant', levelsUp: 0 };
    case 'department_members':
      return { kind, departmentId: '', includeManager: false };
    case 'org_chain':
      return { kind, of: 'applicant', includeStartDepartment: true, rules: [], defaultToLevel: null };
    case 'form_party':
      return { kind, party: 'field_employee', fieldId: '' };
    case 'employee_group':
      return { kind, groupId: '' };
    case 'job_role':
      return { kind, jobRole: '', scope: 'company' };
  }
}

export function newApprover(kind: ApproverSourceKind, takenIds: Iterable<string>): ApproverBlock {
  return { id: uniqueId('b', takenIds), type: 'approver', label: SOURCE_LABELS[kind], source: newSource(kind), onUnresolved: 'block' };
}

export function newCondition(takenIds: Iterable<string>): ConditionBlock {
  const taken = new Set(takenIds);
  const id = uniqueId('c', taken);
  taken.add(id);
  return {
    id,
    type: 'condition',
    label: '條件式',
    branches: [{ id: uniqueId('br', taken), label: '條件 1', when: { all: [] }, blocks: [] }],
    otherwise: { label: '其他', blocks: [] },
  };
}
