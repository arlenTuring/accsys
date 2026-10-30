import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const sql = postgres(url, { max: 1 });
  try {
    const cols = await sql`
      select column_name from information_schema.columns
       where table_name='ai_application_drafts'
         and column_name in ('title','create_idempotency_key')
       order by 1`;
    const idx = await sql`
      select indexname from pg_indexes
       where tablename in ('ai_application_drafts','ai_assistant_event_acks','ai_conversations')
       order by 1`;
    const ack = await sql`
      select 1 from information_schema.tables where table_name='ai_assistant_event_acks'`;
    console.log('cols', cols.map((r) => r.column_name));
    console.log(
      'indexes',
      idx.map((r) => r.indexname)
    );
    console.log('acks_table', ack.length > 0);

    const [emp] = await sql`select id from employees limit 1`;
    const [conv] = await sql`
      insert into ai_conversations (owner_employee_id, title)
      values (${emp.id}::uuid, 'idem-smoke')
      returning id`;
    const [form] = await sql`
      select key, published_version_id
        from form_definitions
       where status='published' and published_version_id is not null
       limit 1`;
    if (form) {
      const key = `smoke-${Date.now()}`;
      await sql`
        insert into ai_application_drafts
          (conversation_id, owner_employee_id, form_definition_key, form_version_id, title, create_idempotency_key)
        values
          (${conv.id}::uuid, ${emp.id}::uuid, ${form.key}, ${form.published_version_id}::uuid, 'a', ${key})`;
      let dup = false;
      try {
        await sql`
          insert into ai_application_drafts
            (conversation_id, owner_employee_id, form_definition_key, form_version_id, title, create_idempotency_key)
          values
            (${conv.id}::uuid, ${emp.id}::uuid, ${form.key}, ${form.published_version_id}::uuid, 'b', ${key})`;
      } catch {
        dup = true;
      }
      console.log('idempotent_reject', dup);
    } else {
      console.log('idempotent_reject', 'skipped_no_form');
    }
    await sql`delete from ai_application_drafts where conversation_id=${conv.id}::uuid`;
    await sql`delete from ai_conversations where id=${conv.id}::uuid`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
