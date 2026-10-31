/**
 * 第 1 階段驗收：A1–A8，A1–A7 各三種說法，真實 Gemini（Vertex）＋拋棄式測試 DB。
 * 每一步在模型回覆後直接讀 DB 草稿判定，不看回覆文字判斷成功。
 *
 *   DATABASE_URL=postgres://accsys_app:accsys_app_test@127.0.0.1:25432/accsys_test \
 *     npx tsx scripts/ai-accept-s1.ts --out report.json [--only A1,A2] [--variants 1,2,3]
 *
 * 只讀 .env.local 的 AI_CHAT_*；DB 名稱不是 *_test 即拒絕。測試帳號 A（T-STAFF）。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createConversation } from '../src/lib/ai-chat/conversations';
import { runAssistantTurn } from '../src/lib/ai-chat/turn';
import { ROW_ID_KEY } from '../src/lib/ai-chat/draft-fill';
import { submitApplicationDraft } from '../src/lib/ai-chat/drafts';
import { runWithSessionToken, type CurrentEmployee } from '../src/lib/auth/current-employee';
import { createSession, resolveSession } from '../src/lib/auth/sessions';
import { getDb, getSql } from '../src/lib/db';
import { aiApplicationDrafts, aiTurnTraces } from '../src/lib/db/schema';

const A = '20000000-0000-0000-0000-000000000001';
const PRJ_A = '30000000-0000-0000-0000-00000000000a';

type Draft = { id: string; formKey: string; version: number; data: Record<string, unknown> };
type Row = Record<string, unknown>;
type Check = { ok: boolean; why: string };
type StepCtx = { drafts: Draft[]; before: Draft[]; reply: string; blocksText: string };
/** followUp: the user's answer when the assistant reasonably asks instead of acting (DB unchanged). */
type Step = { msg: string; fault?: boolean; followUp?: string; check: (c: StepCtx) => Check };
type Scenario = { id: string; variant: number; steps: Step[]; label: string[] };

const pass = (why = 'ok'): Check => ({ ok: true, why });
const fail = (why: string): Check => ({ ok: false, why });
const only = (drafts: Draft[], form: string) => drafts.filter((d) => d.formKey === form);
const rows = (d: Draft | undefined, table: string): Row[] => ((d?.data[table] as { rows?: Row[] } | undefined)?.rows ?? []);
const total = (d: Draft | undefined, table: string) => Number((d?.data[table] as { total?: unknown } | undefined)?.total ?? NaN);
const amount = (r: Row | undefined) => Number(r?.amount ?? NaN);
const isParking = (r: Row) => /停車/.test(String(r.summary ?? ''));
const isTransport = (r: Row) => !isParking(r) && /交通|高鐵|車資|計程|火車/.test(`${r.summary ?? ''}${r.category ?? ''}`);

function tripDraft(c: StepCtx): Draft | Check {
  const t = only(c.drafts, 'business-trip');
  if (t.length !== 1) return fail(`公出草稿數 ${t.length}（應為 1）`);
  return t[0];
}

const A1_TEXT = [
  '幫我建立 2026 年 11 月 4 日到台中拜訪客戶的公出申請，上午九點到下午六點，掛在測試專案 A，原因是設備驗收。',
  '11/4（三）要去台中客戶那邊做設備驗收，早上 9 點出發、傍晚 6 點結束，專案是測試專案 A，幫我開公出單。',
  '請幫我申請公出：日期 2026-11-04，時間 09:00 到 18:00，地點台中（拜訪客戶），事由設備驗收，專案 T-PRJ-A。',
];
const A2_TEXT = ['結束時間改晚上七點', '回程晚一點，改成 19:00 結束', '把出差結束時間調整為當天下午 7 點'];
const A3_TEXT = ['幫我開一張公出申請，11 月 6 日要去新竹', '下週五我要出差到新竹，先幫我建公出單', '建立公出申請，地點新竹，日期 2026/11/6，其他晚點再說'];
const A4_TEXT = [
  '幫我建立 11 月 10 日到高雄的公出申請，上午 9 點到下午 5 點，原因是客戶會議，掛在測試專案',
  '11/10 去高雄開客戶會議，9:00-17:00，專案是測試那個，幫我開公出單',
  '公出申請：2026-11-10 09:00 至 17:00，高雄，客戶會議，專案：測試',
];
const EXP_SETUP = '幫我開一張差旅報支單：出差 2026-11-04 到 2026-11-04，事由台中設備驗收。';
const A5_TEXT = ['新增交通費 300 元，再加停車費 120 元', '明細加兩筆：11/4 高鐵交通費 300、同一天停車費 120', '報支項目幫我記上交通費三百元和停車費一百二十元，日期都是 11/4'];
const A6_TEXT = ['把停車費改成 150 元', '停車費寫錯了，應該是 150', '停車那筆金額更正為一百五十元'];
const A7_TEXT = ['刪掉交通費', '交通費那筆不要了', '把交通費的明細移除'];

