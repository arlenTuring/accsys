CREATE TABLE "invoice_seal_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_seal_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"currency" text NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_seal_request_items_invoice_seal_request_id_line_no_key" UNIQUE("invoice_seal_request_id","line_no"),
	CONSTRAINT "invoice_seal_request_items_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "invoice_seal_request_items_currency_check" CHECK (currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')),
	CONSTRAINT "invoice_seal_request_items_unit_price_check" CHECK (unit_price > 0),
	CONSTRAINT "invoice_seal_request_items_amount_check" CHECK (amount = unit_price * quantity)
);
--> statement-breakpoint
CREATE TABLE "invoice_seal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"application_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"invoice_type" text NOT NULL,
	"seal" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_tax_id" text NOT NULL,
	"customer_address" text NOT NULL,
	"customer_phone" text NOT NULL,
	"currency" text NOT NULL,
	"untaxed_total" numeric(14, 2) NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_seal_requests_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "invoice_seal_requests_version_check" CHECK (version > 0),
	CONSTRAINT "invoice_seal_requests_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "invoice_seal_requests_invoice_type_check" CHECK (invoice_type in ('triplicate', 'duplicate', 'e_invoice', 'export_invoice')),
	CONSTRAINT "invoice_seal_requests_seal_check" CHECK (seal in ('invoice_seal', 'contract_seal', 'signature')),
	CONSTRAINT "invoice_seal_requests_customer_tax_id_check" CHECK (customer_tax_id = '0' or customer_tax_id ~ '^[0-9]{8}$'),
	CONSTRAINT "invoice_seal_requests_triplicate_tax_id_check" CHECK (invoice_type <> 'triplicate' or customer_tax_id <> '0'),
	CONSTRAINT "invoice_seal_requests_currency_check" CHECK (currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')),
	CONSTRAINT "invoice_seal_requests_untaxed_total_check" CHECK (untaxed_total > 0),
	CONSTRAINT "invoice_seal_requests_total_amount_check" CHECK (total_amount >= untaxed_total)
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "invoice_seal_request_items" ADD CONSTRAINT "invoice_seal_request_items_invoice_seal_request_id_fkey" FOREIGN KEY ("invoice_seal_request_id") REFERENCES "public"."invoice_seal_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_seal_requests" ADD CONSTRAINT "invoice_seal_requests_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_seal_requests" ADD CONSTRAINT "invoice_seal_requests_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_seal_requests" ADD CONSTRAINT "invoice_seal_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_seal_requests_applicant_employee_id_idx" ON "invoice_seal_requests" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "invoice_seal_requests_status_idx" ON "invoice_seal_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request', 'general_seal_request', 'invoice_seal_request'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal', 'general_seal', 'invoice_seal'));