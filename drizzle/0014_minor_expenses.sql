CREATE TABLE "minor_expense_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minor_expense_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate" numeric(12, 6) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"twd_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "minor_expense_items_minor_expense_id_line_no_key" UNIQUE("minor_expense_id","line_no"),
	CONSTRAINT "minor_expense_items_currency_check" CHECK (currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')),
	CONSTRAINT "minor_expense_items_amount_check" CHECK (amount > 0),
	CONSTRAINT "minor_expense_items_exchange_rate_check" CHECK (exchange_rate > 0),
	CONSTRAINT "minor_expense_items_twd_amount_check" CHECK (twd_amount > 0),
	CONSTRAINT "minor_expense_items_twd_rate_check" CHECK (currency <> 'TWD' or exchange_rate = 1)
);
--> statement-breakpoint
CREATE TABLE "minor_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_code_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"application_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"remark" text,
	"payee_type" text NOT NULL,
	"payee_supplier_id" uuid,
	"expected_payment_date" date NOT NULL,
	"payment_method" text NOT NULL,
	"remittance_info" text NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "minor_expenses_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "minor_expenses_version_check" CHECK (version > 0),
	CONSTRAINT "minor_expenses_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "minor_expenses_payee_type_check" CHECK (payee_type in ('applicant', 'supplier')),
	CONSTRAINT "minor_expenses_payee_supplier_check" CHECK ((payee_type = 'supplier') = (payee_supplier_id is not null)),
	CONSTRAINT "minor_expenses_payment_method_check" CHECK (payment_method in ('transfer', 'cash', 'check')),
	CONSTRAINT "minor_expenses_total_amount_check" CHECK (total_amount > 0)
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "minor_expense_items" ADD CONSTRAINT "minor_expense_items_minor_expense_id_fkey" FOREIGN KEY ("minor_expense_id") REFERENCES "public"."minor_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minor_expenses" ADD CONSTRAINT "minor_expenses_payee_supplier_id_fkey" FOREIGN KEY ("payee_supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "minor_expenses_applicant_employee_id_idx" ON "minor_expenses" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "minor_expenses_status_idx" ON "minor_expenses" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal', 'general_seal', 'invoice_seal', 'department_expense', 'project_expense', 'revenue_expense', 'minor_expense'));