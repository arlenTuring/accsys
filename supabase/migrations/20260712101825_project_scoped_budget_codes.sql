alter table budget_codes add column project_code text;
alter table budget_codes alter column department_id drop not null;
alter table budget_codes add constraint budget_codes_department_or_project_check
  check ((department_id is not null) <> (project_code is not null));
