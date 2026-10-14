/**
 * Configurable approval flow ("積木式" blocks). A flow is a vertical list of
 * blocks; a condition block branches into ordered condition branches plus an
 * exception branch (其他), each holding its own list of blocks.
 *
 * Stored as JSON in form definition versions, so every shape here is also
 * validated by parseFlow() before it is trusted.
 */

export type ConditionOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not_in'
  | 'contains'
  | 'filled'
  | 'empty';

export const CONDITION_OPS: readonly ConditionOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'filled',
  'empty',
];

/**
 * `field` is a form field id, or a system value:
 * `$applicant.department` (department id), `$applicant.orgLevel` (level code),
 * `$applicant.jobRoles` (job role codes), `$applicant.id`, `$filer.id`.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: ConditionOp; value?: unknown };

export type FormParty = 'applicant' | 'filer' | 'field_employee' | 'budget_owner' | 'asset_custodian';

export type ApproverSource =
  /** 指定員工 */
  | { kind: 'employee'; employeeId: string }
  /**
   * 部門主管: manager of the applicant's / a fixed / a field's department,
   * optionally N levels up. A field may be a department or an employee field
   * (that employee's department).
   */
  | {
      kind: 'department_manager';
      of: 'applicant' | 'department' | 'field';
      departmentId?: string;
      fieldId?: string;
      levelsUp: number;
    }
  /** 部門成員: every active member of a department, one after another. */
  | { kind: 'department_members'; departmentId: string; includeManager: boolean }
  /**
   * 組織層級: managers from the start department up the tree until the target
   * level (inclusive). The target depends on the start department's level
   * (組級簽至CEO級、部級簽至處級…), falling back to defaultToLevel.
   */
  | {
      kind: 'org_chain';
      of: 'applicant' | 'field';
      fieldId?: string;
      includeStartDepartment: boolean;
      rules: { fromLevel: string; toLevel: string }[];
      defaultToLevel: string | null;
    }
  /** 表單關係人 */
  | { kind: 'form_party'; party: FormParty; fieldId?: string }
  /** 員工群組: members in their configured order. */
  | { kind: 'employee_group'; groupId: string }
  /** 職務類別 */
  | {
      kind: 'job_role';
      jobRole: string;
      scope: 'company' | 'applicant_department' | 'field_department';
      fieldId?: string;
    };

export type ApproverSourceKind = ApproverSource['kind'];

export const APPROVER_SOURCE_KINDS: readonly ApproverSourceKind[] = [
  'employee',
  'department_manager',
  'department_members',
  'org_chain',
  'form_party',
  'employee_group',
  'job_role',
];

export type ApproverBlock = {
  id: string;
  type: 'approver';
  label: string;
  source: ApproverSource;
  /** 找不到簽核人時: block = refuse to submit, skip = record a skipped step. */
  onUnresolved: 'block' | 'skip';
  /**
   * 升級關卡: needed only when none of these earlier approver blocks got a
   * signer other than the applicant / filer (e.g. every unit manager is the
   * applicant → 總經理). Its own signer must be someone else as well.
   */
  fallbackFor?: string[];
};

export type ConditionBranch = { id: string; label: string; when: Condition; blocks: FlowBlock[] };

export type ConditionBlock = {
  id: string;
  type: 'condition';
  label: string;
  /** Evaluated in order; the first match wins. */
  branches: ConditionBranch[];
  /** 例外條件: taken when no branch matches. */
  otherwise: { label: string; blocks: FlowBlock[] };
};

export type FlowBlock = ApproverBlock | ConditionBlock;

export type FlowOptions = {
  /** A step resolved to the applicant is signed by the system. */
  skipApplicant: boolean;
  /** A step resolved to the person who filed the form for someone else is signed by the system. */
  skipFiler: boolean;
  /** A step resolved to someone who already has an earlier step is signed by the system. */
  collapseDuplicates: boolean;
  /** No step left for a person to sign: approve immediately, or refuse to submit. */
  whenEmpty: 'auto_approve' | 'block';
};

export type FlowDef = { version: 1; blocks: FlowBlock[]; options: FlowOptions };

export const DEFAULT_FLOW_OPTIONS: FlowOptions = {
  skipApplicant: true,
  skipFiler: true,
  collapseDuplicates: true,
  whenEmpty: 'block',
};

export type ResolvedStepStatus = 'pending' | 'auto_approved' | 'skipped';

export type ResolvedStep = {
  blockId: string;
  label: string;
  sourceKind: ApproverSourceKind;
  approverEmployeeId: string | null;
  delegatedFromEmployeeId: string | null;
  status: ResolvedStepStatus;
  /** Why the system signed or skipped the step (shown on the timeline). */
  systemNote: string | null;
};

export type FlowContext = {
  applicantEmployeeId: string;
  /** Same as the applicant when they filed it themselves. */
  filerEmployeeId: string;
  /** 申請部門 */
  departmentId: string;
  /** Form definition key, for delegations limited to some forms. */
  formKey: string | null;
  /** Asia/Taipei date (YYYY-MM-DD) used for delegation periods. */
  today: string;
  /** Field values by field id (amounts as numbers or numeric strings, references as ids). */
  fields: Record<string, unknown>;
};

export type OrgEmployee = { id: string; name: string; departmentId: string; active: boolean };
export type OrgDepartment = {
  id: string;
  name: string;
  parentId: string | null;
  managerId: string | null;
  levelCode: string | null;
  active: boolean;
};

export type OrgSnapshot = {
  employees: Map<string, OrgEmployee>;
  departments: Map<string, OrgDepartment>;
  /** level code -> rank (higher = more senior) and name */
  levels: Map<string, { name: string; rank: number }>;
  jobRoles: Map<string, { name: string; active: boolean }>;
  jobRoleBindings: { jobRole: string; departmentId: string | null; employeeId: string; isPrimary: boolean }[];
  groups: Map<string, { name: string; active: boolean; memberIds: string[] }>;
  delegations: { delegatorId: string; delegateId: string; startsOn: string; endsOn: string; formKeys: string[] | null }[];
  /** budget code id -> owner employee id */
  budgetOwners: Map<string, string | null>;
  /** asset id -> custodian employee id */
  assetCustodians: Map<string, string | null>;
};

export type ResolveResult =
  | { ok: true; steps: ResolvedStep[]; path: string[] }
  | { ok: false; error: string; blockId: string | null };
