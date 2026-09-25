import {
  boolean,
  bigint,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  managerEmployeeId: uuid('manager_employee_id'),
  ...timestamps,
});

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeCode: text('employee_code').notNull().unique(),
  name: text('name').notNull(),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id),
  title: text('title'),
  googleEmail: text('google_email').unique(),
  role: text('role').notNull().default('staff'),
  isGeneralManager: boolean('is_general_manager').notNull().default(false),
  isChairman: boolean('is_chairman').notNull().default(false),
  ...timestamps,
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  ...timestamps,
});

export const budgetCodes = pgTable('budget_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  departmentId: uuid('department_id').references(() => departments.id),
  projectId: uuid('project_id').references(() => projects.id),
  category: text('category').notNull(),
  ownerEmployeeId: uuid('owner_employee_id').references(() => employees.id),
  fiscalYear: text('fiscal_year').notNull(),
  annualBudgetAmount: numeric('annual_budget_amount', { precision: 14, scale: 2 }),
  ...timestamps,
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
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
  ...timestamps,
});

export const procurementCases = pgTable('procurement_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseNumber: text('case_number').notNull().unique(),
  createdByEmployeeId: uuid('created_by_employee_id')
    .notNull()
    .references(() => employees.id),
  caseType: text('case_type').notNull().default('standard'),
  ...timestamps,
});

export const caseNumberCounters = pgTable('case_number_counters', {
  yearMonth: text('year_month').primaryKey(),
  lastSerial: integer('last_serial').notNull().default(0),
});

export const purchaseRequests = pgTable('purchase_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  procurementCaseId: uuid('procurement_case_id')
    .notNull()
    .references(() => procurementCases.id),
  applicantEmployeeId: uuid('applicant_employee_id')
    .notNull()
    .references(() => employees.id),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id),
  budgetOwnerEmployeeId: uuid('budget_owner_employee_id')
    .notNull()
    .references(() => employees.id),
  requestDate: date('request_date').notNull(),
  neededWithinDays: integer('needed_within_days'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('pending_approval'),
  currentStepOrder: integer('current_step_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseRequestItems = pgTable(
  'purchase_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseRequestId: uuid('purchase_request_id')
      .notNull()
      .references(() => purchaseRequests.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    budgetCodeId: uuid('budget_code_id')
      .notNull()
      .references(() => budgetCodes.id),
    itemCategory: text('item_category').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    estimatedAmount: numeric('estimated_amount', { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.purchaseRequestId, t.lineNo)]
);

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  procurementCaseId: uuid('procurement_case_id')
    .notNull()
    .references(() => procurementCases.id)
    .unique(),
  purchaseRequestId: uuid('purchase_request_id')
    .notNull()
    .references(() => purchaseRequests.id),
  applicantEmployeeId: uuid('applicant_employee_id')
    .notNull()
    .references(() => employees.id),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id),
  budgetOwnerEmployeeId: uuid('budget_owner_employee_id')
    .notNull()
    .references(() => employees.id),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  paymentMethod: text('payment_method').notNull(),
  paymentTerms: text('payment_terms').notNull(),
  expectedDeliveryDays: integer('expected_delivery_days'),
  quoteCount: integer('quote_count').notNull().default(1),
  quoteCountReason: text('quote_count_reason'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('pending_approval'),
  currentStepOrder: integer('current_step_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable(
  'purchase_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    budgetCodeId: uuid('budget_code_id')
      .notNull()
      .references(() => budgetCodes.id),
    itemCategory: text('item_category').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    totalPrice: numeric('total_price', { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.purchaseOrderId, t.lineNo)]
);

export const acceptances = pgTable('acceptances', {
  id: uuid('id').primaryKey().defaultRandom(),
  procurementCaseId: uuid('procurement_case_id')
    .notNull()
    .references(() => procurementCases.id)
    .unique(),
  purchaseOrderId: uuid('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id),
  applicantEmployeeId: uuid('applicant_employee_id')
    .notNull()
    .references(() => employees.id),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id),
  budgetOwnerEmployeeId: uuid('budget_owner_employee_id')
    .notNull()
    .references(() => employees.id),
  contractorSupplierId: uuid('contractor_supplier_id')
    .notNull()
    .references(() => suppliers.id),
  acceptanceDate: date('acceptance_date').notNull(),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('pending_approval'),
  currentStepOrder: integer('current_step_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const acceptanceItems = pgTable(
  'acceptance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    acceptanceId: uuid('acceptance_id')
      .notNull()
      .references(() => acceptances.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    purchaseOrderItemId: uuid('purchase_order_item_id')
      .notNull()
      .references(() => purchaseOrderItems.id),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    passFail: text('pass_fail').notNull().default('pass'),
    propertyTag: text('property_tag'),
    ...timestamps,
  },
  (t) => [unique().on(t.acceptanceId, t.lineNo)]
);

export const expenseRequests = pgTable('expense_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  procurementCaseId: uuid('procurement_case_id')
    .notNull()
    .references(() => procurementCases.id)
    .unique(),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  budgetCodeId: uuid('budget_code_id').references(() => budgetCodes.id),
  acceptanceId: uuid('acceptance_id').references(() => acceptances.id),
  applicantEmployeeId: uuid('applicant_employee_id')
    .notNull()
    .references(() => employees.id),
  departmentId: uuid('department_id')
    .notNull()
    .references(() => departments.id),
  budgetOwnerEmployeeId: uuid('budget_owner_employee_id')
    .notNull()
    .references(() => employees.id),
  payeeType: text('payee_type').notNull(),
  payeeSupplierId: uuid('payee_supplier_id').references(() => suppliers.id),
  paymentMethod: text('payment_method').notNull(),
  bankName: text('bank_name'),
  bankAccount: text('bank_account'),
  accountName: text('account_name'),
  invoiceMonth: text('invoice_month'),
  expectedPaymentDate: date('expected_payment_date'),
  paymentBatchDate: date('payment_batch_date'),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  status: text('status').notNull().default('pending_approval'),
  currentStepOrder: integer('current_step_order'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const expenseRequestItems = pgTable(
  'expense_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expenseRequestId: uuid('expense_request_id')
      .notNull()
      .references(() => expenseRequests.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    purchaseOrderItemId: uuid('purchase_order_item_id').references(() => purchaseOrderItems.id),
    description: text('description').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.expenseRequestId, t.lineNo)]
);

export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formType: text('form_type').notNull(),
    formId: uuid('form_id').notNull(),
    stepOrder: integer('step_order').notNull(),
    approverEmployeeId: uuid('approver_employee_id')
      .notNull()
      .references(() => employees.id),
    approverRole: text('approver_role').notNull(),
    status: text('status').notNull().default('pending'),
    comment: text('comment'),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique().on(t.formType, t.formId, t.stepOrder)]
);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientEmployeeId: uuid('recipient_employee_id')
    .notNull()
    .references(() => employees.id),
  type: text('type').notNull(),
  formType: text('form_type').notNull(),
  formId: uuid('form_id').notNull(),
  caseNumber: text('case_number').notNull(),
  message: text('message').notNull(),
  isRead: boolean('is_read').notNull().default(false),
  ...timestamps,
});

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  formType: text('form_type').notNull(),
  formId: uuid('form_id').notNull(),
  uploadedByEmployeeId: uuid('uploaded_by_employee_id')
    .notNull()
    .references(() => employees.id),
  storagePath: text('storage_path').notNull().unique(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }).notNull(),
  ...timestamps,
});