const checkA1: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  const x = d.data;
  const errs: string[] = [];
  if (x.tripStartAt !== '2026-11-04T09:00') errs.push(`tripStartAt=${String(x.tripStartAt)}`);
  if (x.tripEndAt !== '2026-11-04T18:00') errs.push(`tripEndAt=${String(x.tripEndAt)}`);
  if (!/台中/.test(String(x.location ?? ''))) errs.push(`location=${String(x.location)}`);
  if (!/設備驗收/.test(String(x.purpose ?? ''))) errs.push(`purpose=${String(x.purpose)}`);
  if (x.projectId !== PRJ_A) errs.push(`projectId=${String(x.projectId)}`);
  return errs.length ? fail(errs.join('；')) : pass();
};

const checkA2: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  const prev = only(c.before, 'business-trip')[0];
  if (!prev || prev.id !== d.id) return fail('不是同一張草稿');
  if (d.data.tripEndAt !== '2026-11-04T19:00') return fail(`tripEndAt=${String(d.data.tripEndAt)}`);
  const changed = Object.keys({ ...prev.data, ...d.data }).filter((k) => JSON.stringify(prev.data[k]) !== JSON.stringify(d.data[k]));
  return changed.length === 1 ? pass() : fail(`變更欄位 ${changed.join(',')}`);
};

const checkA3: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  const x = d.data;
  if (!/新竹/.test(String(x.location ?? ''))) return fail(`location=${String(x.location)}`);
  for (const k of ['tripStartAt', 'tripEndAt']) {
    const v = x[k];
    if (v !== undefined && v !== null && v !== '' && !String(v).startsWith('2026-11-06')) return fail(`${k}=${String(v)}（日期錯）`);
  }
  if (!/事由|目的|原因|時間|幾點/.test(c.reply)) return fail('沒有詢問缺少的事由或時間');
  return pass();
};

const checkA4: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  if (d.data.projectId) return fail(`擅自選了專案 ${String(d.data.projectId)}`);
  const shown = `${c.reply}\n${c.blocksText}`;
  if (!(/測試專案 ?A|T-PRJ-A/.test(shown) && /測試專案 ?B|T-PRJ-B/.test(shown))) return fail('沒有列出合法候選（A、B）');
  if (!/高雄/.test(String(d.data.location ?? ''))) return fail('其他已知資訊未保存');
  return pass();
};

const expDraft = (c: StepCtx): Draft | Check => {
  const t = only(c.drafts, 'travel-expense');
  return t.length === 1 ? t[0] : fail(`報支草稿數 ${t.length}`);
};

const checkSetup: Step['check'] = (c) => {
  const d = expDraft(c);
  return 'ok' in d ? d : pass();
};

const checkA5: Step['check'] = (c) => {
  const d = expDraft(c);
  if ('ok' in d) return d;
  const r = rows(d, 'costItems');
  const p = r.filter(isParking);
  const t = r.filter(isTransport);
  if (r.length !== 2 || p.length !== 1 || t.length !== 1) return fail(`明細 ${r.length} 列：${JSON.stringify(r.map((x) => [x.summary, x.amount]))}`);
  if (amount(t[0]) !== 300 || amount(p[0]) !== 120) return fail(`金額 ${amount(t[0])}/${amount(p[0])}`);
  return total(d, 'costItems') === 420 ? pass() : fail(`合計 ${total(d, 'costItems')}`);
};

const checkA6: Step['check'] = (c) => {
  const d = expDraft(c);
  if ('ok' in d) return d;
  const before = only(c.before, 'travel-expense')[0];
  const r = rows(d, 'costItems');
  const p = r.find(isParking);
  const t = r.find(isTransport);
  const pb = rows(before, 'costItems').find(isParking);
  const tb = rows(before, 'costItems').find(isTransport);
  if (r.length !== 2 || !p || !t) return fail(`明細 ${r.length} 列`);
  if (amount(p) !== 150) return fail(`停車費 ${amount(p)}`);
  if (JSON.stringify(t) !== JSON.stringify(tb)) return fail('交通費那列被改動');
  if (p[ROW_ID_KEY] !== pb?.[ROW_ID_KEY]) return fail('停車費列 ID 改變');
  return total(d, 'costItems') === 450 ? pass() : fail(`合計 ${total(d, 'costItems')}`);
};

