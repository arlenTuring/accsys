/**
 * Reproduce assistant turns end-to-end with the REAL model (Vertex Gemini)
 * against the disposable test database, through the same server code path as
 * the chat UI (runAssistantTurn). Prints, per turn: reply, tool calls/results,
 * draft versions, UI open events, and the database state afterwards.
 *
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *   AI_TRACE_VALUES=1 npx tsx scripts/ai-repro.ts --out /path/report.json \
 *     "第一句" ["第二句" ...]
 *
 * Only AI_CHAT_* settings are taken from .env.local (model project/region);
 * nothing else from that file is loaded, so the real DATABASE_URL is never used.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { asc, eq } from 'drizzle-orm';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { runWithSessionToken } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import { getDb, getSql } from '../src/lib/db';
import { aiApplicationDrafts, aiTurnTraces } from '../src/lib/db/schema';

const STAFF_ID = '20000000-0000-0000-0000-000000000001'; // T-STAFF (tests/integration/fixtures/base.sql)

function loadAiSettingsOnly() {
  let text = '';
  try {
    text = readFileSync('.env.local', 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^(AI_CHAT_[A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
  const employeeIdx = args.indexOf('--employee');
  const employeeId = employeeIdx >= 0 ? args.splice(employeeIdx, 2)[1] : STAFF_ID;
  const messages = args;
  if (messages.length === 0) throw new Error('usage: ai-repro.ts [--out file] "message" ["message" ...]');

  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;

  const { token } = await createSession(getDb(), { employeeId, identityId: null, ttlMs: 3600_000 });
  const employee = await resolveSession(token);
  if (!employee) throw new Error('test employee session not resolvable');
  const conversation = await createConversation(employee.id);

  const report: Record<string, unknown>[] = [];
  for (const message of messages) {
    const turnId = randomUUID();
    const started = Date.now();
    const result = await runWithSessionToken(token, () =>
      runAssistantTurn(employee, { message, clientMessageId: turnId, conversationId: conversation.id })
    );
    const ms = Date.now() - started;
    const trace = await getDb()
      .select({ seq: aiTurnTraces.seq, stage: aiTurnTraces.stage, data: aiTurnTraces.data })
      .from(aiTurnTraces)
      .where(eq(aiTurnTraces.turnId, turnId))
      .orderBy(asc(aiTurnTraces.seq));
    const drafts = await getDb()
      .select({
        id: aiApplicationDrafts.id,
        formKey: aiApplicationDrafts.formDefinitionKey,
        version: aiApplicationDrafts.version,
        status: aiApplicationDrafts.status,
        data: aiApplicationDrafts.data,
      })
      .from(aiApplicationDrafts)
      .where(eq(aiApplicationDrafts.conversationId, conversation.id));
    const turn = { turnId, message, ms, result, trace, dbDraftsAfter: drafts };
    report.push(turn);

    console.log(`\n=== turn ${turnId} (${ms} ms) ===\n> ${message}`);
    console.log(`reply ok=${result.ok}: ${result.ok ? result.reply : result.error}`);
    for (const t of trace) {
      const d = t.data as Record<string, unknown>;
      if (t.stage === 'model.response') console.log(`  [model r${d.round}] calls=${JSON.stringify(d.functionCalls)} dropped=${JSON.stringify(d.droppedCalls)} finish=${d.finishReason}`);
      if (t.stage === 'model.request' && d.mode === 'NONE') console.log(`  [model] forced text: ${d.reason}`);
      if (t.stage === 'tool.call') console.log(`  [tool] ${d.name} ${JSON.stringify(d.args).slice(0, 400)}`);
      if (t.stage === 'tool.result') console.log(`  [tool] -> ok=${d.ok} err=${d.error} draft=${d.draftId} v${d.expectedVersion}->${d.versionAfter} keys=${JSON.stringify(d.patchedKeys)} ${d.message ?? ''}`);
      if (t.stage === 'turn.ui_events') console.log(`  [ui] ${JSON.stringify(d)}`);
      if (t.stage === 'turn.error') console.log(`  [error] ${JSON.stringify(d)}`);
    }
    console.log(`  [db] ${JSON.stringify(drafts.map((x) => ({ id: x.id, form: x.formKey, v: x.version, data: x.data })))}`);
  }
  if (out) writeFileSync(out, JSON.stringify({ conversationId: conversation.id, employeeId, report }, null, 2));
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
