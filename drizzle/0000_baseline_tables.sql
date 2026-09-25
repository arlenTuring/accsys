CREATE TABLE "acceptance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"purchase_order_item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"pass_fail" text DEFAULT 'pass' NOT NULL,
	"property_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptance_items_acceptance_id_line_no_key" UNIQUE("acceptance_id","line_no"),
	CONSTRAINT "acceptance_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "acceptance_items_amount_check" CHECK (amount > 0),
	CONSTRAINT "acceptance_items_pass_fail_check" CHECK (pass_fail in ('pass', 'fail'))
);
--> statement-breakpoint
CREATE TABLE "acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"contractor_supplier_id" uuid NOT NULL,
	"acceptance_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acceptances_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "acceptances_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"form_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"approver_employee_id" uuid NOT NULL,
	"approver_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"comment" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_steps_form_type_form_id_step_order_key" UNIQUE("form_type","form_id","step_order"),
	CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request')),
	CONSTRAINT "approval_steps_approver_role_check" CHECK (approver_role in ('department_manager', 'budget_owner', 'general_manager', 'chairman')),
	CONSTRAINT "approval_steps_status_check" CHECK (status in ('pending', 'approved', 'returned'))
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"form_id" uuid NOT NULL,
	"uploaded_by_employee_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_path_key" UNIQUE("storage_path"),
	CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request')),
	CONSTRAINT "attachments_file_size_bytes_check" CHECK (file_size_bytes > 0)
);
--> statement-breakpoint
CREATE TABLE "budget_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"department_id" uuid,
	"project_id" uuid,
	"category" text NOT NULL,
	"owner_employee_id" uuid,
	"fiscal_year" text NOT NULL,
	"annual_budget_amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_codes_code_key" UNIQUE("code"),
	CONSTRAINT "budget_codes_department_or_project_check" CHECK ((department_id is not null) <> (project_id is not null))
);
--> statement-breakpoint
CREATE TABLE "case_number_counters" (
	"year_month" text PRIMARY KEY NOT NULL,
	"last_serial" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"manager_employee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid NOT NULL,
	"title" text,
	"google_email" text,
	"role" text DEFAULT 'staff' NOT NULL,
	"is_general_manager" boolean DEFAULT false NOT NULL,
	"is_chairman" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_employee_code_key" UNIQUE("employee_code"),
	CONSTRAINT "employees_google_email_key" UNIQUE("google_email"),
	CONSTRAINT "employees_role_check" CHECK (role in ('staff', 'finance', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "expense_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"purchase_order_item_id" uuid,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_request_items_expense_request_id_line_no_key" UNIQUE("expense_request_id","line_no"),
	CONSTRAINT "expense_request_items_amount_check" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "expense_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"purchase_order_id" uuid,
	"budget_code_id" uuid,
	"acceptance_id" uuid,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"payee_type" text NOT NULL,
	"payee_supplier_id" uuid,
	"payment_method" text NOT NULL,
	"bank_name" text,
	"bank_account" text,
	"account_name" text,
	"invoice_month" text,
	"expected_payment_date" date,
	"payment_batch_date" date,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_requests_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "expense_requests_payee_type_check" CHECK (payee_type in ('employee', 'supplier')),
	CONSTRAINT "expense_requests_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "expense_requests_check" CHECK ((payee_type = 'supplier') = (payee_supplier_id is not null)),
	CONSTRAINT "expense_requests_po_xor_budget_code_check" CHECK ((purchase_order_id is not null) or (budget_code_id is not null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"form_type" text NOT NULL,
	"form_id" uuid NOT NULL,
	"case_number" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK (type in ('approval_requested', 'request_returned', 'request_approved'))
);
--> statement-breakpoint
CREATE TABLE "procurement_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"created_by_employee_id" uuid NOT NULL,
	"case_type" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_cases_case_number_key" UNIQUE("case_number"),
	CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"budget_code_id" uuid NOT NULL,
	"item_category" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"total_price" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_items_purchase_order_id_line_no_key" UNIQUE("purchase_order_id","line_no"),
	CONSTRAINT "purchase_order_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "purchase_order_items_unit_price_check" CHECK (unit_price > 0),
	CONSTRAINT "purchase_order_items_total_price_check" CHECK (total_price > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"payment_method" text NOT NULL,
	"payment_terms" text NOT NULL,
	"expected_delivery_days" integer,
	"quote_count" integer DEFAULT 1 NOT NULL,
	"quote_count_reason" text,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "purchase_orders_payment_terms_check" CHECK (payment_terms in ('預付款', '貨到付款', '月結30天', '月結45天', '月結60天', '其他')),
	CONSTRAINT "purchase_orders_quote_count_check" CHECK (quote_count >= 0),
	CONSTRAINT "purchase_orders_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "purchase_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"budget_code_id" uuid NOT NULL,
	"item_category" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"estimated_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_request_items_purchase_request_id_line_no_key" UNIQUE("purchase_request_id","line_no"),
	CONSTRAINT "purchase_request_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "purchase_request_items_estimated_amount_check" CHECK (estimated_amount > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"request_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"needed_within_days" integer,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"tax_id" text,
	"country" text,
	"registered_address" text,
	"mailing_address" text,
	"phone" text,
	"contact_name" text,
	"contact_department" text,
	"contact_phone" text,
	"contact_mobile" text,
	"email" text,
	"bank_name" text,
	"bank_branch" text,
	"bank_account" text,
	"account_name" text,
	"currency" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "acceptance_items" ADD CONSTRAINT "acceptance_items_acceptance_id_fkey" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_items" ADD CONSTRAINT "acceptance_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptances" ADD CONSTRAINT "acceptances_contractor_supplier_id_fkey" FOREIGN KEY ("contractor_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_employee_id_fkey" FOREIGN KEY ("approver_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_employee_id_fkey" FOREIGN KEY ("uploaded_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_codes" ADD CONSTRAINT "budget_codes_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_fk" FOREIGN KEY ("manager_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request_items" ADD CONSTRAINT "expense_request_items_expense_request_id_fkey" FOREIGN KEY ("expense_request_id") REFERENCES "public"."expense_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_request_items" ADD CONSTRAINT "expense_request_items_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_acceptance_id_fkey" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_requests" ADD CONSTRAINT "expense_requests_payee_supplier_id_fkey" FOREIGN KEY ("payee_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_employee_id_fkey" FOREIGN KEY ("recipient_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_created_by_employee_id_fkey" FOREIGN KEY ("created_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_purchase_request_id_fkey" FOREIGN KEY ("purchase_request_id") REFERENCES "public"."purchase_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_items" ADD CONSTRAINT "purchase_request_items_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acceptances_applicant_employee_id_idx" ON "acceptances" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "acceptances_status_idx" ON "acceptances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approval_steps_form_type_form_id_idx" ON "approval_steps" USING btree ("form_type","form_id");--> statement-breakpoint
CREATE INDEX "approval_steps_approver_employee_id_status_idx" ON "approval_steps" USING btree ("approver_employee_id","status");--> statement-breakpoint
CREATE INDEX "attachments_form_type_form_id_idx" ON "attachments" USING btree ("form_type","form_id");--> statement-breakpoint
CREATE INDEX "expense_requests_applicant_employee_id_idx" ON "expense_requests" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "expense_requests_status_idx" ON "expense_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_recipient_employee_id_is_read_idx" ON "notifications" USING btree ("recipient_employee_id","is_read");--> statement-breakpoint
CREATE INDEX "purchase_orders_applicant_employee_id_idx" ON "purchase_orders" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "purchase_requests_applicant_employee_id_idx" ON "purchase_requests" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "purchase_requests_status_idx" ON "purchase_requests" USING btree ("status");