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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Source of truth for the database structure. Changes go through
// `npm run db:generate` (versioned SQL in drizzle/) and are reviewed before
// `npm run db:migrate`. Constraint and index names match PostgreSQL's default
// names from the original db/schema.sql so existing databases can be adopted
// by the baseline without renaming anything.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const taipeiToday = sql`(now() at time zone 'Asia/Taipei')::date`;

const FORM_TYPES = sql`form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request')`;
const FORM_STATUS = sql`status in ('pending_approval', 'approved', 'returned', 'withdrawn')`;

function fk(name: string, column: AnyPgColumn, target: AnyPgColumn) {
  return foreignKey({ name, columns: [column], foreignColumns: [target] });
}

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique('departments_code_key'),
    name: text('name').notNull(),
    managerEmployeeId: uuid('manager_employee_id'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [fk('departments_manager_fk', t.managerEmployeeId, employees.id)]
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
    role: text('role').notNull().default('staff'),
    isGeneralManager: boolean('is_general_manager').notNull().default(false),
    isChairman: boolean('is_chairman').notNull().default(false),
    createdAt: createdAt(),
    // Local access switch. Disabling keeps the employee row (and every form
    // that references it); sessions are revoked separately.
    accessEnabled: boolean('access_enabled').notNull().default(true),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    disabledReason: text('disabled_reason'),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('employees_department_id_fkey', t.departmentId, departments.id),
    check('employees_role_check', sql`role in ('staff', 'finance', 'admin')`),
    check('employees_access_state_check', sql`access_enabled = (disabled_at is null)`),
  ]
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique('projects_code_key'),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

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
    check('procurement_cases_case_type_check', sql`case_type in ('standard', 'standalone_expense')`),
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
  },
  (t): PgTableExtraConfigValue[] => [
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
  },
  (t): PgTableExtraConfigValue[] => [
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
  },
  (t): PgTableExtraConfigValue[] => [
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
  },
  (t): PgTableExtraConfigValue[] => [
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
// Approval, notifications, attachments
// ---------------------------------------------------------------------------

export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    stepOrder: integer('step_order').notNull(),
    approverEmployeeId: uuid('approver_employee_id').notNull(),
    approverRole: text('approver_role').notNull(),
    status: text('status').notNull().default('pending'),
    comment: text('comment'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    fk('approval_steps_approver_employee_id_fkey', t.approverEmployeeId, employees.id),
    check('approval_steps_form_type_check', FORM_TYPES),
    check(
      'approval_steps_approver_role_check',
      sql`approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman')`
    ),
    check('approval_steps_status_check', sql`status in ('pending', 'approved', 'returned')`),
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
  },
  (t): PgTableExtraConfigValue[] => [
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
  },
  (t): PgTableExtraConfigValue[] => [
    fk('attachments_uploaded_by_employee_id_fkey', t.uploadedByEmployeeId, employees.id),
    check('attachments_form_type_check', FORM_TYPES),
    check('attachments_file_size_bytes_check', sql`file_size_bytes > 0`),
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
 * step (admin approval / bootstrap), not by matching emails.
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
