drop policy "participant_read_approval_steps" on approval_steps;

create policy "participant_read_approval_steps" on approval_steps
  for select using (
    approver_employee_id = current_employee_id()
    or is_finance()
    or is_admin()
    or (
      form_type = 'purchase_request'
      and (
        is_approver_of_request(form_id)
        or exists (
          select 1 from purchase_requests pr
          where pr.id = approval_steps.form_id
            and pr.applicant_employee_id = current_employee_id()
        )
      )
    )
  );
