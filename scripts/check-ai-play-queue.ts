/**
 * Diagnostic: who has pending custom approvals, and DEV001's mine/pending counts.
 *   npx tsx scripts/check-ai-play-queue.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { getSql } from '../src/lib/db';

async function main() {
  const sql = getSql();
  try {
    const pending = await sql`
      select e.employee_code as approver,
             d.key,
             s.form_number,
             appl.employee_code as applicant,
             a.step_order
      from approval_steps a
      join form_submissions s on s.id = a.form_id
      join form_definitions d on d.id = s.definition_id
      join employees e on e.id = a.approver_employee_id
      join employees appl on appl.id = s.applicant_employee_id
      where a.status = 'pending'
        and a.form_type = 'custom'
        and s.status = 'pending_approval'
        and s.current_step_order = a.step_order
      order by e.employee_code, d.key
    `;
    console.log('current_step_pending', pending.length);
    for (const r of pending) {
      console.log(`  ${r.approver} ← ${r.applicant}  ${r.form_number}  ${r.key}  step ${r.step_order}`);
    }

    const [dev] = await sql`select id, employee_code, name from employees where employee_code = 'DEV001' limit 1`;
    console.log('dev', dev ?? null);
    if (dev) {
      const mine = await sql`
        select d.key, s.form_number, s.status
        from form_submissions s
        join form_definitions d on d.id = s.definition_id
        where s.applicant_employee_id = ${dev.id}
          and s.status in ('pending_approval', 'returned')
        order by s.created_at desc
        limit 30
      `;
      console.log('DEV001_in_progress', mine.length);
      for (const r of mine) console.log(`  ${r.status.padEnd(18)} ${r.form_number}  ${r.key}`);
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
