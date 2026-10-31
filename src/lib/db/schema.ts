import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  type PgTableExtraConfigValue,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ASSET_STATUSES, ASSET_TRANSFER_TYPES } from '../asset-transfers/constants';

// Source of truth for the database structure. Changes go through
// `npm run db:generate` (versioned SQL in drizzle/) and are reviewed before
// `npm run db:migrate`. Constraint and index names match PostgreSQL's default
// names from the original db/schema.sql so existing databases can be adopted
// by the baseline without renaming anything.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const taipeiToday = sql`(now() at time zone 'Asia/Taipei')::date`;

const FORM_TYPES = sql`form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer', 'custom')`;
const FORM_STATUS = sql`status in ('pending_approval', 'approved', 'returned', 'withdrawn')`;

function fk(name: string, column: AnyPgColumn, target: AnyPgColumn) {
  return foreignKey({ name, columns: [column], foreignColumns: [target] });
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

/**
 * Organisation levels (組 / 部 / 處 / CEO…). Higher rank = more senior; the
 * "組織層級" approval block signs up the department tree until it reaches a
 * department whose level rank is at least the configured target.
 */
export const orgLevels = pgTable(
  'org_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('org_levels_code_key'),
    name: text('name').notNull(),
    rank: integer('rank').notNull().unique('org_levels_rank_key'),
    createdAt: createdAt(),
  },
  (): PgTableExtraConfigValue[] => [check('org_levels_code_check', sql`code ~ '^[a-z][a-z0-9_]{0,39}$'`)]
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('departments_code_key'),
    name: text('name').notNull(),
    managerEmployeeId: uuid('manager_employee_id'),
    createdAt: createdAt(),
    /** Cycles are rejected by the departments_prevent_cycle trigger. */
    parentDepartmentId: uuid('parent_department_id'),
    orgLevelId: uuid('org_level_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('departments_manager_fk', t.managerEmployeeId, employees.id),
    fk('departments_parent_department_id_fkey', t.parentDepartmentId, t.id),
    fk('departments_org_level_id_fkey', t.orgLevelId, orgLevels.id),
    check('departments_parent_not_self_check', sql`parent_department_id is null or parent_department_id <> id`),
    index('departments_parent_department_id_idx').on(t.parentDepartmentId),
  ]
);

/**
 * App ACL roles (權限角色). Distinct from job_roles (職務類別), which only
 * resolve approval steps and form filing visibility. employees.role stores
 * this table's code.
 */
export const accessRoles = pgTable(
  'access_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('access_roles_code_key'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (): PgTableExtraConfigValue[] => [
    check('access_roles_code_check', sql`code ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('access_roles_name_check', sql`char_length(btrim(name)) between 1 and 30`),
  ]
);

export const accessRolePermissions = pgTable(
  'access_role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'access_role_permissions_pkey', columns: [t.roleId, t.permission] }),
    fk('access_role_permissions_role_fkey', t.roleId, accessRoles.id).onDelete('cascade'),
    check('access_role_permissions_permission_check', sql`permission ~ '^[a-z][a-z0-9_.]{0,63}$'`),
  ]
);

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeCode: text('employee_code').notNull().unique('employees_employee_code_key'),
    name: text('name').notNull(),
    departmentId: uuid('department_id').notNull(),
    title: text('title'),
    googleEmail: text('google_email').unique('employees_google_email_key'),
    /** Access-role code (staff / finance / admin / custom). */
    role: text('role').notNull().default('staff'),
    isGeneralManager: boolean('is_general_manager').notNull().default(false),
    isChairman: boolean('is_chairman').notNull().default(false),
    createdAt: createdAt(),
    // Local access switch. Disabling keeps the employee row (and every form
    // that references it); sessions are revoked separately.
    accessEnabled: boolean('access_enabled').notNull().default(true),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledReason: text('disabled_reason'),
    phone: text('phone'),
    extension: text('extension'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('employees_department_id_fkey', t.departmentId, departments.id),
    fk('employees_role_access_role_fkey', t.role, accessRoles.code),
    check('employees_access_state_check', sql`access_enabled = (disabled_at is null)`),
  ]
);

/** 職務類別. System roles (general_manager, chairman) mirror the employees flags via trigger. */
export const jobRoles = pgTable(
  'job_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('job_roles_code_key'),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (): PgTableExtraConfigValue[] => [check('job_roles_code_check', sql`code ~ '^[a-z][a-z0-9_]{0,39}$'`)]
);

/** Employee x job role; department_id null = company-wide, otherwise that department's holder of the role. */
export const employeeJobRoles = pgTable(
  'employee_job_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    jobRoleId: uuid('job_role_id').notNull(),
    departmentId: uuid('department_id'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('employee_job_roles_employee_id_fkey', t.employeeId, employees.id),
    fk('employee_job_roles_job_role_id_fkey', t.jobRoleId, jobRoles.id),
    fk('employee_job_roles_department_id_fkey', t.departmentId, departments.id),
    unique('employee_job_roles_role_department_employee_key').on(t.jobRoleId, t.departmentId, t.employeeId).nullsNotDistinct(),
    uniqueIndex('employee_job_roles_one_primary_idx')
      .on(t.jobRoleId, sql`coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`is_primary`),
    index('employee_job_roles_employee_id_idx').on(t.employeeId),
  ]
);

