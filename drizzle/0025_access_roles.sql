CREATE TABLE "access_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_roles_code_key" UNIQUE("code"),
	CONSTRAINT "access_roles_code_check" CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "access_roles_name_check" CHECK (char_length(btrim(name)) between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE "access_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "access_role_permissions_pkey" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "access_role_permissions_permission_check" CHECK (permission ~ '^[a-z][a-z0-9_.]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "access_role_permissions" ADD CONSTRAINT "access_role_permissions_role_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."access_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Built-in roles must exist before employees.role becomes a foreign key.
INSERT INTO "access_roles" ("code", "name", "description", "is_system", "active") VALUES
  ('staff', '一般員工', '可填寫與簽核自己相關的表單；沒有系統管理或財會選單。', true, true),
  ('finance', '財會', '可讀取所有單據、檢視敏感欄位，並使用財會管理功能。', true, true),
  ('admin', '系統管理員', '擁有全部權限；不可刪除或停用，權限固定為全部。', true, true);
--> statement-breakpoint
INSERT INTO "access_role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "access_roles" r
CROSS JOIN (VALUES
  ('forms.read_all'),
  ('forms.sensitive'),
  ('finance.budget'),
  ('finance.cases'),
  ('finance.assets')
) AS p(permission)
WHERE r.code = 'finance';
--> statement-breakpoint
INSERT INTO "access_role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "access_roles" r
CROSS JOIN (VALUES
  ('forms.read_all'),
  ('forms.sensitive'),
  ('finance.budget'),
  ('finance.cases'),
  ('finance.assets'),
  ('forms.design'),
  ('forms.delete'),
  ('org.manage'),
  ('org.directory'),
  ('org.access_roles'),
  ('accounts.manage'),
  ('master_data.manage')
) AS p(permission)
WHERE r.code = 'admin';
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_role_check";--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_access_role_fkey" FOREIGN KEY ("role") REFERENCES "public"."access_roles"("code") ON DELETE no action ON UPDATE no action;
