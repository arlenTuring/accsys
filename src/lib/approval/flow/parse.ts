import {
  APPROVER_SOURCE_KINDS,
  CONDITION_OPS,
  DEFAULT_FLOW_OPTIONS,
  type ApproverBlock,
  type ApproverSource,
  type Condition,
  type FlowBlock,
  type FlowDef,
  type FlowOptions,
  type FormParty,
} from './types';

/**
 * Validates untrusted flow JSON (designer input or stored definitions) into a
 * FlowDef. Structural only: whether referenced employees, departments, roles
 * and fields exist is checked separately against live data before publishing.
 */

export const FLOW_LIMITS = { blocks: 100, depth: 10, conditionDepth: 6, label: 60, inValues: 200 } as const;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[a-z][a-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A form field, a table column (`table.column`) or an applicant value. */
const FIELD = /^(\$applicant\.(id|department|orgLevel|jobRoles)|\$filer\.id|[A-Za-z0-9_-]{1,64}|[A-Za-z][A-Za-z0-9_]{0,39}\.[A-Za-z][A-Za-z0-9_]{0,39})$/;
const PARTIES: readonly FormParty[] = ['applicant', 'filer', 'field_employee', 'budget_owner', 'asset_custodian'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) =>
  (typeof v === 'string' && v.length <= 200) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

export type ParseFlowResult = { ok: true; flow: FlowDef } | { ok: false; errors: string[] };

export function parseFlow(raw: unknown): ParseFlowResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  /** Approver blocks parsed so far (an escalation block may only look back). */
  const approverIds = new Set<string>();
  let count = 0;

  const label = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > FLOW_LIMITS.label) {
      errors.push(`${where}：名稱需為 1–${FLOW_LIMITS.label} 字`);
      return '';
    }
    return v.trim();
  };
  const id = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !ID.test(v)) {
      errors.push(`${where}：代號格式不正確`);
      return '';
    }
    if (ids.has(v)) errors.push(`${where}：代號 ${v} 重複`);
    ids.add(v);
    return v;
  };
  const uuid = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !UUID.test(v)) errors.push(`${where}：未選擇或格式不正確`);
    return typeof v === 'string' ? v.toLowerCase() : '';
  };
  const code = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !CODE.test(v)) errors.push(`${where}：代碼格式不正確`);
    return typeof v === 'string' ? v : '';
  };
  const field = (v: unknown, where: string): string => {
    if (typeof v !== 'string' || !FIELD.test(v)) errors.push(`${where}：欄位未選擇`);
    return typeof v === 'string' ? v : '';
  };

  const condition = (v: unknown, where: string, depth: number): Condition => {
    if (depth > FLOW_LIMITS.conditionDepth) {
      errors.push(`${where}：條件層數過多`);
      return { all: [] };
    }
    if (!isObj(v)) {
      errors.push(`${where}：條件格式不正確`);
      return { all: [] };
    }
    if ('all' in v || 'any' in v) {
      const key = 'all' in v ? 'all' : 'any';
      const list = v[key];
      if (!Array.isArray(list) || list.length === 0 || list.length > 20) {
        errors.push(`${where}：條件群組需有 1–20 個條件`);
        return { all: [] };
      }
      const items = list.map((c, i) => condition(c, `${where} 第 ${i + 1} 個條件`, depth + 1));
      return key === 'all' ? { all: items } : { any: items };
    }
    if ('not' in v) return { not: condition(v.not, where, depth + 1) };
    const op = v.op;
    if (typeof op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(op)) {
      errors.push(`${where}：運算子不正確`);
      return { all: [] };
    }
    const out: Condition = { field: field(v.field, where), op: op as (typeof CONDITION_OPS)[number] };
    if (op === 'filled' || op === 'empty') return out;
    if (op === 'in' || op === 'not_in') {
      if (!Array.isArray(v.value) || v.value.length === 0 || v.value.length > FLOW_LIMITS.inValues || !v.value.every(isScalar)) {
        errors.push(`${where}：比對值清單不正確`);
      }
    } else if (!isScalar(v.value)) {
      errors.push(`${where}：比對值不正確`);
    }
    return { ...out, value: v.value };
  };

  const source = (v: unknown, where: string): ApproverSource => {
    const fallback: ApproverSource = { kind: 'employee', employeeId: '' };
    if (!isObj(v) || typeof v.kind !== 'string' || !(APPROVER_SOURCE_KINDS as readonly string[]).includes(v.kind)) {
      errors.push(`${where}：簽核人類型不正確`);
      return fallback;
    }
    switch (v.kind) {
      case 'employee':
        return { kind: 'employee', employeeId: uuid(v.employeeId, `${where} 指定員工`) };
      case 'department_manager': {
        const of = v.of;
        if (of !== 'applicant' && of !== 'department' && of !== 'field') {
          errors.push(`${where}：部門來源不正確`);
          return fallback;
        }
        const levelsUp = v.levelsUp ?? 0;
        if (typeof levelsUp !== 'number' || !Number.isInteger(levelsUp) || levelsUp < 0 || levelsUp > 10) {
          errors.push(`${where}：往上層數需為 0–10`);
        }
        return {
          kind: 'department_manager',
          of,
          levelsUp: typeof levelsUp === 'number' ? levelsUp : 0,
          ...(of === 'department' ? { departmentId: uuid(v.departmentId, `${where} 部門`) } : {}),
          ...(of === 'field' ? { fieldId: field(v.fieldId, `${where} 部門欄位`) } : {}),
        };
      }
      case 'department_members':
        return {
          kind: 'department_members',
          departmentId: uuid(v.departmentId, `${where} 部門`),
          includeManager: v.includeManager === true,
        };
      case 'org_chain': {
        const of = v.of;
        if (of !== 'applicant' && of !== 'field') {
          errors.push(`${where}：起點不正確`);
          return fallback;
        }
        const rules = Array.isArray(v.rules) ? v.rules : [];
        if (rules.length > 20) errors.push(`${where}：層級規則過多`);
        const parsedRules = rules.slice(0, 20).map((r, i) => {
          const rr = isObj(r) ? r : {};
          return { fromLevel: code(rr.fromLevel, `${where} 規則 ${i + 1}`), toLevel: code(rr.toLevel, `${where} 規則 ${i + 1}`) };
        });
        const defaultToLevel = v.defaultToLevel === null || v.defaultToLevel === undefined || v.defaultToLevel === ''
          ? null
          : code(v.defaultToLevel, `${where} 預設終點`);
        if (parsedRules.length === 0 && defaultToLevel === null) errors.push(`${where}：請選擇要逐級簽到哪一個組織層級`);
        return {
          kind: 'org_chain',
          of,
          includeStartDepartment: v.includeStartDepartment !== false,
          rules: parsedRules,
          defaultToLevel,
          ...(of === 'field' ? { fieldId: field(v.fieldId, `${where} 部門欄位`) } : {}),
        };
      }
      case 'form_party': {
        const party = v.party;
        if (typeof party !== 'string' || !(PARTIES as readonly string[]).includes(party)) {
          errors.push(`${where}：表單關係人不正確`);
          return fallback;
        }
        const needsField = party !== 'applicant' && party !== 'filer';
        return {
          kind: 'form_party',
          party: party as FormParty,
          ...(needsField ? { fieldId: field(v.fieldId, `${where} 欄位`) } : {}),
        };
      }
      case 'employee_group':
        return { kind: 'employee_group', groupId: uuid(v.groupId, `${where} 員工群組`) };
      case 'job_role': {
        const scope = v.scope ?? 'company';
        if (scope !== 'company' && scope !== 'applicant_department' && scope !== 'field_department') {
          errors.push(`${where}：職務範圍不正確`);
          return fallback;
        }
        return {
          kind: 'job_role',
          jobRole: code(v.jobRole, `${where} 職務類別`),
          scope,
          ...(scope === 'field_department' ? { fieldId: field(v.fieldId, `${where} 部門欄位`) } : {}),
        };
      }
      default:
        return fallback;
    }
  };

  const blocks = (v: unknown, where: string, depth: number): FlowBlock[] => {
    if (!Array.isArray(v)) {
      errors.push(`${where}：關卡清單格式不正確`);
      return [];
    }
    if (depth > FLOW_LIMITS.depth) {
      errors.push(`${where}：條件層數過多`);
      return [];
    }
    const out: FlowBlock[] = [];
    v.forEach((b, i) => {
      count += 1;
      const title = isObj(b) && typeof b.label === 'string' && b.label.trim() ? `「${b.label.trim().slice(0, FLOW_LIMITS.label)}」` : '';
      const at = `${where}第 ${i + 1} 關${title}`;
      if (!isObj(b)) {
        errors.push(`${at}：格式不正確`);
        return;
      }
      if (b.type === 'approver') {
        const onUnresolved = b.onUnresolved ?? 'block';
        if (onUnresolved !== 'block' && onUnresolved !== 'skip') errors.push(`${at}：找不到人時的處理方式不正確`);
        const block: ApproverBlock = {
          id: id(b.id, at),
          type: 'approver',
          label: label(b.label, at),
          source: source(b.source, at),
          onUnresolved: onUnresolved === 'skip' ? 'skip' : 'block',
        };
        if (b.fallbackFor !== undefined && b.fallbackFor !== null) {
          const list = b.fallbackFor;
          if (!Array.isArray(list) || list.length === 0 || list.length > 20 || !list.every((x) => typeof x === 'string' && approverIds.has(x))) {
            errors.push(`${at}：升級關卡只能參考排在前面的簽核關卡`);
          } else {
            block.fallbackFor = [...new Set(list as string[])];
          }
        }
        if (block.id) approverIds.add(block.id);
        out.push(block);
      } else if (b.type === 'condition') {
        const name = label(b.label, at);
        const branchList = Array.isArray(b.branches) ? b.branches : [];
        if (branchList.length === 0 || branchList.length > 20) errors.push(`${at}：條件式需有 1–20 個條件順序`);
        const other = isObj(b.otherwise) ? b.otherwise : {};
        out.push({
          id: id(b.id, at),
          type: 'condition',
          label: name,
          branches: branchList.slice(0, 20).map((br, j) => {
            const brObj = isObj(br) ? br : {};
            const bAt = `${at} 條件順序 ${j + 1}`;
            return {
              id: id(brObj.id, bAt),
              label: label(brObj.label, bAt),
              when: condition(brObj.when, bAt, 0),
              blocks: blocks(brObj.blocks, `${bAt} `, depth + 1),
            };
          }),
          otherwise: {
            label: typeof other.label === 'string' && other.label.trim() ? label(other.label, `${at} 例外條件`) : '其他',
            blocks: blocks(other.blocks ?? [], `${at} 例外條件 `, depth + 1),
          },
        });
      } else {
        errors.push(`${at}：關卡類型不正確`);
      }
    });
    return out;
  };

  if (!isObj(raw) || raw.version !== 1) return { ok: false, errors: ['簽核流程格式不正確'] };
  const parsedBlocks = blocks(raw.blocks, '', 0);
  if (count > FLOW_LIMITS.blocks) errors.push(`關卡總數不可超過 ${FLOW_LIMITS.blocks} 個`);

  const o = isObj(raw.options) ? raw.options : {};
  const bool = (k: keyof FlowOptions) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_FLOW_OPTIONS[k] as boolean));
  const whenEmpty = o.whenEmpty ?? DEFAULT_FLOW_OPTIONS.whenEmpty;
  if (whenEmpty !== 'auto_approve' && whenEmpty !== 'block') errors.push('沒有關卡時的處理方式不正確');
  const options: FlowOptions = {
    skipApplicant: bool('skipApplicant'),
    skipFiler: bool('skipFiler'),
    collapseDuplicates: bool('collapseDuplicates'),
    whenEmpty: whenEmpty === 'auto_approve' ? 'auto_approve' : 'block',
  };

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, flow: { version: 1, blocks: parsedBlocks, options } };
}
