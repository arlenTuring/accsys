/**
 * Promote listed Workspace emails to the built-in admin access role.
 * Also attaches a known email when the employee exists without google_email.
 * Usage: node --env-file=.env.local scripts/promote-admins.mjs
 */
import postgres from 'postgres';

const TARGETS = [
  { email: 'arlen@turing-drive.com' },
  { email: 'david_shen@turing-drive.com' },
  // Seed/import had 吳旭東 without google_email; bind the Workspace address here.
  { email: 'ivan_wu@turing-drive.com', employeeCode: '0065', nameHint: '吳旭東' },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const results = [];
  for (const t of TARGETS) {
    const email = t.email.toLowerCase();
    let rows = await sql`
      update employees
      set role = 'admin', access_enabled = true, disabled_reason = null,
          google_email = coalesce(google_email, ${email})
      where lower(coalesce(google_email, '')) = ${email}
      returning employee_code, name, google_email, role
    `;
    if (rows.length === 0 && t.employeeCode) {
      rows = await sql`
        update employees
        set role = 'admin', access_enabled = true, disabled_reason = null, google_email = ${email}
        where employee_code = ${t.employeeCode}
          and (google_email is null or lower(google_email) = ${email})
        returning employee_code, name, google_email, role
      `;
    }
    if (rows.length === 0) {
      console.warn(`not found: ${t.email}${t.employeeCode ? ` (code ${t.employeeCode})` : ''}`);
      process.exitCode = 2;
    } else {
      for (const r of rows) {
        console.log(`ok ${r.google_email} → ${r.role} (${r.name} / ${r.employee_code})`);
        results.push(r);
      }
    }
  }
  console.log(`done: ${results.length} admin(s)`);
} finally {
  await sql.end({ timeout: 5 });
}
