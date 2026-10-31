import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAdminDatabaseUrl } from './test-database-url';

/**
 * create_idempotency_key uniqueness for AI application drafts (migration 0027).
 */

const adminUrl = (() => {
  const resolved = resolveAdminDatabaseUrl(process.env);
  return resolved.ok ? resolved.url : null;
})();

describe.skipIf(!adminUrl)('ai draft create idempotency', () => {
  let sql: ReturnType<typeof postgres>;
  let employeeId: string;
  let conversationId: string;
  let formKey: string | null = null;
  let formVersionId: string | null = null;

  beforeAll(async () => {
    sql = postgres(adminUrl!, { max: 1 });
    const tables = await sql`
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'ai_application_drafts'
         and column_name = 'create_idempotency_key' limit 1`;
    if (tables.length === 0) {
      formKey = null;
      return;
    }

    const [emp] = await sql`select id from employees limit 1`;
    employeeId = emp.id;
    const [conv] = await sql`
      insert into ai_conversations (owner_employee_id, title)
      values (${employeeId}::uuid, 'idem-test')
      returning id`;
    conversationId = conv.id;

    const [form] = await sql`
      select key, published_version_id
        from form_definitions
       where status = 'published' and published_version_id is not null
       limit 1`;
    if (form) {
      formKey = form.key;
      formVersionId = form.published_version_id;
    }
  });

  afterAll(async () => {
    if (conversationId) {
      await sql`delete from ai_application_drafts where conversation_id = ${conversationId}::uuid`;
      await sql`delete from ai_messages where conversation_id = ${conversationId}::uuid`;
      await sql`delete from ai_conversations where id = ${conversationId}::uuid`;
    }
    await sql.end({ timeout: 5 });
  });

  it('same create_idempotency_key cannot insert twice', async () => {
    if (!formKey || !formVersionId) return;
    const key = `idem-${randomUUID()}`;
    await sql`
      insert into ai_application_drafts
        (conversation_id, owner_employee_id, form_definition_key, form_version_id, title, create_idempotency_key)
      values
        (${conversationId}::uuid, ${employeeId}::uuid, ${formKey}, ${formVersionId}::uuid, 't1', ${key})`;

    let threw = false;
    try {
      await sql`
        insert into ai_application_drafts
          (conversation_id, owner_employee_id, form_definition_key, form_version_id, title, create_idempotency_key)
        values
          (${conversationId}::uuid, ${employeeId}::uuid, ${formKey}, ${formVersionId}::uuid, 't2', ${key})`;
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('different keys allow two drafts', async () => {
    if (!formKey || !formVersionId) return;
    const a = `idem-a-${randomUUID()}`;
    const b = `idem-b-${randomUUID()}`;
    const rows = await sql`
      insert into ai_application_drafts
        (conversation_id, owner_employee_id, form_definition_key, form_version_id, title, create_idempotency_key)
      values
        (${conversationId}::uuid, ${employeeId}::uuid, ${formKey}, ${formVersionId}::uuid, 'a', ${a}),
        (${conversationId}::uuid, ${employeeId}::uuid, ${formKey}, ${formVersionId}::uuid, 'b', ${b})
      returning id`;
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });
});