const checkA7: Step['check'] = (c) => {
  const d = expDraft(c);
  if ('ok' in d) return d;
  const before = only(c.before, 'travel-expense')[0];
  const r = rows(d, 'costItems');
  const pb = rows(before, 'costItems').find(isParking);
  if (r.length !== 1 || !isParking(r[0])) return fail(`剩下 ${JSON.stringify(r.map((x) => x.summary))}`);
  if (JSON.stringify(r[0]) !== JSON.stringify(pb)) return fail('停車費列被改動');
  return total(d, 'costItems') === 150 ? pass() : fail(`合計 ${total(d, 'costItems')}`);
};

const checkA8: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  const prev = only(c.before, 'business-trip')[0];
  if (d.version !== prev.version || JSON.stringify(d.data) !== JSON.stringify(prev.data)) return fail('故障注入下 DB 仍被改動');
  const claimsDone = /已(更新|修改|改|儲存|寫入|填入)/.test(c.reply) && !/(失敗|未能|沒有|無法|未)(儲存|寫入|更新|成功|完成)/.test(c.reply);
  return claimsDone ? fail(`回覆宣稱成功：${c.reply.slice(0, 80)}`) : pass();
};

const checkA8Retry: Step['check'] = (c) => {
  const d = tripDraft(c);
  if ('ok' in d) return d;
  return /西屯/.test(String(d.data.location ?? '')) ? pass() : fail(`重試後 location=${String(d.data.location)}`);
};

function scenarios(variants: number[]): Scenario[] {
  const out: Scenario[] = [];
  for (const v of variants) {
    const i = v - 1;
    out.push({
      id: 'TRIP',
      variant: v,
      label: ['A1', 'A2', ...(v === 1 ? ['A8', 'A8-retry'] : [])],
      steps: [
        { msg: A1_TEXT[i], check: checkA1 },
        { msg: A2_TEXT[i], check: checkA2 },
        ...(v === 1
          ? [
              { msg: '地點改成台中市西屯區', fault: true, check: checkA8 },
              { msg: '剛剛沒存成功的話，再試一次', check: checkA8Retry },
            ]
          : []),
      ],
    });
    out.push({ id: 'PARTIAL', variant: v, label: ['A3'], steps: [{ msg: A3_TEXT[i], check: checkA3 }] });
    out.push({ id: 'AMBIG', variant: v, label: ['A4'], steps: [{ msg: A4_TEXT[i], check: checkA4 }] });
    out.push({
      id: 'EXPENSE',
      variant: v,
      label: ['setup', 'A5', 'A6', 'A7'],
      steps: [
        { msg: EXP_SETUP, check: checkSetup },
        { msg: A5_TEXT[i], check: checkA5 },
        { msg: A6_TEXT[i], check: checkA6 },
        { msg: A7_TEXT[i], followUp: '高鐵那筆交通費，停車費留著', check: checkA7 },
      ],
    });
  }
  return out;
}

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

