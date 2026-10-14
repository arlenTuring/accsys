CREATE TABLE "travel_expense_cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"travel_expense_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"expense_date" date NOT NULL,
	"category" text NOT NULL,
	"from_station" text,
	"to_station" text,
	"mileage" numeric(10, 1),
	"summary" text NOT NULL,
	"currency" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"exchange_rate" numeric(12, 6) NOT NULL,
	"twd_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_cost_items_travel_expense_id_line_no_key" UNIQUE("travel_expense_id","line_no"),
	CONSTRAINT "travel_expense_cost_items_category_check" CHECK (category in ('交通費', '住宿費', '膳雜費', '其他')),
	CONSTRAINT "travel_expense_cost_items_currency_check" CHECK (currency in ('TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'SGD', 'GBP')),
	CONSTRAINT "travel_expense_cost_items_amount_check" CHECK (amount > 0),
	CONSTRAINT "travel_expense_cost_items_exchange_rate_check" CHECK (exchange_rate > 0),
	CONSTRAINT "travel_expense_cost_items_twd_amount_check" CHECK (twd_amount > 0),
	CONSTRAINT "travel_expense_cost_items_mileage_check" CHECK (mileage is null or mileage >= 0),
	CONSTRAINT "travel_expense_cost_items_twd_rate_check" CHECK (currency <> 'TWD' or exchange_rate = 1)
);
--> statement-breakpoint
CREATE TABLE "travel_expense_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"travel_expense_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"trip_date" date NOT NULL,
	"location" text NOT NULL,
	"itinerary" text NOT NULL,
	"time_slot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_report_items_travel_expense_id_line_no_key" UNIQUE("travel_expense_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "travel_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"budget_code_id" uuid NOT NULL,
	"budget_owner_employee_id" uuid NOT NULL,
	"form_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"advance_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"trip_start_date" date NOT NULL,
	"trip_end_date" date NOT NULL,
	"purpose" text NOT NULL,
	"trip_order_no" text NOT NULL,
	"companions" text NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "travel_expenses_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "travel_expenses_version_check" CHECK (version > 0),
	CONSTRAINT "travel_expenses_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "travel_expenses_trip_dates_check" CHECK (trip_end_date >= trip_start_date),
	CONSTRAINT "travel_expenses_advance_amount_check" CHECK (advance_amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "travel_expense_cost_items" ADD CONSTRAINT "travel_expense_cost_items_travel_expense_id_fkey" FOREIGN KEY ("travel_expense_id") REFERENCES "public"."travel_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_items" ADD CONSTRAINT "travel_expense_report_items_travel_expense_id_fkey" FOREIGN KEY ("travel_expense_id") REFERENCES "public"."travel_expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_budget_code_id_fkey" FOREIGN KEY ("budget_code_id") REFERENCES "public"."budget_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_budget_owner_employee_id_fkey" FOREIGN KEY ("budget_owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travel_expenses_applicant_employee_id_idx" ON "travel_expenses" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "travel_expenses_status_idx" ON "travel_expenses" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense'));