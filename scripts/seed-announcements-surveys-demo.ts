/**
 * Local demo: company announcements + surveys for UI / AI welcome smoke.
 * Safe to re-run (deletes prior rows by fixed IDs).
 *
 *   npx tsx scripts/seed-announcements-surveys-demo.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const dbHost = (() => {
  try {
    return new URL(DATABASE_URL).hostname;
  } catch {
    return '';
  }
})();
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(dbHost)) {
  console.error('seed only runs against a database on this machine (localhost / 127.0.0.1)');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

const ADMIN = '00000000-0000-0000-0000-000000000002';

const ANN = {
  newPin: 'a1000000-0000-4000-8000-000000000001',
  newUrgent: 'a1000000-0000-4000-8000-000000000002',
  oldRead: 'a1000000-0000-4000-8000-000000000003',
  oldDone: 'a1000000-0000-4000-8000-000000000004',
};

const SURVEY = {
  closed: 'b1000000-0000-4000-8000-000000000001',
  openNew: 'b1000000-0000-4000-8000-000000000002',
  openPartial: 'b1000000-0000-4000-8000-000000000003',
};

const Q = {
  closed1: 'b2000000-0000-4000-8000-000000000001',
  closed2: 'b2000000-0000-4000-8000-000000000002',
  open1: 'b2000000-0000-4000-8000-000000000011',
  open2: 'b2000000-0000-4000-8000-000000000012',
  open3: 'b2000000-0000-4000-8000-000000000013',
  partial1: 'b2000000-0000-4000-8000-000000000021',
};

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

async function main() {
  const employees = await sql<{ id: string; name: string }[]>`
    select id, name from employees where access_enabled = true order by employee_code
  `;
  if (employees.length === 0) {
    console.error('No active employees. Run local seed first (./scripts/start-dev.sh).');
    process.exit(1);
  }
  const adminExists = employees.some((e) => e.id === ADMIN);
  const actorId = adminExists ? ADMIN : employees[0]!.id;

  await sql.begin(async (tx) => {
    const surveyIds = [SURVEY.closed, SURVEY.openNew, SURVEY.openPartial];
    const annIds = [ANN.newPin, ANN.newUrgent, ANN.oldRead, ANN.oldDone];

    await tx`delete from company_survey_responses where survey_id = any(${surveyIds}::uuid[])`;
    await tx`delete from company_survey_question_media where survey_id = any(${surveyIds}::uuid[])`;
    await tx`delete from company_survey_questions where survey_id = any(${surveyIds}::uuid[])`;
    await tx`delete from company_surveys where id = any(${surveyIds}::uuid[])`;
    await tx`delete from company_announcement_reads where announcement_id = any(${annIds}::uuid[])`;
    await tx`delete from company_announcement_attachments where announcement_id = any(${annIds}::uuid[])`;
    await tx`delete from company_announcement_versions where announcement_id = any(${annIds}::uuid[])`;
    await tx`delete from company_announcements where id = any(${annIds}::uuid[])`;

    // —— Announcements ——
    // Fresh / unread for everyone
    await tx`
      insert into company_announcements (
        id, title, body, category, audience_type, status, priority, pinned, version,
        publish_at, published_at, created_by_employee_id, updated_by_employee_id
      ) values
      (
        ${ANN.newPin}::uuid,
        '【置頂】年終尾牙報名開跑',
        E'各位同仁好，\n\n本年度尾牙訂於 12/20（六）晚間於台北舉辦，請於本週五前至表單完成報名與素食／葷食回覆。\n\n攜眷名額有限，額滿為止。',
        'event', 'company', 'published', 'important', true, 1,
        ${hoursAgo(2)}, ${hoursAgo(2)}, ${actorId}::uuid, ${actorId}::uuid
      ),
      (
        ${ANN.newUrgent}::uuid,
        '資安提醒：近期釣魚郵件手法更新',
        E'資訊部提醒：\n\n近日出現仿冒「請款／簽核」主旨的釣魚信，請勿點擊不明連結或下載附件。\n若有疑慮請直接聯繫資訊部，勿自行回信給寄件者。',
        'security', 'company', 'published', 'urgent', false, 1,
        ${hoursAgo(5)}, ${hoursAgo(5)}, ${actorId}::uuid, ${actorId}::uuid
      ),
      (
        ${ANN.oldRead}::uuid,
        '十月團膳滿意度調查結果',
        E'感謝同仁回饋。十月團膳整體滿意度 4.2／5。供應商已依意見調整菜色輪替，十一月起生效。',
        'general', 'company', 'published', 'normal', false, 1,
        ${daysAgo(20)}, ${daysAgo(20)}, ${actorId}::uuid, ${actorId}::uuid
      ),
      (
        ${ANN.oldDone}::uuid,
        '辦公室空調歲修完成',
        E'3F／5F 空調歲修已於上週完工，如仍有異常請向總務報修。',
        'facility', 'company', 'published', 'normal', false, 1,
        ${daysAgo(35)}, ${daysAgo(35)}, ${actorId}::uuid, ${actorId}::uuid
      )
    `;

    // Mark older announcements as read by every active employee
    for (const emp of employees) {
      for (const annId of [ANN.oldRead, ANN.oldDone]) {
        await tx`
          insert into company_announcement_reads (announcement_id, employee_id, read_at, acknowledged_at)
          values (${annId}::uuid, ${emp.id}::uuid, ${daysAgo(18)}, ${daysAgo(18)})
          on conflict do nothing
        `;
      }
    }

    // —— Surveys ——
    const closedQs = [
      {
        id: Q.closed1,
        stableKey: 'q1',
        prompt: '整體而言，您對公司福利是否滿意？',
        type: 'single_choice',
        options: [
          { id: 'opt_1', label: '非常滿意' },
          { id: 'opt_2', label: '滿意' },
          { id: 'opt_3', label: '普通' },
          { id: 'opt_4', label: '不滿意' },
        ],
        sort: 0,
      },
      {
        id: Q.closed2,
        stableKey: 'q2',
        prompt: '最希望加強的福利項目是？',
        type: 'short_text',
        options: [] as Array<{ id: string; label: string }>,
        sort: 1,
      },
    ];

    const openQs = [
      {
        id: Q.open1,
        stableKey: 'q1',
        prompt: '您每週希望有幾天遠距上班？',
        type: 'single_choice',
        options: [
          { id: 'opt_1', label: '0 天（全到班）' },
          { id: 'opt_2', label: '1 天' },
          { id: 'opt_3', label: '2 天' },
          { id: 'opt_4', label: '3 天以上' },
        ],
        sort: 0,
      },
      {
        id: Q.open2,
        stableKey: 'q2',
        prompt: '遠距上班時最需要的支援是？',
        type: 'multi_choice',
        options: [
          { id: 'opt_1', label: '筆電／螢幕' },
          { id: 'opt_2', label: '網路補助' },
          { id: 'opt_3', label: '協作工具訓練' },
          { id: 'opt_4', label: '其他' },
        ],
        sort: 1,
      },
      {
        id: Q.open3,
        stableKey: 'q3',
        prompt: '其他建議',
        type: 'long_text',
        options: [] as Array<{ id: string; label: string }>,
        sort: 2,
        required: false,
      },
    ];

    const partialQs = [
      {
        id: Q.partial1,
        stableKey: 'q1',
        prompt: '本季內部活動您比較想參加哪一類？',
        type: 'single_choice',
        options: [
          { id: 'opt_1', label: '戶外健行' },
          { id: 'opt_2', label: '桌遊／室內' },
          { id: 'opt_3', label: '志工服務' },
          { id: 'opt_4', label: '講座分享' },
        ],
        sort: 0,
      },
    ];

    const closedSnapshot = closedQs.map((q) => ({
      id: q.id,
      stableKey: q.stableKey,
      prompt: q.prompt,
      help: '',
      questionType: q.type,
      required: true,
      sortOrder: q.sort,
      options: q.options,
      validation: {},
      media: [],
    }));
    const openSnapshot = openQs.map((q) => ({
      id: q.id,
      stableKey: q.stableKey,
      prompt: q.prompt,
      help: '',
      questionType: q.type,
      required: q.required === false ? false : true,
      sortOrder: q.sort,
      options: q.options,
      validation: {},
      media: [],
    }));
    const partialSnapshot = partialQs.map((q) => ({
      id: q.id,
      stableKey: q.stableKey,
      prompt: q.prompt,
      help: '',
      questionType: q.type,
      required: true,
      sortOrder: q.sort,
      options: q.options,
      validation: {},
      media: [],
    }));

    await tx`
      insert into company_surveys (
        id, title, description, status, audience_type, version,
        opens_at, closes_at, published_at, closed_at,
        published_question_snapshot,
        created_by_employee_id, updated_by_employee_id
      ) values
      (
        ${SURVEY.closed}::uuid,
        '2025 員工福利滿意度調查',
        '全公司已完成填寫的範例問卷（結果可於統計查看）。',
        'closed', 'company', 2,
        ${daysAgo(40)}, ${daysAgo(10)}, ${daysAgo(40)}, ${daysAgo(10)},
        ${sql.json(closedSnapshot)},
        ${actorId}::uuid, ${actorId}::uuid
      ),
      (
        ${SURVEY.openNew}::uuid,
        '遠距上班意願調查（新發布）',
        '剛開放填寫，請協助回覆，作為制度討論參考。',
        'open', 'company', 2,
        ${hoursAgo(3)}, ${daysAgo(-14)}, ${hoursAgo(3)}, null,
        ${sql.json(openSnapshot)},
        ${actorId}::uuid, ${actorId}::uuid
      ),
      (
        ${SURVEY.openPartial}::uuid,
        '本季同仁活動意向',
        '部分同仁已填；未填者請盡快完成。',
        'open', 'company', 2,
        ${daysAgo(5)}, ${daysAgo(-7)}, ${daysAgo(5)}, null,
        ${sql.json(partialSnapshot)},
        ${actorId}::uuid, ${actorId}::uuid
      )
    `;

    for (const q of closedQs) {
      await tx`
        insert into company_survey_questions (
          id, survey_id, stable_key, prompt, help, question_type, required, sort_order, options
        ) values (
          ${q.id}::uuid, ${SURVEY.closed}::uuid, ${q.stableKey}, ${q.prompt}, '', ${q.type}, true, ${q.sort},
          ${sql.json(q.options)}
        )
      `;
    }
    for (const q of openQs) {
      await tx`
        insert into company_survey_questions (
          id, survey_id, stable_key, prompt, help, question_type, required, sort_order, options
        ) values (
          ${q.id}::uuid, ${SURVEY.openNew}::uuid, ${q.stableKey}, ${q.prompt}, '', ${q.type},
          ${q.required === false ? false : true}, ${q.sort}, ${sql.json(q.options)}
        )
      `;
    }
    for (const q of partialQs) {
      await tx`
        insert into company_survey_questions (
          id, survey_id, stable_key, prompt, help, question_type, required, sort_order, options
        ) values (
          ${q.id}::uuid, ${SURVEY.openPartial}::uuid, ${q.stableKey}, ${q.prompt}, '', ${q.type}, true, ${q.sort},
          ${sql.json(q.options)}
        )
      `;
    }

    // Everyone finished the closed survey
    for (const emp of employees) {
      const answers = {
        q1: 'opt_2',
        q2: '希望增加健康檢查項目',
      };
      await tx`
        insert into company_survey_responses (
          survey_id, employee_id, status, answers, survey_version, submitted_at
        ) values (
          ${SURVEY.closed}::uuid, ${emp.id}::uuid, 'submitted', ${sql.json(answers)}, 2, ${daysAgo(12)}
        )
      `;
    }

    // Partial survey: first half of employees submitted (leave rest pending for AI notice)
    const half = Math.max(1, Math.floor(employees.length / 2));
    for (const emp of employees.slice(0, half)) {
      await tx`
        insert into company_survey_responses (
          survey_id, employee_id, status, answers, survey_version, submitted_at
        ) values (
          ${SURVEY.openPartial}::uuid, ${emp.id}::uuid, 'submitted',
          ${sql.json({ q1: 'opt_1' })}, 2, ${daysAgo(2)}
        )
      `;
    }
    // openNew: no responses → pending for all
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        employees: employees.length,
        announcements: {
          unread_for_all: ['年終尾牙報名開跑', '資安提醒：近期釣魚郵件手法更新'],
          already_read: ['十月團膳滿意度調查結果', '辦公室空調歲修完成'],
        },
        surveys: {
          closed_everyone_done: '2025 員工福利滿意度調查',
          open_new_pending_all: '遠距上班意願調查（新發布）',
          open_partial: '本季同仁活動意向',
        },
      },
      null,
      2
    )
  );
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await sql.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
