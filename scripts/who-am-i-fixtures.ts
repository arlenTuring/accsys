/**
 * Find likely play accounts (recent AI chat owners / BT0017 applicant).
 *   npx tsx scripts/who-am-i-fixtures.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { getSql } from '../src/lib/db';

async function main() {
  const sql = getSql();
  try {
    const bt = await sql`
      select s.form_number, e.employee_code, e.name, e.id::text, e.google_email
      from form_submissions s
      join employees e on e.id = s.applicant_employee_id
      where s.form_number in ('20261028BT0017', '20261028BT0012')
    `;
    console.log('known_forms', bt);

    const chats = await sql`
      select e.employee_code, e.name, e.id::text, count(*)::int as chats, max(c.updated_at) as last_chat
      from ai_conversations c
      join employees e on e.id = c.owner_employee_id
      where c.archived_at is null
      group by e.employee_code, e.name, e.id
      order by last_chat desc nulls last
      limit 10
    `;
    console.log('active_chat_owners', chats);

    const sessions = await sql`
      select e.employee_code, e.name, e.id::text, max(s.created_at) as last_session
      from app_sessions s
      join employees e on e.id = s.employee_id
      where s.revoked_at is null and s.expires_at > now()
      group by e.employee_code, e.name, e.id
      order by last_session desc
      limit 10
    `;
    console.log('active_sessions', sessions);

    const code0054 = await sql`
      select employee_code, name, id::text, google_email, access_enabled
      from employees
      where employee_code = '0054' or employee_code ilike '%0054%'
      limit 5
    `;
    console.log('code_0054', code0054);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
