create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table budget_codes add column project_id uuid references projects(id);

-- 為現有每個不重複的 project_code 建立一筆 projects 列，name 初始值等於 code
insert into projects (code, name)
select distinct project_code, project_code
from budget_codes
where project_code is not null;

update budget_codes bc
set project_id = p.id
from projects p
where bc.project_code = p.code;

alter table budget_codes drop constraint budget_codes_department_or_project_check;
alter table budget_codes drop column project_code;
alter table budget_codes add constraint budget_codes_department_or_project_check
  check ((department_id is not null) <> (project_id is not null));

-- 一次性修正現有匯入資料中的負數金額（純符號問題，非業務語意）
update budget_codes set annual_budget_amount = abs(annual_budget_amount) where annual_budget_amount < 0;
