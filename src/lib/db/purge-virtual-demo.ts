import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

let purgePromise: Promise<void> | null = null;

const VIRTUAL_CASE_WHERE = `
  id::text LIKE '10000000-%'
  OR id::text LIKE '20000000-%'
  OR id::text LIKE '00000000-%'
  OR case_number LIKE 'DEMO-APPR-%'
  OR case_number LIKE 'HIST-BA-%'
  OR case_number LIKE 'CASE-BC%'
  OR case_number LIKE 'TD11511BT%'
  OR case_number LIKE 'CP11508%'
  OR case_number LIKE 'CP11510%'
  OR case_number LIKE 'CP1151101%'
  OR case_number IN (
    '20261117BT0001',
    '20261117PR0002',
    '20261117PO0003',
    '20261117AC0004',
    '20261117CS0006',
    '20261117AT0009'
  )
`;

/**
 * 清除資料庫中所有歷史遺留之虛擬人員（E001~E005 林小明、王主管、陳財會、李採購、吳總務等）
 * 與自動產生的虛擬／範例單據（財產清點單、待簽範例單、預算範例通知與草稿、範例資產、虛擬專案與虛擬廠商）。
 * 僅清理虛擬與範例資料，不影響未來真實建立之單據。
 */
export async function ensureVirtualAndDemoDataPurged(): Promise<void> {
  if (!purgePromise) {
    purgePromise = (async () => {
      const db = getDb();
      try {
        // 1. 清除虛擬人員或範例財產清點單與明細
        await db.execute(sql`
          DELETE FROM asset_inventory_lines
          WHERE batch_id IN (
            SELECT id FROM asset_inventory_batches
            WHERE id::text LIKE '10000000-%'
               OR id::text LIKE '20000000-%'
               OR label LIKE '%INV-20261114-%'
               OR source_sheet LIKE '%10000000-0000-0000-0000-%'
               OR source_sheet LIKE '%INV-20261114-%'
          )
          OR asset_id::text LIKE '00000000-%'
          OR asset_id::text LIKE '10000000-%'
          OR asset_tag IN (
            '10003','10004','10005','10006','10007','10008',
            'TD-IT-0054-01','TD-IT-0054-02','TD-LAB-0054-03','TD-EQ-0054-01','TD-EQ-0054-02',
            'TD-RD-0108-01','TD-SL-0021-01'
          )
        `);

        await db.execute(sql`
          DELETE FROM asset_inventory_batches
          WHERE id::text LIKE '10000000-%'
             OR id::text LIKE '20000000-%'
             OR label LIKE '%INV-20261114-%'
             OR source_sheet LIKE '%10000000-0000-0000-0000-%'
             OR source_sheet LIKE '%INV-20261114-%'
             OR NOT EXISTS (
               SELECT 1 FROM asset_inventory_lines l WHERE l.batch_id = asset_inventory_batches.id
             )
        `);

        // 2. 連動清除虛擬／範例案件之簽核關卡、表單與舊表資料
        await db.execute(
          sql.raw(`
            DELETE FROM approval_steps
            WHERE form_id IN (
              SELECT id FROM form_submissions
              WHERE procurement_case_id IN (SELECT id FROM procurement_cases WHERE ${VIRTUAL_CASE_WHERE})
            )
            OR form_id::text LIKE '10000000-%'
            OR form_id::text LIKE '20000000-%'
            OR form_id::text LIKE '00000000-%'
            OR approver_employee_id::text LIKE '10000000-%'
            OR approver_employee_id::text LIKE '20000000-%'
          `)
        );

        await db.execute(
          sql.raw(`
            UPDATE ai_application_drafts
            SET submission_id = NULL
            WHERE submission_id IN (
              SELECT id FROM form_submissions
              WHERE procurement_case_id IN (SELECT id FROM procurement_cases WHERE ${VIRTUAL_CASE_WHERE})
                 OR applicant_employee_id::text LIKE '10000000-%'
                 OR applicant_employee_id::text LIKE '20000000-%'
            )
          `)
        );

        await db.execute(
          sql.raw(`
            DELETE FROM form_submissions
            WHERE procurement_case_id IN (SELECT id FROM procurement_cases WHERE ${VIRTUAL_CASE_WHERE})
               OR applicant_employee_id::text LIKE '10000000-%'
               OR applicant_employee_id::text LIKE '20000000-%'
          `)
        );

        // 清除自動塞入之範例草稿
        await db.execute(sql`
          DELETE FROM form_drafts
          WHERE form_key = 'budget-request'
             OR owner_employee_id::text LIKE '10000000-%'
             OR owner_employee_id::text LIKE '20000000-%'
        `);

        // 清除舊式表單資料表中的虛擬案件紀錄與關聯簽核關卡（依外鍵相依順序由子表往父表刪除）
        const legacyTables = [
          'expense_requests',
          'acceptances',
          'purchase_orders',
          'purchase_requests',
          'travel_expenses',
          'department_expenses',
          'project_expenses',
          'revenue_expenses',
          'minor_expenses',
          'contract_seal_requests',
          'general_seal_requests',
          'invoice_seal_requests',
          'asset_transfers',
        ];
        for (const tbl of legacyTables) {
          await db.execute(
            sql.raw(`
              DELETE FROM approval_steps
              WHERE form_id IN (
                SELECT id FROM "${tbl}"
                WHERE procurement_case_id IN (SELECT id FROM procurement_cases WHERE ${VIRTUAL_CASE_WHERE})
              )
            `)
          );
          await db.execute(
            sql.raw(`
              DELETE FROM "${tbl}"
              WHERE procurement_case_id IN (SELECT id FROM procurement_cases WHERE ${VIRTUAL_CASE_WHERE})
            `)
          );
        }

        await db.execute(
          sql.raw(`
            DELETE FROM procurement_cases
            WHERE ${VIRTUAL_CASE_WHERE}
          `)
        );

        // 3. 清除虛擬／範例財產
        await db.execute(sql`
          DELETE FROM form_submission_asset_lines
          WHERE asset_id IN (
            SELECT id FROM assets
            WHERE id::text LIKE '00000000-%'
               OR id::text LIKE '10000000-%'
               OR tag LIKE 'TD-%'
               OR tag IN ('10003','10004','10005','10006','10007','10008')
          )
        `);

        await db.execute(sql`
          DELETE FROM assets
          WHERE (
               id::text LIKE '00000000-%'
            OR id::text LIKE '10000000-%'
            OR tag LIKE 'TD-%'
            OR tag IN ('10003','10004','10005','10006','10007','10008')
          )
          AND NOT EXISTS (
            SELECT 1 FROM form_submission_asset_lines l WHERE l.asset_id = assets.id
          )
        `);

        // 4. 清除虛擬／範例預算代碼、虛擬專案與虛擬供應商
        await db.execute(sql`
          DELETE FROM budget_codes
          WHERE id::text LIKE '10000000-%'
             OR created_at < '2026-11-20T00:00:00Z'
        `);

        await db.execute(sql`
          DELETE FROM project_members
          WHERE project_id IN (
            SELECT id FROM projects
            WHERE id::text LIKE '10000000-%'
               OR code IN ('T09', 'YW20', 'TD2601', 'RV2601')
          )
          OR employee_id::text LIKE '10000000-%'
          OR employee_id::text LIKE '20000000-%'
        `);

        await db.execute(sql`
          DELETE FROM projects
          WHERE id::text LIKE '10000000-%'
             OR code IN ('T09', 'YW20', 'TD2601', 'RV2601')
        `);

        await db.execute(sql`
          DELETE FROM suppliers
          WHERE id::text LIKE '10000000-%'
             OR name IN ('大誠科技股份有限公司', '台灣光電科技股份有限公司', '精密車電系統股份有限公司')
        `);

        // 5. 清除關聯虛擬／範例單據之系統通知（含已被刪除單據之孤兒通知）與 AI 事件確認
        await db.execute(sql`
          DELETE FROM notifications
          WHERE recipient_employee_id::text LIKE '10000000-%'
             OR recipient_employee_id::text LIKE '20000000-%'
             OR form_id::text LIKE '10000000-%'
             OR form_id::text LIKE '20000000-%'
             OR form_id::text LIKE '00000000-%'
             OR case_number LIKE 'INV-20261114-%'
             OR case_number LIKE 'BUDGET-116-%'
             OR case_number LIKE 'DEMO-APPR-%'
             OR case_number LIKE 'CP11508%'
             OR case_number LIKE 'CP11510%'
             OR case_number LIKE 'CP1151101%'
             OR case_number LIKE 'TD11511BT%'
             OR case_number LIKE '20261117%'
             OR message ~ '(林小明|王主管|陳財會|李採購|吳總務|張人資|E001|E002|E003|E004|E005)'
             OR (
               form_type = 'custom'
               AND NOT EXISTS (SELECT 1 FROM form_submissions fs WHERE fs.id = notifications.form_id)
             )
             OR (
               form_type = 'asset_inventory_handover'
               AND NOT EXISTS (SELECT 1 FROM asset_inventory_batches b WHERE b.id = notifications.form_id)
             )
             OR (
               form_type = 'general'
               AND NOT EXISTS (SELECT 1 FROM form_submissions fs WHERE fs.id = notifications.form_id)
             )
             OR created_at < '2026-11-20T00:00:00Z'
        `);

        await db.execute(sql`
          DELETE FROM ai_assistant_event_acks
          WHERE employee_id::text LIKE '10000000-%'
             OR employee_id::text LIKE '20000000-%'
             OR event_key LIKE '%00000000-0000-0000-0000-%'
             OR event_key LIKE '%10000000-0000-0000-0000-%'
             OR event_key LIKE '%20000000-0000-0000-0000-%'
        `);

        const summary = await db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM asset_inventory_batches) AS batches,
            (SELECT count(*)::int FROM asset_inventory_lines) AS lines,
            (SELECT count(*)::int FROM assets) AS assets,
            (SELECT count(*)::int FROM procurement_cases) AS cases,
            (SELECT count(*)::int FROM form_submissions) AS submissions,
            (SELECT count(*)::int FROM form_drafts) AS drafts,
            (SELECT count(*)::int FROM approval_steps) AS steps,
            (SELECT count(*)::int FROM budget_codes) AS budget_codes,
            (SELECT count(*)::int FROM notifications) AS notifications,
            (SELECT count(*)::int FROM projects) AS projects,
            (SELECT count(*)::int FROM suppliers) AS suppliers
        `);
        console.log('[ensureVirtualAndDemoDataPurged] completed cleanly:', summary[0]);
      } catch (err) {
        console.warn('[ensureVirtualAndDemoDataPurged] warning:', err);
        purgePromise = null;
      }
    })();
  }
  return purgePromise;
}