/** 員工群組: an ordered list of employees who sign one after another. */
export const employeeGroups = pgTable('employee_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique('employee_groups_name_key'),
  description: text('description'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const employeeGroupMembers = pgTable(
  'employee_group_members',
  {
    groupId: uuid('group_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'employee_group_members_pkey', columns: [t.groupId, t.employeeId] }),
    foreignKey({
      name: 'employee_group_members_group_id_fkey',
      columns: [t.groupId],
      foreignColumns: [employeeGroups.id],
    }).onDelete('cascade'),
    fk('employee_group_members_employee_id_fkey', t.employeeId, employees.id),
  ]
);

/**
 * 代理人. Applied when approval steps are generated; existing pending steps are
 * never silently reassigned. form_keys null = every form.
 */
export const approvalDelegations = pgTable(
  'approval_delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    delegatorEmployeeId: uuid('delegator_employee_id').notNull(),
    delegateEmployeeId: uuid('delegate_employee_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    formKeys: text('form_keys').array(),
    reason: text('reason'),
    createdByEmployeeId: uuid('created_by_employee_id').notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('approval_delegations_delegator_fkey', t.delegatorEmployeeId, employees.id),
    fk('approval_delegations_delegate_fkey', t.delegateEmployeeId, employees.id),
    fk('approval_delegations_created_by_fkey', t.createdByEmployeeId, employees.id),
    check('approval_delegations_not_self_check', sql`delegator_employee_id <> delegate_employee_id`),
    check('approval_delegations_period_check', sql`ends_on >= starts_on`),
    index('approval_delegations_delegator_idx').on(t.delegatorEmployeeId, t.startsOn, t.endsOn),
  ]
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('projects_code_key'),
    name: text('name').notNull(),
    /** product = 產品專案 (internal R&D), revenue = 營收專案 (customer work); picks the 費用申請單 edition. */
    kind: text('kind').notNull().default('product'),
    /** Only employees in project_members may search, pick or file against a restricted project. */
    restricted: boolean('restricted').notNull().default(false),
    createdAt: createdAt(),
  },
  (): PgTableExtraConfigValue[] => [check('projects_kind_check', sql`kind in ('product', 'revenue')`)]
);

export const budgetCodes = pgTable(
  'budget_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('budget_codes_code_key'),
    departmentId: uuid('department_id'),
    projectId: uuid('project_id'),
    category: text('category').notNull(),
    ownerEmployeeId: uuid('owner_employee_id'),
    fiscalYear: text('fiscal_year').notNull(),
    annualBudgetAmount: money('annual_budget_amount'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('budget_codes_department_id_fkey', t.departmentId, departments.id),
    fk('budget_codes_project_id_fkey', t.projectId, projects.id),
    fk('budget_codes_owner_employee_id_fkey', t.ownerEmployeeId, employees.id),
    check(
      'budget_codes_department_or_project_check',
      sql`(department_id is not null) <> (project_id is not null)`
    ),
  ]
);

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique('suppliers_name_key'),
  shortName: text('short_name'),
  taxId: text('tax_id'),
  country: text('country'),
  registeredAddress: text('registered_address'),
  mailingAddress: text('mailing_address'),
  phone: text('phone'),
  contactName: text('contact_name'),
  contactDepartment: text('contact_department'),
  contactPhone: text('contact_phone'),
  contactMobile: text('contact_mobile'),
  email: text('email'),
  bankName: text('bank_name'),
  bankBranch: text('bank_branch'),
  bankAccount: text('bank_account'),
  accountName: text('account_name'),
  currency: text('currency'),
  notes: text('notes'),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// Procurement cases (one case_number ties four form types together)
// ---------------------------------------------------------------------------

export const procurementCases = pgTable(
  'procurement_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseNumber: text('case_number').notNull().unique('procurement_cases_case_number_key'),
    createdByEmployeeId: uuid('created_by_employee_id').notNull(),
    caseType: text('case_type').notNull().default('standard'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('procurement_cases_created_by_employee_id_fkey', t.createdByEmployeeId, employees.id),
    check(
      'procurement_cases_case_type_check',
      sql`case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal', 'general_seal', 'invoice_seal', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense', 'asset_transfer', 'custom')`
    ),
  ]
);

export const caseNumberCounters = pgTable('case_number_counters', {
  yearMonth: text('year_month').primaryKey(),
  lastSerial: integer('last_serial').notNull().default(0),
});

export const purchaseRequests = pgTable(
  'purchase_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
    requestDate: date('request_date').notNull().default(taipeiToday),
    neededWithinDays: integer('needed_within_days'),
    totalAmount: money('total_amount').notNull().default(sql`0`),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Incremented by every state change; edits must name the version they started from. */
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('purchase_requests_version_check', sql`version > 0`),
    fk('purchase_requests_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('purchase_requests_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('purchase_requests_department_id_fkey', t.departmentId, departments.id),
    fk('purchase_requests_budget_owner_employee_id_fkey', t.budgetOwnerEmployeeId, employees.id),
    check('purchase_requests_status_check', FORM_STATUS),
    index('purchase_requests_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('purchase_requests_status_idx').on(t.status),
  ]
);

export const purchaseRequestItems = pgTable(
  'purchase_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseRequestId: uuid('purchase_request_id').notNull(),
    lineNo: integer('line_no').notNull(),
    budgetCodeId: uuid('budget_code_id').notNull(),
    itemCategory: text('item_category').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    estimatedAmount: money('estimated_amount').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('purchase_request_items_purchase_request_id_fkey', t.purchaseRequestId, purchaseRequests.id).onDelete(
      'cascade'
    ),
    fk('purchase_request_items_budget_code_id_fkey', t.budgetCodeId, budgetCodes.id),
    check('purchase_request_items_quantity_check', sql`quantity > 0`),
    check('purchase_request_items_estimated_amount_check', sql`estimated_amount > 0`),
    unique('purchase_request_items_purchase_request_id_line_no_key').on(t.purchaseRequestId, t.lineNo),
  ]
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    purchaseRequestId: uuid('purchase_request_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    paymentMethod: text('payment_method').notNull(),
    paymentTerms: text('payment_terms').notNull(),
    expectedDeliveryDays: integer('expected_delivery_days'),
    quoteCount: integer('quote_count').notNull().default(1),
    quoteCountReason: text('quote_count_reason'),
    totalAmount: money('total_amount').notNull().default(sql`0`),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Incremented by every state change; edits must name the version they started from. */
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('purchase_orders_version_check', sql`version > 0`),
    fk('purchase_orders_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('purchase_orders_purchase_request_id_fkey', t.purchaseRequestId, purchaseRequests.id),
    fk('purchase_orders_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('purchase_orders_department_id_fkey', t.departmentId, departments.id),
    fk('purchase_orders_budget_owner_employee_id_fkey', t.budgetOwnerEmployeeId, employees.id),
    fk('purchase_orders_supplier_id_fkey', t.supplierId, suppliers.id),
    check(
      'purchase_orders_payment_terms_check',
      sql`payment_terms in ('預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他')`
    ),
    check('purchase_orders_quote_count_check', sql`quote_count >= 0`),
    check('purchase_orders_status_check', FORM_STATUS),
    unique('purchase_orders_procurement_case_id_key').on(t.procurementCaseId),
    index('purchase_orders_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('purchase_orders_status_idx').on(t.status),
  ]
);

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    lineNo: integer('line_no').notNull(),
    budgetCodeId: uuid('budget_code_id').notNull(),
    itemCategory: text('item_category').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: money('unit_price').notNull(),
    totalPrice: money('total_price').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('purchase_order_items_purchase_order_id_fkey', t.purchaseOrderId, purchaseOrders.id).onDelete('cascade'),
    fk('purchase_order_items_budget_code_id_fkey', t.budgetCodeId, budgetCodes.id),
    check('purchase_order_items_quantity_check', sql`quantity > 0`),
    check('purchase_order_items_unit_price_check', sql`unit_price > 0`),
    check('purchase_order_items_total_price_check', sql`total_price > 0`),
    unique('purchase_order_items_purchase_order_id_line_no_key').on(t.purchaseOrderId, t.lineNo),
  ]
);

export const acceptances = pgTable(
  'acceptances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
    contractorSupplierId: uuid('contractor_supplier_id').notNull(),
    acceptanceDate: date('acceptance_date').notNull().default(taipeiToday),
    totalAmount: money('total_amount').notNull().default(sql`0`),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Incremented by every state change; edits must name the version they started from. */
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('acceptances_version_check', sql`version > 0`),
    fk('acceptances_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('acceptances_purchase_order_id_fkey', t.purchaseOrderId, purchaseOrders.id),
    fk('acceptances_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('acceptances_department_id_fkey', t.departmentId, departments.id),
    fk('acceptances_budget_owner_employee_id_fkey', t.budgetOwnerEmployeeId, employees.id),
    fk('acceptances_contractor_supplier_id_fkey', t.contractorSupplierId, suppliers.id),
    check('acceptances_status_check', FORM_STATUS),
    unique('acceptances_procurement_case_id_key').on(t.procurementCaseId),
    index('acceptances_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('acceptances_status_idx').on(t.status),
  ]
);

export const acceptanceItems = pgTable(
  'acceptance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    acceptanceId: uuid('acceptance_id').notNull(),
    lineNo: integer('line_no').notNull(),
    purchaseOrderItemId: uuid('purchase_order_item_id').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    amount: money('amount').notNull(),
    passFail: text('pass_fail').notNull().default('pass'),
    propertyTag: text('property_tag'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('acceptance_items_acceptance_id_fkey', t.acceptanceId, acceptances.id).onDelete('cascade'),
    fk('acceptance_items_purchase_order_item_id_fkey', t.purchaseOrderItemId, purchaseOrderItems.id),
    check('acceptance_items_quantity_check', sql`quantity > 0`),
    check('acceptance_items_amount_check', sql`amount > 0`),
    check('acceptance_items_pass_fail_check', sql`pass_fail in ('pass', 'fail')`),
    unique('acceptance_items_acceptance_id_line_no_key').on(t.acceptanceId, t.lineNo),
  ]
);

export const expenseRequests = pgTable(
  'expense_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    purchaseOrderId: uuid('purchase_order_id'),
    budgetCodeId: uuid('budget_code_id'),
    acceptanceId: uuid('acceptance_id'),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
    payeeType: text('payee_type').notNull(),
    payeeSupplierId: uuid('payee_supplier_id'),
    paymentMethod: text('payment_method').notNull(),
    bankName: text('bank_name'),
    bankAccount: text('bank_account'),
    accountName: text('account_name'),
    invoiceMonth: text('invoice_month'),
    expectedPaymentDate: date('expected_payment_date'),
    paymentBatchDate: date('payment_batch_date'),
    totalAmount: money('total_amount').notNull().default(sql`0`),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Incremented by every state change; edits must name the version they started from. */
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('expense_requests_version_check', sql`version > 0`),
    fk('expense_requests_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('expense_requests_purchase_order_id_fkey', t.purchaseOrderId, purchaseOrders.id),
    fk('expense_requests_budget_code_id_fkey', t.budgetCodeId, budgetCodes.id),
    fk('expense_requests_acceptance_id_fkey', t.acceptanceId, acceptances.id),
    fk('expense_requests_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('expense_requests_department_id_fkey', t.departmentId, departments.id),
    fk('expense_requests_budget_owner_employee_id_fkey', t.budgetOwnerEmployeeId, employees.id),
    fk('expense_requests_payee_supplier_id_fkey', t.payeeSupplierId, suppliers.id),
    check('expense_requests_payee_type_check', sql`payee_type in ('employee', 'supplier')`),
    check('expense_requests_status_check', FORM_STATUS),
    check('expense_requests_check', sql`(payee_type = 'supplier') = (payee_supplier_id is not null)`),
    check(
      'expense_requests_po_xor_budget_code_check',
      sql`(purchase_order_id is not null) or (budget_code_id is not null)`
    ),
    unique('expense_requests_procurement_case_id_key').on(t.procurementCaseId),
    index('expense_requests_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('expense_requests_status_idx').on(t.status),
  ]
);

export const expenseRequestItems = pgTable(
  'expense_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseRequestId: uuid('expense_request_id').notNull(),
    lineNo: integer('line_no').notNull(),
    purchaseOrderItemId: uuid('purchase_order_item_id'),
    description: text('description').notNull(),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('expense_request_items_expense_request_id_fkey', t.expenseRequestId, expenseRequests.id).onDelete(
      'cascade'
    ),
    fk('expense_request_items_purchase_order_item_id_fkey', t.purchaseOrderItemId, purchaseOrderItems.id),
    check('expense_request_items_amount_check', sql`amount > 0`),
    unique('expense_request_items_expense_request_id_line_no_key').on(t.expenseRequestId, t.lineNo),
  ]
);

// ---------------------------------------------------------------------------
// Travel expenses (出差報告暨旅費報支單): own case number, outside the procurement chain
// ---------------------------------------------------------------------------

export const travelExpenses = pgTable(
  'travel_expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    budgetCodeId: uuid('budget_code_id').notNull(),
    budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
    formDate: date('form_date').notNull().default(taipeiToday),
    advanceAmount: money('advance_amount').notNull().default(sql`0`),
    tripStartDate: date('trip_start_date').notNull(),
    tripEndDate: date('trip_end_date').notNull(),
    purpose: text('purpose').notNull(),
    tripOrderNo: text('trip_order_no').notNull(),
    companions: text('companions').notNull(),
    totalAmount: money('total_amount').notNull().default(sql`0`),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Incremented by every state change; edits must name the version they started from. */
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('travel_expenses_version_check', sql`version > 0`),
    fk('travel_expenses_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('travel_expenses_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('travel_expenses_department_id_fkey', t.departmentId, departments.id),
    fk('travel_expenses_budget_code_id_fkey', t.budgetCodeId, budgetCodes.id),
    fk('travel_expenses_budget_owner_employee_id_fkey', t.budgetOwnerEmployeeId, employees.id),
    check('travel_expenses_status_check', FORM_STATUS),
    check('travel_expenses_trip_dates_check', sql`trip_end_date >= trip_start_date`),
    check('travel_expenses_advance_amount_check', sql`advance_amount >= 0`),
    check('travel_expenses_total_amount_check', sql`total_amount >= 0`),
    unique('travel_expenses_procurement_case_id_key').on(t.procurementCaseId),
    index('travel_expenses_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('travel_expenses_status_idx').on(t.status),
  ]
);

/** 出差報告: one row per day/segment of the trip. */
export const travelExpenseReportItems = pgTable(
  'travel_expense_report_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    travelExpenseId: uuid('travel_expense_id').notNull(),
    lineNo: integer('line_no').notNull(),
    tripDate: date('trip_date').notNull(),
    location: text('location').notNull(),
    itinerary: text('itinerary').notNull(),
    timeSlot: text('time_slot').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('travel_expense_report_items_travel_expense_id_fkey', t.travelExpenseId, travelExpenses.id).onDelete(
      'cascade'
    ),
    unique('travel_expense_report_items_travel_expense_id_line_no_key').on(t.travelExpenseId, t.lineNo),
  ]
);

/** 出差旅費結算: original-currency amount, the rate used, and the NT$ amount that is reimbursed. */
export const travelExpenseCostItems = pgTable(
  'travel_expense_cost_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    travelExpenseId: uuid('travel_expense_id').notNull(),
    lineNo: integer('line_no').notNull(),
    expenseDate: date('expense_date').notNull(),
    category: text('category').notNull(),
    fromStation: text('from_station'),
    toStation: text('to_station'),
    mileage: numeric('mileage', { precision: 10, scale: 1 }),
    summary: text('summary').notNull(),
    currency: text('currency').notNull(),
    amount: money('amount').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull(),
    twdAmount: money('twd_amount').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('travel_expense_cost_items_travel_expense_id_fkey', t.travelExpenseId, travelExpenses.id).onDelete(
      'cascade'
    ),
    check('travel_expense_cost_items_category_check', sql`category in ('交通費', '住宿費', '膳雜費', '其他')`),
    check(
      'travel_expense_cost_items_currency_check',
      sql`currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')`
    ),
    check('travel_expense_cost_items_amount_check', sql`amount > 0`),
    check('travel_expense_cost_items_exchange_rate_check', sql`exchange_rate > 0`),
    check('travel_expense_cost_items_twd_amount_check', sql`twd_amount > 0`),
    check('travel_expense_cost_items_mileage_check', sql`mileage is null or mileage >= 0`),
    check('travel_expense_cost_items_twd_rate_check', sql`currency <> 'TWD' or exchange_rate = 1`),
    unique('travel_expense_cost_items_travel_expense_id_line_no_key').on(t.travelExpenseId, t.lineNo),
  ]
);

// ---------------------------------------------------------------------------
// Contract seal requests (用印申請單(合約類)): own case number, no budget source.
// The applicant may differ from the person who filed it (procurement_cases.created_by).
// ---------------------------------------------------------------------------

export const contractSealRequests = pgTable(
  'contract_seal_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    applicationDate: date('application_date').notNull().default(taipeiToday),
    urgency: text('urgency').notNull(),
    expectedCompletionDate: date('expected_completion_date').notNull(),
    remark: text('remark').notNull(),
    documentType: text('document_type').notNull(),
    seals: text('seals').array().notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** 總價 (NT$); also decides whether the chairman signs. */
    totalAmount: money('total_amount').notNull().default(sql`0`),
    counterparty: text('counterparty').notNull(),
    subject: text('subject').notNull(),
    ndaChecks: text('nda_checks').array().notNull(),
    mouChecks: text('mou_checks').array().notNull(),
    legalReviewConfirmed: boolean('legal_review_confirmed').notNull().default(false),
    lendSeal: boolean('lend_seal').notNull().default(false),
    lendSealNote: text('lend_seal_note').notNull(),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('contract_seal_requests_version_check', sql`version > 0`),
    fk('contract_seal_requests_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('contract_seal_requests_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('contract_seal_requests_department_id_fkey', t.departmentId, departments.id),
    check('contract_seal_requests_status_check', FORM_STATUS),
    check('contract_seal_requests_urgency_check', sql`urgency in ('normal', 'urgent')`),
    check(
      'contract_seal_requests_document_type_check',
      sql`document_type in ('contract', 'agreement', 'nda', 'loi', 'mou')`
    ),
    check(
      'contract_seal_requests_seals_check',
      sql`cardinality(seals) > 0 and seals <@ array['perforation', 'contract_seal', 'signature', 'invoice_seal', 'e_signature', 'registration_seal', 'bank_seal']::text[]`
    ),
    check(
      'contract_seal_requests_nda_checks_check',
      sql`cardinality(nda_checks) > 0 and nda_checks <@ array['mutual', 'ip_retained', 'penalty_reviewed', 'not_applicable']::text[]`
    ),
    check(
      'contract_seal_requests_mou_checks_check',
      sql`cardinality(mou_checks) > 0 and mou_checks <@ array['non_binding', 'amount_range', 'not_applicable']::text[]`
    ),
    check('contract_seal_requests_period_check', sql`period_end >= period_start`),
    check('contract_seal_requests_expected_date_check', sql`expected_completion_date >= application_date`),
    check('contract_seal_requests_total_amount_check', sql`total_amount >= 0`),
    unique('contract_seal_requests_procurement_case_id_key').on(t.procurementCaseId),
    index('contract_seal_requests_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('contract_seal_requests_status_idx').on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// General seal requests (用印申請單(非合約類)): quotations, official letters,
// registration / bank / customs documents. Same workflow as contract seals, no amount.
// ---------------------------------------------------------------------------

export const generalSealRequests = pgTable(
  'general_seal_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    applicationDate: date('application_date').notNull().default(taipeiToday),
    urgency: text('urgency').notNull(),
    expectedCompletionDate: date('expected_completion_date').notNull(),
    remark: text('remark').notNull(),
    documentType: text('document_type').notNull(),
    documentDescription: text('document_description').notNull(),
    seals: text('seals').array().notNull(),
    lendSeal: boolean('lend_seal').notNull().default(false),
    lendSealNote: text('lend_seal_note').notNull(),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('general_seal_requests_version_check', sql`version > 0`),
    fk('general_seal_requests_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('general_seal_requests_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('general_seal_requests_department_id_fkey', t.departmentId, departments.id),
    check('general_seal_requests_status_check', FORM_STATUS),
    check('general_seal_requests_urgency_check', sql`urgency in ('normal', 'urgent')`),
    check(
      'general_seal_requests_document_type_check',
      sql`document_type in ('quotation', 'general_document', 'project_document', 'registration', 'banking', 'customs', 'other')`
    ),
    check(
      'general_seal_requests_seals_check',
      sql`cardinality(seals) > 0 and seals <@ array['perforation', 'contract_seal', 'registration_seal', 'bank_seal', 'invoice_seal', 'customs_seal', 'signature', 'e_signature']::text[]`
    ),
    check('general_seal_requests_expected_date_check', sql`expected_completion_date >= application_date`),
    unique('general_seal_requests_procurement_case_id_key').on(t.procurementCaseId),
    index('general_seal_requests_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('general_seal_requests_status_idx').on(t.status),
  ]
);

// ---------------------------------------------------------------------------
// Invoice seal requests (用印申請單(開立發票/Invoice)): ask for the invoice seal
// on an invoice to a customer. Revenue, not spending: the amount does not change the chain.
// ---------------------------------------------------------------------------

const CURRENCY_CHECK = sql`currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')`;

export const invoiceSealRequests = pgTable(
  'invoice_seal_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    applicationDate: date('application_date').notNull().default(taipeiToday),
    invoiceType: text('invoice_type').notNull(),
    seal: text('seal').notNull(),
    customerName: text('customer_name').notNull(),
    /** 統一編號; "0" for individuals and foreign customers. */
    customerTaxId: text('customer_tax_id').notNull(),
    customerAddress: text('customer_address').notNull(),
    customerPhone: text('customer_phone').notNull(),
    /** Every item is in this currency. */
    currency: text('currency').notNull(),
    untaxedTotal: money('untaxed_total').notNull(),
    /** 含稅總計 as entered (tax included for Taiwanese companies). */
    totalAmount: money('total_amount').notNull(),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('invoice_seal_requests_version_check', sql`version > 0`),
    fk('invoice_seal_requests_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('invoice_seal_requests_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('invoice_seal_requests_department_id_fkey', t.departmentId, departments.id),
    check('invoice_seal_requests_status_check', FORM_STATUS),
    check(
      'invoice_seal_requests_invoice_type_check',
      sql`invoice_type in ('triplicate', 'duplicate', 'e_invoice', 'export_invoice')`
    ),
    check('invoice_seal_requests_seal_check', sql`seal in ('invoice_seal', 'contract_seal', 'signature')`),
    check('invoice_seal_requests_customer_tax_id_check', sql`customer_tax_id = '0' or customer_tax_id ~ '^[0-9]{8}$'`),
    check('invoice_seal_requests_triplicate_tax_id_check', sql`invoice_type <> 'triplicate' or customer_tax_id <> '0'`),
    check('invoice_seal_requests_currency_check', CURRENCY_CHECK),
    check('invoice_seal_requests_untaxed_total_check', sql`untaxed_total > 0`),
    check('invoice_seal_requests_total_amount_check', sql`total_amount >= untaxed_total`),
    unique('invoice_seal_requests_procurement_case_id_key').on(t.procurementCaseId),
    index('invoice_seal_requests_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('invoice_seal_requests_status_idx').on(t.status),
  ]
);

/** 開立資訊: one row per invoice line. */
export const invoiceSealRequestItems = pgTable(
  'invoice_seal_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceSealRequestId: uuid('invoice_seal_request_id').notNull(),
    lineNo: integer('line_no').notNull(),
    itemName: text('item_name').notNull(),
    quantity: integer('quantity').notNull(),
    currency: text('currency').notNull(),
    unitPrice: money('unit_price').notNull(),
    /** quantity × unit price, before tax. */
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('invoice_seal_request_items_invoice_seal_request_id_fkey', t.invoiceSealRequestId, invoiceSealRequests.id).onDelete(
      'cascade'
    ),
    check('invoice_seal_request_items_quantity_check', sql`quantity > 0`),
    check('invoice_seal_request_items_currency_check', CURRENCY_CHECK),
    check('invoice_seal_request_items_unit_price_check', sql`unit_price > 0`),
    check('invoice_seal_request_items_amount_check', sql`amount = unit_price * quantity`),
    unique('invoice_seal_request_items_invoice_seal_request_id_line_no_key').on(t.invoiceSealRequestId, t.lineNo),
  ]
);

// ---------------------------------------------------------------------------
// Expense claims (費用申請單): reimbursement or payment charged to a budget,
// outside the procurement chain. One table pair per edition, identical columns:
//   department_expenses  部門版      department budget codes
//   project_expenses     產品專案版  budget codes of product projects
//   revenue_expenses     營收專案版  budget codes of revenue projects
//   minor_expenses       部門版_單筆一萬元以下  department budget codes, every line ≤ NT$10,000
// The applicant is always the filer; the department may differ when filing as
// 經辦 for another department.
// ---------------------------------------------------------------------------

// Prefixes stay short: constraint names like `${prefix}_items_${prefix}_id_line_no_key` must fit in 63 characters.
function expenseClaimTables<P extends 'department_expense' | 'project_expense' | 'revenue_expense' | 'minor_expense'>(
  prefix: P
) {
  const header = pgTable(
    `${prefix}s`,
    {
      id: uuid('id').primaryKey().defaultRandom(),
      procurementCaseId: uuid('procurement_case_id').notNull(),
      applicantEmployeeId: uuid('applicant_employee_id').notNull(),
      departmentId: uuid('department_id').notNull(),
      budgetCodeId: uuid('budget_code_id').notNull(),
      budgetOwnerEmployeeId: uuid('budget_owner_employee_id').notNull(),
      applicationDate: date('application_date').notNull().default(taipeiToday),
      remark: text('remark'),
      payeeType: text('payee_type').notNull(),
      payeeSupplierId: uuid('payee_supplier_id'),
      expectedPaymentDate: date('expected_payment_date').notNull(),
      paymentMethod: text('payment_method').notNull(),
      /** 銀行名稱+銀行戶名+銀行帳號 as typed; "無" when not paid by transfer. */
      remittanceInfo: text('remittance_info').notNull(),
      totalAmount: money('total_amount').notNull(),
      status: text('status').notNull().default('pending_approval'),
      currentStepOrder: integer('current_step_order'),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
      version: integer('version').notNull().default(1),
    },
    (t): PgTableExtraConfigValue[] => [
      check(`${prefix}s_version_check`, sql`version > 0`),
      fk(`${prefix}s_procurement_case_id_fkey`, t.procurementCaseId, procurementCases.id),
      fk(`${prefix}s_applicant_employee_id_fkey`, t.applicantEmployeeId, employees.id),
      fk(`${prefix}s_department_id_fkey`, t.departmentId, departments.id),
      fk(`${prefix}s_budget_code_id_fkey`, t.budgetCodeId, budgetCodes.id),
      fk(`${prefix}s_budget_owner_employee_id_fkey`, t.budgetOwnerEmployeeId, employees.id),
      fk(`${prefix}s_payee_supplier_id_fkey`, t.payeeSupplierId, suppliers.id),
      check(`${prefix}s_status_check`, FORM_STATUS),
      check(`${prefix}s_payee_type_check`, sql`payee_type in ('applicant', 'supplier')`),
      check(`${prefix}s_payee_supplier_check`, sql`(payee_type = 'supplier') = (payee_supplier_id is not null)`),
      check(`${prefix}s_payment_method_check`, sql`payment_method in ('transfer', 'cash', 'check')`),
      check(`${prefix}s_total_amount_check`, sql`total_amount > 0`),
      unique(`${prefix}s_procurement_case_id_key`).on(t.procurementCaseId),
      index(`${prefix}s_applicant_employee_id_idx`).on(t.applicantEmployeeId),
      index(`${prefix}s_status_idx`).on(t.status),
    ]
  );

  /** 請款內容: one row per voucher; amount in its own currency, twd_amount is what is paid. */
  const items = pgTable(
    `${prefix}_items`,
    {
      id: uuid('id').primaryKey().defaultRandom(),
      claimId: uuid(`${prefix}_id`).notNull(),
      lineNo: integer('line_no').notNull(),
      category: text('category').notNull(),
      description: text('description').notNull(),
      currency: text('currency').notNull(),
      exchangeRate: numeric('exchange_rate', { precision: 12, scale: 6 }).notNull(),
      amount: money('amount').notNull(),
      twdAmount: money('twd_amount').notNull(),
      createdAt: createdAt(),
    },
    (t): PgTableExtraConfigValue[] => [
      fk(`${prefix}_items_${prefix}_id_fkey`, t.claimId, header.id).onDelete('cascade'),
      check(`${prefix}_items_currency_check`, CURRENCY_CHECK),
      check(`${prefix}_items_amount_check`, sql`amount > 0`),
      check(`${prefix}_items_exchange_rate_check`, sql`exchange_rate > 0`),
      check(`${prefix}_items_twd_amount_check`, sql`twd_amount > 0`),
      check(`${prefix}_items_twd_rate_check`, sql`currency <> 'TWD' or exchange_rate = 1`),
      unique(`${prefix}_items_${prefix}_id_line_no_key`).on(t.claimId, t.lineNo),
    ]
  );

  return { header, items };
}

export const { header: departmentExpenses, items: departmentExpenseItems } = expenseClaimTables('department_expense');
export const { header: projectExpenses, items: projectExpenseItems } = expenseClaimTables('project_expense');
export const { header: revenueExpenses, items: revenueExpenseItems } = expenseClaimTables('revenue_expense');
export const { header: minorExpenses, items: minorExpenseItems } = expenseClaimTables('minor_expense');

// ---------------------------------------------------------------------------
// Asset register (財產保管清冊) and asset transfers (資產異動申請單). An
// approved transfer writes its rows into the register (applied_at).
// ---------------------------------------------------------------------------

const sqlList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 財產編號 on the property label. */
    tag: text('tag').notNull().unique('assets_tag_key'),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    custodianEmployeeId: uuid('custodian_employee_id').notNull(),
    location: text('location').notNull().default(''),
    /** in_custody / lent are in the register; merged / sold / scrapped have left it. */
    status: text('status').notNull().default('in_custody'),
    remark: text('remark'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('assets_custodian_employee_id_fkey', t.custodianEmployeeId, employees.id),
    check('assets_quantity_check', sql`quantity > 0`),
    check('assets_status_check', sql`status in (${sqlList(ASSET_STATUSES)})`),
    index('assets_custodian_employee_id_idx').on(t.custodianEmployeeId),
  ]
);

export const assetTransfers = pgTable(
  'asset_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    /** 申請人部門 (may differ from the applicant's own when filing as 經辦). */
    departmentId: uuid('department_id').notNull(),
    useDepartmentId: uuid('use_department_id').notNull(),
    /** 使用專案/客戶名稱. */
    useBudgetCodeId: uuid('use_budget_code_id').notNull(),
    applicationDate: date('application_date').notNull().default(taipeiToday),
    /** 異動說明 (checked boxes); every row's reason is one of them. */
    transferTypes: text('transfer_types').array().notNull(),
    remark: text('remark'),
    originalCustodianEmployeeId: uuid('original_custodian_employee_id').notNull(),
    newCustodianEmployeeId: uuid('new_custodian_employee_id').notNull(),
    otherCustodianEmployeeId: uuid('other_custodian_employee_id'),
    originalManagerEmployeeId: uuid('original_manager_employee_id').notNull(),
    newManagerEmployeeId: uuid('new_manager_employee_id').notNull(),
    otherManagerEmployeeId: uuid('other_manager_employee_id'),
    /** When the approved rows were written into the register. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    status: text('status').notNull().default('pending_approval'),
    currentStepOrder: integer('current_step_order'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    check('asset_transfers_version_check', sql`version > 0`),
    fk('asset_transfers_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    fk('asset_transfers_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('asset_transfers_department_id_fkey', t.departmentId, departments.id),
    fk('asset_transfers_use_department_id_fkey', t.useDepartmentId, departments.id),
    fk('asset_transfers_use_budget_code_id_fkey', t.useBudgetCodeId, budgetCodes.id),
    fk('asset_transfers_original_custodian_fkey', t.originalCustodianEmployeeId, employees.id),
    fk('asset_transfers_new_custodian_fkey', t.newCustodianEmployeeId, employees.id),
    fk('asset_transfers_other_custodian_fkey', t.otherCustodianEmployeeId, employees.id),
    fk('asset_transfers_original_manager_fkey', t.originalManagerEmployeeId, employees.id),
    fk('asset_transfers_new_manager_fkey', t.newManagerEmployeeId, employees.id),
    fk('asset_transfers_other_manager_fkey', t.otherManagerEmployeeId, employees.id),
    check('asset_transfers_status_check', FORM_STATUS),
    check(
      'asset_transfers_transfer_types_check',
      sql`cardinality(transfer_types) > 0 and transfer_types <@ array[${sqlList(ASSET_TRANSFER_TYPES)}]::text[]`
    ),
    check('asset_transfers_applied_check', sql`applied_at is null or status = 'approved'`),
    unique('asset_transfers_procurement_case_id_key').on(t.procurementCaseId),
    index('asset_transfers_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('asset_transfers_status_idx').on(t.status),
  ]
);

/** 申請資料: one row per asset; tag, name, quantity and the original custodian are snapshots from the register. */
export const assetTransferItems = pgTable(
  'asset_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetTransferId: uuid('asset_transfer_id').notNull(),
    lineNo: integer('line_no').notNull(),
    assetId: uuid('asset_id').notNull(),
    assetTag: text('asset_tag').notNull(),
    assetName: text('asset_name').notNull(),
    quantity: integer('quantity').notNull(),
    originalCustodianEmployeeId: uuid('original_custodian_employee_id').notNull(),
    originalLocation: text('original_location').notNull(),
    reason: text('reason').notNull(),
    newCustodianEmployeeId: uuid('new_custodian_employee_id').notNull(),
    newLocation: text('new_location').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('asset_transfer_items_asset_transfer_id_fkey', t.assetTransferId, assetTransfers.id).onDelete('cascade'),
    fk('asset_transfer_items_asset_id_fkey', t.assetId, assets.id),
    fk('asset_transfer_items_original_custodian_fkey', t.originalCustodianEmployeeId, employees.id),
    fk('asset_transfer_items_new_custodian_fkey', t.newCustodianEmployeeId, employees.id),
    check('asset_transfer_items_quantity_check', sql`quantity > 0`),
    check('asset_transfer_items_reason_check', sql`reason in (${sqlList(ASSET_TRANSFER_TYPES)})`),
    unique('asset_transfer_items_asset_transfer_id_line_no_key').on(t.assetTransferId, t.lineNo),
    unique('asset_transfer_items_asset_transfer_id_asset_id_key').on(t.assetTransferId, t.assetId),
    index('asset_transfer_items_asset_id_idx').on(t.assetId),
  ]
);

// ---------------------------------------------------------------------------
// Form builder runtime: definitions with immutable published versions, and
// submissions stored as JSON plus typed "promoted" columns. Every submission
// uses form_type 'custom' in approval_steps / attachments / notifications.
// ---------------------------------------------------------------------------

/** Entry categories (top nav menus, /forms hub). */
export const formCategories = pgTable(
  'form_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique('form_categories_key_key'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (): PgTableExtraConfigValue[] => [check('form_categories_key_check', sql`key ~ '^[a-z][a-z0-9_]{0,39}$'`)]
);

export const formDefinitions = pgTable(
  'form_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** URL key (/f/<key>); never changes once published. */
    key: text('key').notNull().unique('form_definitions_key_key'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    categoryId: uuid('category_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    status: text('status').notNull().default('draft'),
    publishedVersionId: uuid('published_version_id'),
    /** Work in progress in the designer; copied into a new version on publish. */
    draftSchema: jsonb('draft_schema'),
    draftFlow: jsonb('draft_flow'),
    /** Form number = YYYYMMDD + prefix + daily serial, e.g. 20260909SA0002. */
    numberPrefix: text('number_prefix').notNull(),
    /** {} = everyone; { departmentIds?: uuid[], jobRoles?: code[] } = only those (either matches). */
    visibility: jsonb('visibility').notNull().default(sql`'{}'::jsonb`),
    /** Set on definitions that replace a hard-coded form (migration batches). */
    legacyFormType: text('legacy_form_type'),
    /** Deleted in the designer while submissions still need it: hidden there, kept (archived) for those submissions. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByEmployeeId: uuid('deleted_by_employee_id'),
    createdByEmployeeId: uuid('created_by_employee_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('form_definitions_category_id_fkey', t.categoryId, formCategories.id),
    fk('form_definitions_created_by_fkey', t.createdByEmployeeId, employees.id),
    fk('form_definitions_deleted_by_fkey', t.deletedByEmployeeId, employees.id),
    check('form_definitions_deleted_check', sql`(deleted_at is null) = (deleted_by_employee_id is null) and (deleted_at is null or status = 'archived')`),
    // The published version must belong to this definition.
    foreignKey({
      name: 'form_definitions_published_version_fkey',
      columns: [t.publishedVersionId, t.id],
      foreignColumns: [formDefinitionVersions.id, formDefinitionVersions.definitionId],
    }),
    check('form_definitions_key_check', sql`key ~ '^[a-z][a-z0-9-]{1,39}$'`),
    check('form_definitions_status_check', sql`status in ('draft', 'published', 'archived')`),
    check('form_definitions_published_check', sql`status <> 'published' or published_version_id is not null`),
    check('form_definitions_number_prefix_check', sql`number_prefix ~ '^[A-Z][A-Z0-9]{0,5}$'`),
    check('form_definitions_visibility_check', sql`jsonb_typeof(visibility) = 'object'`),
    check('form_definitions_version_check', sql`version > 0`),
  ]
);

/** Published versions; a database trigger refuses UPDATE, and DELETE while a submission uses the version. */
export const formDefinitionVersions = pgTable(
  'form_definition_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id').notNull(),
    version: integer('version').notNull(),
    schema: jsonb('schema').notNull(),
    flow: jsonb('flow').notNull(),
    /** Registered post-approval actions (none yet). */
    actions: jsonb('actions').notNull().default(sql`'[]'::jsonb`),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedByEmployeeId: uuid('published_by_employee_id').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('form_definition_versions_definition_id_fkey', t.definitionId, formDefinitions.id),
    fk('form_definition_versions_published_by_fkey', t.publishedByEmployeeId, employees.id),
    unique('form_definition_versions_definition_id_version_key').on(t.definitionId, t.version),
    unique('form_definition_versions_id_definition_id_key').on(t.id, t.definitionId),
    check('form_definition_versions_version_check', sql`version > 0`),
  ]
);

export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    procurementCaseId: uuid('procurement_case_id').notNull(),
    definitionId: uuid('definition_id').notNull(),
    /** The version the applicant filled in; edits and resubmits stay on it. */
    versionId: uuid('version_id').notNull(),
    formNumber: text('form_number').notNull().unique('form_submissions_form_number_key'),
    applicantEmployeeId: uuid('applicant_employee_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    status: text('status').notNull().default('pending_approval'),
    data: jsonb('data').notNull(),
    /** Promoted from the field marked as the form amount / main budget code / project. */
    totalAmount: money('total_amount'),
    budgetCodeId: uuid('budget_code_id'),
    projectId: uuid('project_id'),
    currentStepOrder: integer('current_step_order'),
    /** Forms linked to the asset register: when the approved lines were written into it. */
    registerAppliedAt: timestamp('register_applied_at', { withTimezone: true }),
    /** 關聯單據: the approved submission this one continues (same case). */
    sourceSubmissionId: uuid('source_submission_id'),
    /** Who filed it (the applicant, or the 經辦 filing on their behalf); older rows use the case creator. */
    filedByEmployeeId: uuid('filed_by_employee_id'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer('version').notNull().default(1),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('form_submissions_procurement_case_id_fkey', t.procurementCaseId, procurementCases.id),
    foreignKey({
      name: 'form_submissions_version_fkey',
      columns: [t.versionId, t.definitionId],
      foreignColumns: [formDefinitionVersions.id, formDefinitionVersions.definitionId],
    }),
    fk('form_submissions_applicant_employee_id_fkey', t.applicantEmployeeId, employees.id),
    fk('form_submissions_department_id_fkey', t.departmentId, departments.id),
    fk('form_submissions_budget_code_id_fkey', t.budgetCodeId, budgetCodes.id),
    fk('form_submissions_project_id_fkey', t.projectId, projects.id),
    fk('form_submissions_source_submission_id_fkey', t.sourceSubmissionId, t.id),
    fk('form_submissions_filed_by_employee_id_fkey', t.filedByEmployeeId, employees.id),
    check('form_submissions_status_check', FORM_STATUS),
    check('form_submissions_data_check', sql`jsonb_typeof(data) = 'object'`),
    check('form_submissions_version_check', sql`version > 0`),
    /** One submission per form and case (a case holds a chain of different forms). */
    unique('form_submissions_definition_case_key').on(t.definitionId, t.procurementCaseId),
    index('form_submissions_procurement_case_id_idx').on(t.procurementCaseId),
    index('form_submissions_source_submission_id_idx').on(t.sourceSubmissionId),
    index('form_submissions_definition_applicant_idx').on(t.definitionId, t.applicantEmployeeId),
    index('form_submissions_applicant_employee_id_idx').on(t.applicantEmployeeId),
    index('form_submissions_status_idx').on(t.status),
  ]
);

/**
 * Register snapshot of each asset on a designer form linked to the asset
 * register (schema.assetRegister), taken at submit: what the approval is
 * about, which assets are claimed while it is pending, and what the register
 * must still say when the approved lines are applied.
 */
export const formSubmissionAssetLines = pgTable(
  'form_submission_asset_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull(),
    lineNo: integer('line_no').notNull(),
    assetId: uuid('asset_id').notNull(),
    assetTag: text('asset_tag').notNull(),
    assetName: text('asset_name').notNull(),
    quantity: integer('quantity').notNull(),
    originalCustodianEmployeeId: uuid('original_custodian_employee_id').notNull(),
    originalLocation: text('original_location').notNull(),
    reason: text('reason').notNull(),
    newCustodianEmployeeId: uuid('new_custodian_employee_id').notNull(),
    newLocation: text('new_location').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('form_submission_asset_lines_submission_id_fkey', t.submissionId, formSubmissions.id).onDelete('cascade'),
    fk('form_submission_asset_lines_asset_id_fkey', t.assetId, assets.id),
    fk('form_submission_asset_lines_original_custodian_fkey', t.originalCustodianEmployeeId, employees.id),
    fk('form_submission_asset_lines_new_custodian_fkey', t.newCustodianEmployeeId, employees.id),
    check('form_submission_asset_lines_quantity_check', sql`quantity > 0`),
    check('form_submission_asset_lines_reason_check', sql`reason in (${sqlList(ASSET_TRANSFER_TYPES)})`),
    unique('form_submission_asset_lines_submission_id_line_no_key').on(t.submissionId, t.lineNo),
    unique('form_submission_asset_lines_submission_id_asset_id_key').on(t.submissionId, t.assetId),
    index('form_submission_asset_lines_asset_id_idx').on(t.assetId),
  ]
);

/** Daily serial per definition for form numbers. */
export const formNumberCounters = pgTable(
  'form_number_counters',
  {
    definitionId: uuid('definition_id').notNull(),
    period: text('period').notNull(),
    lastSerial: integer('last_serial').notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'form_number_counters_pkey', columns: [t.definitionId, t.period] }),
    fk('form_number_counters_definition_id_fkey', t.definitionId, formDefinitions.id),
    check('form_number_counters_period_check', sql`period ~ '^[0-9]{8}$'`),
  ]
);

// ---------------------------------------------------------------------------
// Approval, notifications, attachments
// ---------------------------------------------------------------------------

export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    stepOrder: integer('step_order').notNull(),
    /** null only for a step skipped because nobody could be resolved. */
    approverEmployeeId: uuid('approver_employee_id'),
    approverRole: text('approver_role').notNull(),
    /**
     * pending / approved / returned: a person acts. auto_approved: resolved to
     * the applicant, the filer or someone who already signed earlier (系統代簽).
     * skipped: nobody could be resolved and the flow allows skipping.
     */
    status: text('status').notNull().default('pending'),
    comment: text('comment'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: createdAt(),
    /** Label of the configured step at submission time (flows can be renamed later). */
    stepLabel: text('step_label'),
    sourceKind: text('source_kind'),
    delegatedFromEmployeeId: uuid('delegated_from_employee_id'),
    systemNote: text('system_note'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('approval_steps_approver_employee_id_fkey', t.approverEmployeeId, employees.id),
    fk('approval_steps_delegated_from_employee_id_fkey', t.delegatedFromEmployeeId, employees.id),
    check('approval_steps_form_type_check', FORM_TYPES),
    check(
      'approval_steps_approver_role_check',
      sql`approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman', 'original_custodian', 'new_custodian', 'other_custodian', 'original_custodian_manager', 'new_custodian_manager', 'other_custodian_manager', 'applicant_confirmation') or approver_role ~ '^step:[A-Za-z0-9_-]{1,64}$'`
    ),
    check('approval_steps_status_check', sql`status in ('pending', 'approved', 'returned', 'auto_approved', 'skipped')`),
    check('approval_steps_approver_check', sql`approver_employee_id is not null or status = 'skipped'`),
    check(
      'approval_steps_source_kind_check',
      sql`source_kind is null or source_kind in ('employee', 'department_manager', 'department_members', 'org_chain', 'form_party', 'employee_group', 'job_role')`
    ),
    unique('approval_steps_form_type_form_id_step_order_key').on(t.formType, t.formId, t.stepOrder),
    index('approval_steps_form_type_form_id_idx').on(t.formType, t.formId),
    index('approval_steps_approver_employee_id_status_idx').on(t.approverEmployeeId, t.status),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientEmployeeId: uuid('recipient_employee_id').notNull(),
    type: text('type').notNull(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    caseNumber: text('case_number').notNull(),
    message: text('message').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: createdAt(),
    /** Stable key of the event that produced this notification; retries do not duplicate it. */
    eventKey: text('event_key'),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex('notifications_event_key_idx').on(t.eventKey).where(sql`event_key is not null`),
    fk('notifications_recipient_employee_id_fkey', t.recipientEmployeeId, employees.id),
    check(
      'notifications_type_check',
      sql`type in ('approval_requested', 'request_returned', 'request_approved')`
    ),
    index('notifications_recipient_employee_id_is_read_idx').on(t.recipientEmployeeId, t.isRead),
  ]
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    uploadedByEmployeeId: uuid('uploaded_by_employee_id').notNull(),
    storagePath: text('storage_path').notNull().unique('attachments_storage_path_key'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
    /**
     * pending: stored in quarantine, not yet scanned; clean: may be downloaded;
     * infected / scan_failed: never served; unscanned: scanning disabled
     * (development only, or files from before scanning existed).
     */
    scanStatus: text('scan_status').notNull().default('pending'),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    sha256: text('sha256'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('attachments_uploaded_by_employee_id_fkey', t.uploadedByEmployeeId, employees.id),
    check('attachments_form_type_check', FORM_TYPES),
    check('attachments_file_size_bytes_check', sql`file_size_bytes > 0`),
    check(
      'attachments_scan_status_check',
      sql`scan_status in ('pending', 'clean', 'infected', 'scan_failed', 'unscanned')`
    ),
    index('attachments_form_type_form_id_idx').on(t.formType, t.formId),
  ]
);

// ---------------------------------------------------------------------------
// Identity, sessions, audit
// ---------------------------------------------------------------------------

/**
 * External login identities bound to an employee. The stable key is
 * (provider, issuer, subject) -- e.g. Google's `sub` -- never the email, which
 * is only a descriptive attribute. Rows are created by an explicit binding
 * step (admin approval, or first-login bootstrap when employees.google_email
 * matches the verified Workspace address and the employee has no active binding).
 */
export const employeeIdentities = pgTable(
  'employee_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id').notNull(),
    provider: text('provider').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email'),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('employee_identities_employee_id_fkey', t.employeeId, employees.id),
    check('employee_identities_provider_check', sql`provider in ('google')`),
    check('employee_identities_issuer_check', sql`issuer <> ''`),
    check('employee_identities_subject_check', sql`subject <> ''`),
    unique('employee_identities_provider_issuer_subject_key').on(t.provider, t.issuer, t.subject),
    uniqueIndex('employee_identities_one_active_per_provider_idx')
      .on(t.employeeId, t.provider)
      .where(sql`revoked_at is null`),
  ]
);

/**
 * Server-side sessions. The cookie carries a random token; only its SHA-256
 * hex digest is stored, so a database leak does not yield usable cookies.
 */
export const appSessions = pgTable(
  'app_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique('app_sessions_token_hash_key'),
    employeeId: uuid('employee_id').notNull(),
    identityId: uuid('identity_id'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('app_sessions_employee_id_fkey', t.employeeId, employees.id),
    fk('app_sessions_identity_id_fkey', t.identityId, employeeIdentities.id),
    check('app_sessions_token_hash_check', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('app_sessions_expiry_check', sql`expires_at > created_at`),
    index('app_sessions_active_employee_idx').on(t.employeeId).where(sql`revoked_at is null`),
    index('app_sessions_expires_at_idx').on(t.expiresAt),
  ]
);

/**
 * Append-only audit trail (UPDATE/DELETE/TRUNCATE are blocked by triggers in
 * migration 0003). `details` must never hold tokens, full bank account numbers
 * or document contents.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorEmployeeId: uuid('actor_employee_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    requestId: text('request_id'),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('audit_events_actor_employee_id_fkey', t.actorEmployeeId, employees.id),
    check('audit_events_actor_type_check', sql`actor_type in ('employee', 'system')`),
    check(
      'audit_events_actor_check',
      sql`(actor_type = 'employee') = (actor_employee_id is not null)`
    ),
    index('audit_events_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('audit_events_actor_idx').on(t.actorEmployeeId, t.occurredAt),
  ]
);

/**
 * One row per OIDC login attempt, keyed by the SHA-256 of `state`. The
 * callback consumes it atomically, so each authorization response is accepted
 * at most once and only within its lifetime.
 */
export const oidcLoginStates = pgTable(
  'oidc_login_states',
  {
    stateHash: text('state_hash').primaryKey(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    check('oidc_login_states_state_hash_check', sql`state_hash ~ '^[0-9a-f]{64}$'`),
    index('oidc_login_states_expires_at_idx').on(t.expiresAt),
  ]
);

/**
 * A verified Google account that is not bound to any employee yet. Created on
 * login; an admin approves it for a specific employee (or rejects it). Email is
 * shown to help the admin decide but is never used to bind automatically.
 */
export const identityLinkRequests = pgTable(
  'identity_link_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    status: text('status').notNull().default('pending'),
    conflictReason: text('conflict_reason'),
    attemptCount: integer('attempt_count').notNull().default(1),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByEmployeeId: uuid('decided_by_employee_id'),
    approvedEmployeeId: uuid('approved_employee_id'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('identity_link_requests_decided_by_employee_id_fkey', t.decidedByEmployeeId, employees.id),
    fk('identity_link_requests_approved_employee_id_fkey', t.approvedEmployeeId, employees.id),
    check('identity_link_requests_provider_check', sql`provider in ('google')`),
    check('identity_link_requests_status_check', sql`status in ('pending', 'approved', 'rejected')`),
    check(
      'identity_link_requests_decision_check',
      sql`(status = 'pending') = (decided_at is null) and (status = 'approved') = (approved_employee_id is not null)`
    ),
    unique('identity_link_requests_provider_issuer_subject_key').on(t.provider, t.issuer, t.subject),
    index('identity_link_requests_status_idx').on(t.status, t.lastAttemptAt),
  ]
);

/**
 * Last complete Google Workspace directory listing (read-only snapshot). Only
 * an applied sync writes it. Profile columns are suggestions for an admin;
 * departments, roles and approvers stay managed in ACCSYS.
 */
export const directoryUsers = pgTable(
  'directory_users',
  {
    directoryUserId: text('directory_user_id').primaryKey(),
    customerId: text('customer_id'),
    primaryEmail: text('primary_email').notNull(),
    fullName: text('full_name').notNull().default(''),
    suspended: boolean('suspended').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    orgUnitPath: text('org_unit_path'),
    phone: text('phone'),
    title: text('title'),
    department: text('department'),
    employeeCode: text('employee_code'),
    managerEmail: text('manager_email'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a complete listing no longer contains the account. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    check('directory_users_id_check', sql`directory_user_id ~ '^[0-9]{1,32}$'`),
    check('directory_users_email_check', sql`primary_email = lower(primary_email) and primary_email like '%_@_%'`),
    index('directory_users_primary_email_idx').on(t.primaryEmail),
  ]
);

/** One row per applied (or refused / failed) directory sync. Never holds tokens or raw responses. */
export const directorySyncRuns = pgTable(
  'directory_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull(),
    pages: integer('pages'),
    directoryCount: integer('directory_count'),
    activeCount: integer('active_count'),
    error: text('error'),
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
  },
  (t): PgTableExtraConfigValue[] => [
    check('directory_sync_runs_source_check', sql`source in ('directory', 'fixture')`),
    check('directory_sync_runs_status_check', sql`status in ('succeeded', 'blocked', 'failed')`),
    check('directory_sync_runs_error_check', sql`(status = 'succeeded') = (error is null) and char_length(coalesce(error, '')) <= 500`),
    index('directory_sync_runs_finished_at_idx').on(t.finishedAt),
  ]
);

/** Fixed-window counters for login and admin rate limits (shared across processes). */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    bucketKey: text('bucket_key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'rate_limit_buckets_pkey', columns: [t.bucketKey, t.windowStart] }),
    index('rate_limit_buckets_window_start_idx').on(t.windowStart),
  ]
);

/**
 * Idempotent creation: the same (employee, operation, key) with the same
 * request returns the original result; a different request is refused.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    actorEmployeeId: uuid('actor_employee_id').notNull(),
    operation: text('operation').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'idempotency_keys_pkey', columns: [t.actorEmployeeId, t.operation, t.idempotencyKey] }),
    fk('idempotency_keys_actor_employee_id_fkey', t.actorEmployeeId, employees.id),
    check('idempotency_keys_key_check', sql`length(idempotency_key) between 8 and 100`),
    index('idempotency_keys_created_at_idx').on(t.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// AI assistant (conversation + application drafts; not form-designer schemas)
// ---------------------------------------------------------------------------

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    title: text('title').notNull().default(''),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('ai_conversations_owner_employee_id_fkey', t.ownerEmployeeId, employees.id),
    index('ai_conversations_owner_updated_idx').on(t.ownerEmployeeId, t.updatedAt),
    check('ai_conversations_title_check', sql`char_length(title) <= 120`),
  ]
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull(),
    role: text('role').notNull(),
    clientMessageId: text('client_message_id'),
    contentText: text('content_text').notNull().default(''),
    blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
    toolsUsed: jsonb('tools_used').notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('ai_messages_conversation_id_fkey', t.conversationId, aiConversations.id),
    check('ai_messages_role_check', sql`role in ('user', 'model', 'system')`),
    check('ai_messages_blocks_check', sql`jsonb_typeof(blocks) = 'array'`),
    check('ai_messages_tools_used_check', sql`jsonb_typeof(tools_used) = 'array'`),
    uniqueIndex('ai_messages_conversation_client_message_uidx').on(t.conversationId, t.clientMessageId),
    index('ai_messages_conversation_created_idx').on(t.conversationId, t.createdAt),
  ]
);

export const aiApplicationDrafts = pgTable(
  'ai_application_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    formDefinitionKey: text('form_definition_key').notNull(),
    formVersionId: uuid('form_version_id'),
    title: text('title').notNull().default(''),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    version: integer('version').notNull().default(1),
    status: text('status').notNull().default('draft'),
    submissionId: uuid('submission_id'),
    /** Same user turn + formKey → reuse draft (model/request retry). */
    createIdempotencyKey: text('create_idempotency_key'),
    /** 補件: the returned submission this draft revises; it stays on that submission's form version. */
    resubmitOfSubmissionId: uuid('resubmit_of_submission_id'),
    /** Submission version the draft was copied from; a change since then blocks the resubmit. */
    resubmitBaseVersion: integer('resubmit_base_version'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('ai_application_drafts_conversation_id_fkey', t.conversationId, aiConversations.id),
    fk('ai_application_drafts_owner_employee_id_fkey', t.ownerEmployeeId, employees.id),
    fk('ai_application_drafts_submission_id_fkey', t.submissionId, formSubmissions.id),
    fk('ai_application_drafts_resubmit_of_fkey', t.resubmitOfSubmissionId, formSubmissions.id),
    check('ai_application_drafts_status_check', sql`status in ('draft', 'submitted', 'abandoned')`),
    check('ai_application_drafts_data_check', sql`jsonb_typeof(data) = 'object'`),
    check('ai_application_drafts_version_check', sql`version > 0`),
    check('ai_application_drafts_title_check', sql`char_length(title) <= 160`),
    uniqueIndex('ai_application_drafts_open_resubmit_uidx')
      .on(t.resubmitOfSubmissionId)
      .where(sql`resubmit_of_submission_id is not null and status = 'draft'`),
    uniqueIndex('ai_application_drafts_owner_create_idem_uidx')
      .on(t.ownerEmployeeId, t.createIdempotencyKey)
      .where(sql`create_idempotency_key is not null`),
    index('ai_application_drafts_owner_updated_idx').on(t.ownerEmployeeId, t.updatedAt),
    index('ai_application_drafts_conversation_idx').on(t.conversationId),
  ]
);

/** Launcher / multi-tab dedupe of proactive assistant events. */
export const aiAssistantEventAcks = pgTable(
  'ai_assistant_event_acks',
  {
    employeeId: uuid('employee_id').notNull(),
    eventKey: text('event_key').notNull(),
    state: text('state').notNull().default('viewed'),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'ai_assistant_event_acks_pkey', columns: [t.employeeId, t.eventKey] }),
    fk('ai_assistant_event_acks_employee_id_fkey', t.employeeId, employees.id),
    check('ai_assistant_event_acks_state_check', sql`state in ('delivered', 'viewed', 'dismissed', 'muted')`),
    check(
      'ai_assistant_event_acks_event_key_check',
      sql`char_length(event_key) >= 1 AND char_length(event_key) <= 200`
    ),
    index('ai_assistant_event_acks_employee_updated_idx').on(t.employeeId, t.updatedAt),
  ]
);

export const aiProjectUsage = pgTable(
  'ai_project_usage',
  {
    employeeId: uuid('employee_id').notNull(),
    projectId: uuid('project_id').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'ai_project_usage_pkey', columns: [t.employeeId, t.projectId] }),
    fk('ai_project_usage_employee_id_fkey', t.employeeId, employees.id),
    fk('ai_project_usage_project_id_fkey', t.projectId, projects.id),
    index('ai_project_usage_employee_last_used_idx').on(t.employeeId, t.lastUsedAt),
  ]
);

/** One nudge per form per Taipei calendar day (system-wide). */
export const aiNudgeEvents = pgTable(
  'ai_nudge_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    businessDate: date('business_date').notNull(),
    actorEmployeeId: uuid('actor_employee_id').notNull(),
    recipients: jsonb('recipients').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('queued'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('ai_nudge_events_actor_employee_id_fkey', t.actorEmployeeId, employees.id),
    unique('ai_nudge_events_form_day_key').on(t.formType, t.formId, t.businessDate),
    check('ai_nudge_events_status_check', sql`status in ('queued', 'notified', 'failed')`),
    check('ai_nudge_events_recipients_check', sql`jsonb_typeof(recipients) = 'array'`),
    index('ai_nudge_events_form_idx').on(t.formType, t.formId),
  ]
);

/** Ephemeral AI-chat image staging (owner-scoped; not a public URL). */
export const aiChatStagedAttachments = pgTable(
  'ai_chat_staged_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    clientAttachmentId: text('client_attachment_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    scanStatus: text('scan_status').notNull().default('pending'),
    analysisStatus: text('analysis_status'),
    analysisResult: jsonb('analysis_result').$type<Record<string, unknown> | null>(),
    analysisCompletedAt: timestamp('analysis_completed_at', { withTimezone: true }),
    /** Set when the person pressed 確認並檢查; no AI analysis runs before this. */
    analysisStartedAt: timestamp('analysis_started_at', { withTimezone: true }),
    /** What the stored result was computed from: file content, company profile, rules. */
    analysisContentSha256: text('analysis_content_sha256'),
    analysisCompanyVersion: integer('analysis_company_version'),
    analysisRulesVersion: text('analysis_rules_version'),
    /** Current photo edit (ai_file_edit_versions); null = the original as uploaded. */
    activeEditId: uuid('active_edit_id'),
    /** Draft chosen at 確認並檢查. */
    targetDraftId: uuid('target_draft_id'),
    /** Set once sent to the model with a message: no longer a pending file of the composer. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('ai_chat_staged_attachments_client_uidx').on(t.ownerEmployeeId, t.clientAttachmentId),
    fk('ai_chat_staged_attachments_owner_fkey', t.ownerEmployeeId, employees.id),
    fk('ai_chat_staged_attachments_conversation_fkey', t.conversationId, aiConversations.id),
    check(
      'ai_chat_staged_attachments_mime_check',
      sql`mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf')`
    ),
    check(
      'ai_chat_staged_attachments_scan_check',
      sql`scan_status in ('pending', 'scanning', 'ready', 'failed', 'purged')`
    ),
    check(
      'ai_chat_staged_attachments_size_check',
      sql`file_size_bytes > 0 AND file_size_bytes <= 52428800`
    ),
    index('ai_chat_staged_attachments_conversation_idx').on(t.conversationId, t.createdAt),
  ]
);

/** User acknowledged invoice business reminders for a staged chat file (not a security bypass). */
export const stagedInvoiceConfirmations = pgTable(
  'staged_invoice_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stagedId: uuid('staged_id').notNull(),
    draftId: uuid('draft_id'),
    contentSha256: text('content_sha256').notNull(),
    reminderCode: text('reminder_code').notNull(),
    reminderSummary: text('reminder_summary').notNull(),
    userNote: text('user_note'),
    analysisSnapshot: jsonb('analysis_snapshot').$type<Record<string, unknown> | null>(),
    companyProfileVersion: integer('company_profile_version'),
    confirmedByEmployeeId: uuid('confirmed_by_employee_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('staged_invoice_confirmations_staged_fkey', t.stagedId, aiChatStagedAttachments.id).onDelete('cascade'),
    fk('staged_invoice_confirmations_by_fkey', t.confirmedByEmployeeId, employees.id),
    check(
      'staged_invoice_confirmations_reminder_check',
      sql`reminder_code in ('tax_id_mismatch', 'tax_id_missing', 'unclear', 'analysis_failed', 'not_invoice', 'company_unset', 'other')`
    ),
    index('staged_invoice_confirmations_staged_idx').on(t.stagedId, t.confirmedAt),
  ]
);

/** Immutable approved-form PDF snapshots for reuse as attachments on other forms. */
export const approvedDocumentSnapshots = pgTable(
  'approved_document_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceFormType: text('source_form_type').notNull(),
    sourceFormId: uuid('source_form_id').notNull(),
    sourceFormNumber: text('source_form_number').notNull(),
    sourceFormKey: text('source_form_key'),
    sourceVersion: integer('source_version').notNull(),
    approvalRoundKey: text('approval_round_key').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    contentHash: text('content_hash').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    generatedByEmployeeId: uuid('generated_by_employee_id').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('approved_document_snapshots_source_round_uidx').on(
      t.sourceFormType,
      t.sourceFormId,
      t.sourceVersion,
      t.approvalRoundKey
    ),
    fk('approved_document_snapshots_generated_by_fkey', t.generatedByEmployeeId, employees.id),
    check('approved_document_snapshots_hash_check', sql`char_length(content_hash) = 64`),
    check('approved_document_snapshots_size_check', sql`file_size_bytes > 0`),
    index('approved_document_snapshots_source_idx').on(t.sourceFormType, t.sourceFormId),
  ]
);

/** Links a draft to an approved PDF snapshot (idempotent per draft+snapshot). */
export const aiDraftSnapshotAttachments = pgTable(
  'ai_draft_snapshot_attachments',
  {
    draftId: uuid('draft_id').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    attachedByEmployeeId: uuid('attached_by_employee_id').notNull(),
    attachedAt: timestamp('attached_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'ai_draft_snapshot_attachments_pkey', columns: [t.draftId, t.snapshotId] }),
    fk('ai_draft_snapshot_attachments_draft_fkey', t.draftId, aiApplicationDrafts.id),
    fk('ai_draft_snapshot_attachments_snapshot_fkey', t.snapshotId, approvedDocumentSnapshots.id),
    fk('ai_draft_snapshot_attachments_by_fkey', t.attachedByEmployeeId, employees.id),
  ]
);

/** Chat-staged files copied onto a draft (durable until submit copies to form attachments). */
export const aiDraftFileAttachments = pgTable(
  'ai_draft_file_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    draftId: uuid('draft_id').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    storagePath: text('storage_path').notNull(),
    sha256: text('sha256').notNull(),
    sourceStagedId: uuid('source_staged_id'),
    /** Current photo edit; null = the original. The original row and bytes never change. */
    activeEditId: uuid('active_edit_id'),
    attachedByEmployeeId: uuid('attached_by_employee_id').notNull(),
    attachedAt: timestamp('attached_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('ai_draft_file_attachments_path_uidx').on(t.storagePath),
    fk('ai_draft_file_attachments_draft_fkey', t.draftId, aiApplicationDrafts.id).onDelete('cascade'),
    fk('ai_draft_file_attachments_by_fkey', t.attachedByEmployeeId, employees.id),
    check(
      'ai_draft_file_attachments_size_check',
      sql`file_size_bytes > 0 AND file_size_bytes <= 52428800`
    ),
    index('ai_draft_file_attachments_draft_idx').on(t.draftId, t.attachedAt),
  ]
);

// ---------------------------------------------------------------------------
// Company profile + attachment preview / analysis / upload sessions
// ---------------------------------------------------------------------------

export const companyProfiles = pgTable(
  'company_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    legalName: text('legal_name').notNull(),
    taxId: text('tax_id').notNull(),
    address: text('address'),
    nameAliases: jsonb('name_aliases').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedByEmployeeId: uuid('updated_by_employee_id'),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('company_profiles_code_uidx').on(t.code),
    check('company_profiles_tax_id_check', sql`char_length(btrim(tax_id)) BETWEEN 8 AND 10`),
    fk('company_profiles_updated_by_fkey', t.updatedByEmployeeId, employees.id),
  ]
);

export const attachmentDerivatives = pgTable(
  'attachment_derivatives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attachmentId: uuid('attachment_id').notNull(),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    storagePath: text('storage_path').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
    sourceSha256: text('source_sha256').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    width: integer('width'),
    height: integer('height'),
    status: text('status').notNull().default('ready'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('attachment_derivatives_path_uidx').on(t.storagePath),
    fk('attachment_derivatives_attachment_fkey', t.attachmentId, attachments.id).onDelete('cascade'),
    check('attachment_derivatives_kind_check', sql`kind in ('preview_image', 'preview_pdf', 'page_image', 'thumbnail')`),
    check('attachment_derivatives_status_check', sql`status in ('pending', 'ready', 'failed')`),
    index('attachment_derivatives_attachment_idx').on(t.attachmentId, t.kind),
  ]
);

export const attachmentAnalyses = pgTable(
  'attachment_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attachmentId: uuid('attachment_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    model: text('model'),
    rulesVersion: text('rules_version').notNull(),
    companyProfileId: uuid('company_profile_id'),
    companyProfileVersion: integer('company_profile_version'),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    error: text('error'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('attachment_analyses_attachment_fkey', t.attachmentId, attachments.id).onDelete('cascade'),
    fk('attachment_analyses_company_fkey', t.companyProfileId, companyProfiles.id),
    check('attachment_analyses_kind_check', sql`kind in ('invoice_check', 'document_type')`),
    check(
      'attachment_analyses_status_check',
      sql`status in ('pending', 'running', 'ready', 'failed', 'skipped')`
    ),
    index('attachment_analyses_attachment_idx').on(t.attachmentId, t.kind, t.createdAt),
  ]
);

export const attachmentConfirmations = pgTable(
  'attachment_confirmations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attachmentId: uuid('attachment_id').notNull(),
    draftId: uuid('draft_id'),
    formType: text('form_type'),
    formId: uuid('form_id'),
    analysisId: uuid('analysis_id'),
    contentSha256: text('content_sha256').notNull(),
    companyProfileVersion: integer('company_profile_version'),
    reminderCode: text('reminder_code').notNull(),
    reminderSummary: text('reminder_summary').notNull(),
    userNote: text('user_note'),
    corrections: jsonb('corrections').$type<Record<string, unknown> | null>(),
    confirmedByEmployeeId: uuid('confirmed_by_employee_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('attachment_confirmations_attachment_fkey', t.attachmentId, attachments.id).onDelete('cascade'),
    fk('attachment_confirmations_analysis_fkey', t.analysisId, attachmentAnalyses.id),
    fk('attachment_confirmations_by_fkey', t.confirmedByEmployeeId, employees.id),
    check(
      'attachment_confirmations_reminder_check',
      sql`reminder_code in ('tax_id_mismatch', 'tax_id_missing', 'unclear', 'analysis_failed', 'not_invoice', 'company_unset', 'other')`
    ),
    index('attachment_confirmations_attachment_idx').on(t.attachmentId),
  ]
);

export const attachmentUploadSessions = pgTable(
  'attachment_upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    purpose: text('purpose').notNull(),
    formType: text('form_type'),
    formId: uuid('form_id'),
    conversationId: uuid('conversation_id'),
    clientUploadId: text('client_upload_id').notNull(),
    fileName: text('file_name').notNull(),
    declaredMime: text('declared_mime'),
    declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }).notNull(),
    chunkSizeBytes: integer('chunk_size_bytes').notNull(),
    totalChunks: integer('total_chunks').notNull(),
    receivedChunks: integer('received_chunks').notNull().default(0),
    tempStoragePrefix: text('temp_storage_prefix').notNull(),
    status: text('status').notNull().default('receiving'),
    assembledSha256: text('assembled_sha256'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('attachment_upload_sessions_client_uidx').on(t.ownerEmployeeId, t.clientUploadId),
    fk('attachment_upload_sessions_owner_fkey', t.ownerEmployeeId, employees.id),
    check('attachment_upload_sessions_purpose_check', sql`purpose in ('form', 'ai_chat', 'draft')`),
    check(
      'attachment_upload_sessions_status_check',
      sql`status in ('receiving', 'assembling', 'ready', 'failed', 'expired', 'purged')`
    ),
    check(
      'attachment_upload_sessions_size_check',
      sql`declared_size_bytes > 0 AND chunk_size_bytes > 0 AND total_chunks > 0`
    ),
    index('attachment_upload_sessions_owner_idx').on(t.ownerEmployeeId, t.createdAt),
  ]
);