async function draftsOf(conversationId: string): Promise<Draft[]> {
  const r = await getDb()
    .select({ id: aiApplicationDrafts.id, formKey: aiApplicationDrafts.formDefinitionKey, version: aiApplicationDrafts.version, data: aiApplicationDrafts.data })
    .from(aiApplicationDrafts)
    .where(and(eq(aiApplicationDrafts.conversationId, conversationId), eq(aiApplicationDrafts.status, 'draft')))
    .orderBy(asc(aiApplicationDrafts.createdAt));
  return r.map((x) => ({ ...x, data: (x.data ?? {}) as Record<string, unknown> }));
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.replace(/^\//, '').endsWith('_test')) throw new Error('DATABASE_URL must be a *_test database');
  loadAiSettingsOnly();
  process.env.APP_ORIGIN ??= 'http://localhost:3000';
  delete process.env.SMTP_HOST;

  const variants = (opt('--variants') ?? '1,2,3').split(',').map(Number);
  const onlyIds = opt('--only')?.split(',');
  // Test DB only: start each acceptance run with a fresh per-employee message budget
  // (the 40 / 10 min limit itself is unchanged and still enforced during the run).
  await getDb().execute(sql`delete from rate_limit_buckets where bucket_key = ${`ai-chat:msg:${A}`}`);
  const { token } = await createSession(getDb(), { employeeId: A, identityId: null, ttlMs: 3600_000 });
  const employee = (await resolveSession(token)) as CurrentEmployee;

  const results: Record<string, unknown>[] = [];
  for (const sc of scenarios(variants)) {
    if (onlyIds && !sc.label.some((l) => onlyIds.includes(l))) continue;
    const conversation = await createConversation(employee.id);
    for (const [n, step] of sc.steps.entries()) {
      const case_ = sc.label[n];
      const before = await draftsOf(conversation.id);
      const turns: { msg: string; fault: boolean }[] = [{ msg: step.msg, fault: Boolean(step.fault) }];
      let record: Record<string, unknown> = {};
      for (let t = 0; t < turns.length; t++) {
        const turnId = randomUUID();
        const started = Date.now();
        const result = await runWithSessionToken(token, () =>
          runAssistantTurn(employee, { message: turns[t].msg, clientMessageId: turnId, conversationId: conversation.id }, { fill: { failWrite: turns[t].fault } })
        );
        const drafts = await draftsOf(conversation.id);
        const reply = result.ok ? result.reply : `[error] ${result.error}`;
        const blocksText = result.ok ? JSON.stringify(result.blocks ?? []) : '';
        const verdict = step.check({ drafts, before, reply, blocksText });
        const trace = await getDb()
          .select({ seq: aiTurnTraces.seq, stage: aiTurnTraces.stage, data: aiTurnTraces.data })
          .from(aiTurnTraces)
          .where(eq(aiTurnTraces.turnId, turnId))
          .orderBy(asc(aiTurnTraces.seq));
        const calls = trace.filter((x) => x.stage === 'tool.call').map((x) => `r${(x.data as { round: number }).round}:${(x.data as { name: string }).name}`);
        const exhausted = trace.some((x) => x.stage === 'model.request' && (x.data as { mode?: string }).mode === 'NONE');
        const unchanged = JSON.stringify(drafts) === JSON.stringify(before);
        const tag = t > 0 ? '（追問後）' : '';
        console.log(`${verdict.ok ? 'PASS' : 'FAIL'} ${case_.padEnd(8)} v${sc.variant} ${String(Date.now() - started).padStart(6)}ms ${exhausted ? '[rounds-exhausted] ' : ''}${calls.join(' ')} | ${tag}${verdict.why}`);
        console.log(`     > ${turns[t].msg}\n     < ${reply.replace(/\n+/g, ' ').slice(0, 220)}`);
        record = {
          case: case_, variant: sc.variant, conversationId: conversation.id, turnId, message: turns[t].msg, askedFirst: t > 0,
          fault: turns[t].fault, ok: verdict.ok, why: verdict.why, reply, calls, exhausted,
          drafts: drafts.map((d) => ({ id: d.id, formKey: d.formKey, version: d.version, data: d.data })),
        };
        results.push(record);
        if (!verdict.ok && unchanged && step.followUp && t === 0) turns.push({ msg: step.followUp, fault: false });
      }
    }
  }
  // A case passes when its last turn passes (a reasonable question first is allowed).
  const finalOf = new Map<string, Record<string, unknown>>();
  for (const r of results) finalOf.set(`${String(r.case)}|${String(r.variant)}`, r);
  // Partial drafts (A3) are saved but the formal submit must refuse them.
  for (const r of [...finalOf.values()].filter((x) => x.case === 'A3')) {
    const draft = (r.drafts as Draft[]).find((d) => d.formKey === 'business-trip');
    if (!draft) continue;
    const sub = await runWithSessionToken(token, () =>
      submitApplicationDraft({ draftId: draft.id, ownerEmployeeId: A, expectedVersion: draft.version })
    );
    const refused = !sub.ok && sub.code === 'validation';
    console.log(`${refused ? 'PASS' : 'FAIL'} A3-submit v${String(r.variant)} 未完成草稿正式送出 → ${sub.ok ? '竟然成功' : `${sub.code}：${sub.error}`}`);
    results.push({ case: 'A3-submit', variant: r.variant, ok: refused, why: sub.ok ? 'submitted' : sub.code, draftId: draft.id });
    finalOf.set(`A3-submit|${String(r.variant)}`, results[results.length - 1]);
  }
  const finals = [...finalOf.values()].filter((r) => r.case !== 'setup');
  const failed = finals.filter((r) => !r.ok);
  console.log(`\n${finals.length - failed.length}/${finals.length} cases passed (${results.length} turns)`);
  const out = opt('--out');
  if (out) writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), results }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  })
  .finally(() => getSql().end());
