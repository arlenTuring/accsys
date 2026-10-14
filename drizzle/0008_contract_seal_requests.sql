CREATE TABLE "contract_seal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"procurement_case_id" uuid NOT NULL,
	"applicant_employee_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"application_date" date DEFAULT (now() at time zone 'Asia/Taipei')::date NOT NULL,
	"urgency" text NOT NULL,
	"expected_completion_date" date NOT NULL,
	"remark" text NOT NULL,
	"document_type" text NOT NULL,
	"seals" text[] NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"counterparty" text NOT NULL,
	"subject" text NOT NULL,
	"nda_checks" text[] NOT NULL,
	"mou_checks" text[] NOT NULL,
	"legal_review_confirmed" boolean DEFAULT false NOT NULL,
	"lend_seal" boolean DEFAULT false NOT NULL,
	"lend_seal_note" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"current_step_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_seal_requests_procurement_case_id_key" UNIQUE("procurement_case_id"),
	CONSTRAINT "contract_seal_requests_version_check" CHECK (version > 0),
	CONSTRAINT "contract_seal_requests_status_check" CHECK (status in ('pending_approval', 'approved', 'returned', 'withdrawn')),
	CONSTRAINT "contract_seal_requests_urgency_check" CHECK (urgency in ('normal', 'urgent')),
	CONSTRAINT "contract_seal_requests_document_type_check" CHECK (document_type in ('contract', 'agreement', 'nda', 'loi', 'mou')),
	CONSTRAINT "contract_seal_requests_seals_check" CHECK (cardinality(seals) > 0 and seals <@ array['perforation', 'contract_seal', 'signature', 'invoice_seal', 'e_signature', 'registration_seal', 'bank_seal']::text[]),
	CONSTRAINT "contract_seal_requests_nda_checks_check" CHECK (cardinality(nda_checks) > 0 and nda_checks <@ array['mutual', 'ip_retained', 'penalty_reviewed', 'not_applicable']::text[]),
	CONSTRAINT "contract_seal_requests_mou_checks_check" CHECK (cardinality(mou_checks) > 0 and mou_checks <@ array['non_binding', 'amount_range', 'not_applicable']::text[]),
	CONSTRAINT "contract_seal_requests_period_check" CHECK (period_end >= period_start),
	CONSTRAINT "contract_seal_requests_expected_date_check" CHECK (expected_completion_date >= application_date),
	CONSTRAINT "contract_seal_requests_total_amount_check" CHECK (total_amount >= 0)
);
--> statement-breakpoint
ALTER TABLE "approval_steps" DROP CONSTRAINT "approval_steps_form_type_check";--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_form_type_check";--> statement-breakpoint
ALTER TABLE "procurement_cases" DROP CONSTRAINT "procurement_cases_case_type_check";--> statement-breakpoint
ALTER TABLE "contract_seal_requests" ADD CONSTRAINT "contract_seal_requests_procurement_case_id_fkey" FOREIGN KEY ("procurement_case_id") REFERENCES "public"."procurement_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_seal_requests" ADD CONSTRAINT "contract_seal_requests_applicant_employee_id_fkey" FOREIGN KEY ("applicant_employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_seal_requests" ADD CONSTRAINT "contract_seal_requests_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_seal_requests_applicant_employee_id_idx" ON "contract_seal_requests" USING btree ("applicant_employee_id");--> statement-breakpoint
CREATE INDEX "contract_seal_requests_status_idx" ON "contract_seal_requests" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request'));--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_form_type_check" CHECK (form_type in ('purchase_request', 'purchase_order', 'acceptance', 'expense_request', 'travel_expense', 'contract_seal_request'));--> statement-breakpoint
ALTER TABLE "procurement_cases" ADD CONSTRAINT "procurement_cases_case_type_check" CHECK (case_type in ('standard', 'standalone_expense', 'travel_expense', 'contract_seal'));