/**
 * Per-turn diagnostic trace of the AI assistant (one correlation id per user
 * turn): model rounds, tool calls and results, draft versions before/after,
 * and the UI events returned. Field values are only recorded outside
 * production when AI_TRACE_VALUES=1; tokens, credentials and file contents are
 * never stored.
 */
export const aiTurnTraces = pgTable(
  'ai_turn_traces',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    turnId: uuid('turn_id').notNull(),
    conversationId: uuid('conversation_id'),
    ownerEmployeeId: uuid('owner_employee_id'),
    seq: integer('seq').notNull(),
    stage: text('stage').notNull(),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('ai_turn_traces_owner_employee_id_fkey', t.ownerEmployeeId, employees.id),
    check('ai_turn_traces_stage_check', sql`char_length(stage) between 1 and 60`),
    uniqueIndex('ai_turn_traces_turn_seq_uidx').on(t.turnId, t.seq),
    index('ai_turn_traces_conversation_idx').on(t.conversationId, t.createdAt),
    index('ai_turn_traces_created_at_idx').on(t.createdAt),
  ]
);

/**
 * A draft continued in another conversation of the same owner (opened from the
 * draft library or a card there). The draft's own conversation_id stays its
 * origin; this link is what lets a later conversation read and update it.
 */
export const aiConversationDraftLinks = pgTable(
  'ai_conversation_draft_links',
  {
    conversationId: uuid('conversation_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'ai_conversation_draft_links_pkey', columns: [t.conversationId, t.draftId] }),
    fk('ai_conversation_draft_links_conversation_id_fkey', t.conversationId, aiConversations.id),
    fk('ai_conversation_draft_links_draft_id_fkey', t.draftId, aiApplicationDrafts.id),
    fk('ai_conversation_draft_links_owner_employee_id_fkey', t.ownerEmployeeId, employees.id),
    index('ai_conversation_draft_links_draft_idx').on(t.draftId),
  ]
);

/** Who may use a restricted project (projects.restricted); unrestricted projects ignore this table. */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'project_members_pkey', columns: [t.projectId, t.employeeId] }),
    fk('project_members_project_id_fkey', t.projectId, projects.id),
    fk('project_members_employee_id_fkey', t.employeeId, employees.id),
    index('project_members_employee_idx').on(t.employeeId),
  ]
);

/**
 * Saved versions of a photo edit. The original file is never touched: each
 * version keeps the operations plus two renders, `outputPath` (what people see,
 * with annotations) and `analysisPath` (crop and rotation only, no annotations,
 * so a note written on the photo is never read as evidence from the document).
 */
export const aiFileEditVersions = pgTable(
  'ai_file_edit_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerEmployeeId: uuid('owner_employee_id').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    version: integer('version').notNull(),
    operations: jsonb('operations').$type<Record<string, unknown>>().notNull(),
    outputPath: text('output_path').notNull(),
    outputSha256: text('output_sha256').notNull(),
    analysisPath: text('analysis_path').notNull(),
    analysisSha256: text('analysis_sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('ai_file_edit_versions_source_version_uidx').on(t.sourceKind, t.sourceId, t.version),
    fk('ai_file_edit_versions_owner_fkey', t.ownerEmployeeId, employees.id),
    check('ai_file_edit_versions_kind_check', sql`source_kind in ('staged', 'draft_file')`),
    index('ai_file_edit_versions_source_idx').on(t.sourceId),
  ]
);
