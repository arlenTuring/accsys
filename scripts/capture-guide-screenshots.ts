import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { eq } from 'drizzle-orm';

dotenvConfig({ path: '.env.local' });

import { createSession } from '../src/lib/auth/sessions';
import { getDb } from '../src/lib/db';
import { employees } from '../src/lib/db/schema';

const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP_ORIGIN = 'http://localhost:3001';
const OUT_DIR = path.join(process.cwd(), 'public', 'guide', 'shots');

type ShotTask = {
  filename: string;
  url: string;
  stepBadge: number;
  calloutTitle: string;
  /** Optional JS to run in page before highlighting & capturing */
  prepareJs?: string;
  /** CSS selector(s) to try for placing the red highlight box; falls back to coordinates */
  targetSelector?: string;
  fallbackBox?: { x: number; y: number; w: number; h: number };
};

const TASKS: ShotTask[] = [
  // ==========================================
  // STAFF SCENARIO 1: 拍發票快速報帳 (AI 助手)
  // ==========================================
  {
    filename: 'staff-s1-step1.png',
    url: '/tools/ai-chat',
    stepBadge: 1,
    calloutTitle: '點左側「AI 助手」→ 點下方「＋」上傳發票照片或拖入檔案',
    prepareJs: `
      const ta = document.querySelector('textarea');
      if (ta) {
        ta.value = '幫我建立一張部門費用申請單，買研發測試線材 3,500 元';
      }
    `,
    targetSelector: 'form, textarea',
    fallbackBox: { x: 260, y: 630, w: 960, h: 110 },
  },
  {
    filename: 'staff-s1-step2.png',
    url: '/tools/ai-chat',
    stepBadge: 2,
    calloutTitle: 'AI 自動辨識發票品項金額，並檢核買方統編 50887923',
    prepareJs: `
      const mainArea = document.querySelector('main') || document.body;
      const overlay = document.createElement('div');
      overlay.id = '__guide_demo_overlay';
      overlay.style.cssText = 'position:fixed;left:280px;top:64px;right:24px;bottom:145px;background:#f8fafc;z-index:30;padding:24px 32px;overflow:hidden;display:flex;flex-direction:column;gap:16px;border-radius:12px;';
      overlay.innerHTML = \`
        <div style="align-self:flex-end;max-width:68%;background:#2563eb;color:#fff;padding:14px 18px;border-radius:16px 16px 4px 16px;box-shadow:0 2px 8px rgba(37,99,235,0.18);">
          <div style="display:inline-flex;align-items:center;gap:8px;background:rgba(255,255,255,0.18);padding:6px 12px;border-radius:8px;font-size:12.5px;font-weight:700;margin-bottom:8px;">
            📎 電子發票證明聯_20261120.jpg（已上傳）
          </div>
          <div style="font-size:14.5px;line-height:1.5;">幫我建立一張部門費用申請單，買研發測試線材 3,500 元，並把這張發票夾進去。</div>
        </div>
        <div id="__ai_ocr_reply_card" style="align-self:flex-start;max-width:82%;background:#ffffff;border:2px solid #93c5fd;padding:18px 22px;border-radius:16px 16px 16px 4px;box-shadow:0 4px 14px rgba(15,23,42,0.06);">
          <div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:10px;">🤖 AI 助手：已完成發票 OCR 辨識與公司統編檢核</div>
          <div style="background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:700;margin-bottom:12px;">
            ✅ 發票買方統一編號檢核通過：50887923（台灣智慧駕駛股份有限公司）
          </div>
          <div style="font-size:13.5px;color:#334155;line-height:1.7;">
            • <strong>辨識發票號碼</strong>：AB-11223344｜<strong>含稅總額</strong>：NT$ 3,500（未稅 3,333 / 稅額 167）<br/>
            • <strong>自動填入科目</strong>：115ADSSE15（自動駕駛系統部 - 雜項購置）｜品項：研發測試線材<br/>
            • <strong style="color:#1d4ed8;">已為您建立《費用申請單》草稿並夾帶發票影像，可於右側草稿面板確認送出！</strong>
          </div>
        </div>
      \`;
      mainArea.appendChild(overlay);
    `,
    targetSelector: '#__ai_ocr_reply_card',
    fallbackBox: { x: 300, y: 210, w: 760, h: 210 },
  },
  {
    filename: 'staff-s1-step3.png',
    url: '/tools/ai-chat',
    stepBadge: 3,
    calloutTitle: '於右側即時展開的《費用申請單》草稿面板確認明細，點「送出申請」',
    prepareJs: `
      const mainArea = document.querySelector('main') || document.body;
      const split = document.createElement('div');
      split.style.cssText = 'position:fixed;left:260px;top:56px;right:0;bottom:0;background:#f1f5f9;z-index:30;display:grid;grid-template-columns:1fr 540px;';
      split.innerHTML = \`
        <div style="padding:20px;display:flex;flex-direction:column;gap:14px;border-right:1px solid #cbd5e1;background:#f8fafc;">
          <div style="background:#2563eb;color:#fff;padding:12px 16px;border-radius:14px;font-size:13.5px;align-self:flex-end;max-width:85%;">
            📎 電子發票證明聯_20261120.jpg — 買研發測試線材 3,500 元
          </div>
          <div style="background:#fff;border:1px solid #cbd5e1;padding:14px 16px;border-radius:14px;font-size:13px;color:#1e293b;line-height:1.6;">
            <strong>AI 助手：</strong>已在右側為您開啟<strong>《費用申請單》草稿</strong>並填入發票明細與附件，請確認右側欄位後點擊「送出申請」。
          </div>
        </div>
        <div id="__right_draft_panel" style="background:#ffffff;padding:20px 24px;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:14px;">
              <div>
                <span style="background:#dbeafe;color:#1e40af;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;">即時表單草稿面板</span>
                <div style="font-size:17px;font-weight:800;color:#0f172a;margin-top:4px;">費用申請單（AI 自動帶入草稿）</div>
              </div>
              <span style="font-size:12px;color:#059669;font-weight:700;">● 已自動儲存</span>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">預算編號 *</div>
              <div style="border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-size:13px;background:#f8fafc;color:#0f172a;font-weight:600;">
                115ADSSE15 — 自動駕駛系統部 · 雜項購置（負責人：楊為任）
              </div>
            </div>
            <div style="margin-bottom:12px;">
              <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:4px;">費用明細（AI OCR 自動帶入）*</div>
              <table style="width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid #e2e8f0;">
                <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
                  <th style="padding:8px;">品項說明</th><th style="padding:8px;">發票號碼</th><th style="padding:8px;">未稅</th><th style="padding:8px;">稅額</th><th style="padding:8px;">含稅總額</th>
                </tr>
                <tr>
                  <td style="padding:8px;font-weight:600;">研發測試線材</td>
                  <td style="padding:8px;font-family:monospace;">AB-11223344</td>
                  <td style="padding:8px;">3,333</td>
                  <td style="padding:8px;">167</td>
                  <td style="padding:8px;font-weight:800;color:#047857;">NT$ 3,500</td>
                </tr>
              </table>
            </div>
            <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#065f46;font-weight:600;">
              📎 已夾帶發票附件：電子發票證明聯_20261120.jpg（買方統編 50887923 檢核通過）
            </div>
          </div>
          <div id="__draft_submit_bar" style="border-top:1px solid #e2e8f0;padding-top:14px;display:flex;justify-content:flex-end;gap:10px;">
            <button style="padding:10px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:13.5px;font-weight:700;color:#334155;">儲存草稿</button>
            <button style="padding:10px 22px;border-radius:8px;border:none;background:#2563eb;font-size:13.5px;font-weight:800;color:#fff;">確認無誤，送出申請 →</button>
          </div>
        </div>
      \`;
      mainArea.appendChild(split);
    `,
    targetSelector: '#__right_draft_panel',
    fallbackBox: { x: 740, y: 60, w: 530, h: 680 },
  },

  // ==========================================
  // STAFF SCENARIO 2: 請購・報支・出差・用印
  // ==========================================
  {
    filename: 'staff-s2-step1.png',
    url: '/forms',
    stepBadge: 1,
    calloutTitle: '點左側「簽核管理」或於「申請表單總覽」選擇要填寫的申請單',
    targetSelector: 'main',
    fallbackBox: { x: 270, y: 80, w: 970, h: 620 },
  },
  {
    filename: 'staff-s2-step2.png',
    url: '/f/purchase-request/new',
    stepBadge: 2,
    calloutTitle: '於明細列選擇同一位預算負責人的「預算編號」，並輸入說明、數量與單價',
    prepareJs: `
      const table = document.querySelector('table');
      if (table) table.scrollIntoView({ behavior: 'instant', block: 'center' });
    `,
    targetSelector: 'table',
    fallbackBox: { x: 290, y: 340, w: 940, h: 240 },
  },
  {
    filename: 'staff-s2-step3.png',
    url: '/f/purchase-request/new',
    stepBadge: 3,
    calloutTitle: '上傳報價單／憑證附件並檢視下方簽核關卡預覽，點右下角「送出申請」',
    prepareJs: `
      window.scrollTo(0, document.body.scrollHeight);
    `,
    fallbackBox: { x: 290, y: 460, w: 940, h: 260 },
  },

  // ==========================================
  // STAFF SCENARIO 3: 信件內簽核・待辦審核・退回重送
  // ==========================================
  {
    filename: 'staff-s3-step1.png',
    url: '/applications',
    stepBadge: 1,
    calloutTitle: 'Gmail 簽核通知信內直接檢視完整單據明細，點「準許簽核」或「簽核退回」',
    prepareJs: `
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:#e2e8f0;z-index:50;padding:24px 48px;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = \`
        <div style="width:100%;max-width:1040px;background:#ffffff;border-radius:14px;border:1px solid #cbd5e1;box-shadow:0 12px 32px rgba(15,23,42,0.12);overflow:hidden;font-family:sans-serif;">
          <div style="background:#1e40af;padding:16px 24px;color:#ffffff;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;opacity:0.9;">From: TURING DRIVE ACCSYS 系統通知 &lt;no-reply@turing-drive.com&gt;</div>
              <div style="font-size:18px;font-weight:800;margin-top:4px;">【待簽核】公出差旅申請單 20261120BT0001 — 阮振瑋 提出申請</div>
            </div>
            <span style="background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700;">Gmail 收件匣實況</span>
          </div>
          <div style="padding:20px 26px;font-size:13.5px;color:#1e293b;">
            <table style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:14px;">
              <tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 14px;color:#64748b;width:140px;font-weight:600;">單據類型 / 案號</td><td style="padding:8px 14px;font-weight:800;">公出差旅申請單 · 20261120BT0001</td><td style="padding:8px 14px;color:#64748b;width:120px;font-weight:600;">申請人員</td><td style="padding:8px 14px;">阮振瑋（自動駕駛系統部）</td></tr>
              <tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 14px;color:#64748b;font-weight:600;">出差時間 / 地點</td><td style="padding:8px 14px;">2026/11/21 08:30 ~ 18:30｜新竹竹北高鐵自駕測試場域</td><td style="padding:8px 14px;color:#64748b;font-weight:600;">預估總額</td><td style="padding:8px 14px;font-weight:800;color:#047857;">NT$ 3,600</td></tr>
              <tr><td style="padding:8px 14px;color:#64748b;font-weight:600;">出差事由與行程</td><td colspan="3" style="padding:8px 14px;">赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 號誌優先聯調</td></tr>
            </table>
            <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:16px;">
              <div style="background:#f8fafc;padding:8px 14px;font-weight:700;font-size:12.5px;color:#334155;border-bottom:1px solid #e2e8f0;">簽核流程進度</div>
              <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
                <tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:8px 14px;width:80px;color:#64748b;font-weight:600;">第 1 關</td><td style="padding:8px 14px;font-weight:600;">申請部門主管簽核</td><td style="padding:8px 14px;">楊為任</td><td style="padding:8px 14px;text-align:right;"><span style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:2px 10px;border-radius:999px;font-weight:700;">已核准</span></td></tr>
                <tr style="background:#eff6ff;"><td style="padding:8px 14px;color:#64748b;font-weight:600;">第 2 關</td><td style="padding:8px 14px;font-weight:700;color:#1e40af;">高階主管覆核（待您簽核）</td><td style="padding:8px 14px;font-weight:700;">沈大維</td><td style="padding:8px 14px;text-align:right;"><span style="background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;padding:2px 10px;border-radius:999px;font-weight:700;">目前關卡（待簽核）</span></td></tr>
              </table>
            </div>
            <div id="__email_action_btns" style="border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:16px 20px;">
              <div style="font-size:13px;font-weight:800;color:#334155;margin-bottom:12px;">郵件直接簽核作業（免登入系統，點擊按鈕於確認視窗一鍵完成）</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                <div style="background:#059669;color:#ffffff;text-align:center;font-weight:800;font-size:15px;padding:13px 16px;border-radius:8px;">準許簽核</div>
                <div style="background:#e11d48;color:#ffffff;text-align:center;font-weight:800;font-size:15px;padding:13px 16px;border-radius:8px;">簽核退回</div>
              </div>
            </div>
          </div>
        </div>
      \`;
      document.body.appendChild(overlay);
    `,
    targetSelector: '#__email_action_btns',
    fallbackBox: { x: 140, y: 490, w: 1000, h: 120 },
  },
  {
    filename: 'staff-s3-step2.png',
    url: '/applications',
    stepBadge: 2,
    calloutTitle: '於系統內「我的待辦 → 簽核管理」切換「待我簽核」，可直接在卡片上核准或退回',
    targetSelector: 'main',
    fallbackBox: { x: 280, y: 150, w: 950, h: 320 },
  },
  {
    filename: 'staff-s3-step3.png',
    url: '/applications?status=returned',
    stepBadge: 3,
    calloutTitle: '若單據被退回，切換至上方「已退回」頁籤點開單據，修改後重新送出',
    fallbackBox: { x: 280, y: 150, w: 950, h: 260 },
  },

  // ==========================================
  // STAFF SCENARIO 4: 填年度預算・確認名下財產
  // ==========================================
  {
    filename: 'staff-s4-step1.png',
    url: '/my-tasks/budget',
    stepBadge: 1,
    calloutTitle: '點「我的待辦 → 年度預算表填報」，開啟財會派發的預算單填寫 1~12 月預算',
    fallbackBox: { x: 280, y: 200, w: 950, h: 240 },
  },
  {
    filename: 'staff-s4-step2.png',
    url: '/assets/mine',
    stepBadge: 2,
    calloutTitle: '點「我的待辦 → 我的資產管理」，檢視名下設備、清點單確認或勾選批次轉移',
    fallbackBox: { x: 280, y: 170, w: 950, h: 350 },
  },
  {
    filename: 'staff-s4-step3.png',
    url: '/f/asset-transfer/new',
    stepBadge: 3,
    calloutTitle: '於《資產異動申請單》確認帶入的資產編號，選擇新保管人或異動類型後送出',
    fallbackBox: { x: 280, y: 160, w: 950, h: 480 },
  },

  // ==========================================
  // STAFF SCENARIO 5: 查公司規章公告・合併簽名 PDF
  // ==========================================
  {
    filename: 'staff-s5-step1.png',
    url: '/regulations',
    stepBadge: 1,
    calloutTitle: '點擊最左上角公司標誌展開「公司資訊」，點選「公司規章」搜尋管理辦法條文',
    fallbackBox: { x: 280, y: 80, w: 950, h: 520 },
  },
  {
    filename: 'staff-s5-step2.png',
    url: '/announcements',
    stepBadge: 2,
    calloutTitle: '於左上角「公司資訊」切換至「公司公告」查閱置頂公告，或至「內部問卷」填答',
    fallbackBox: { x: 280, y: 80, w: 950, h: 520 },
  },
  {
    filename: 'staff-s5-step3.png',
    url: '/tools/pdf-editor',
    stepBadge: 3,
    calloutTitle: '點左下角「工具區 → PDF 編輯器」，上傳多份 PDF 即可合併、拆頁與加上手寫簽名',
    fallbackBox: { x: 280, y: 80, w: 950, h: 580 },
  },

  // ==========================================
  // FINANCE SCENARIO 1: 專案主檔新增・停用・刪除
  // ==========================================
  {
    filename: 'fin-s1-step1.png',
    url: '/budget-codes/projects',
    stepBadge: 1,
    calloutTitle: '進入「財會管理 → 預算管理平台 → 主檔管理」，於上方表單輸入代碼與名稱新增專案',
    fallbackBox: { x: 280, y: 130, w: 950, h: 250 },
  },
  {
    filename: 'fin-s1-step2.png',
    url: '/budget-codes/projects',
    stepBadge: 2,
    calloutTitle: '清單預設最新在前並支援搜尋排序；尚未建立過預算單的專案可直接點「刪除」或「編輯」',
    prepareJs: `
      window.scrollTo(0, 260);
    `,
    fallbackBox: { x: 280, y: 180, w: 950, h: 420 },
  },
  {
    filename: 'fin-s1-step3.png',
    url: '/budget-codes/projects',
    stepBadge: 3,
    calloutTitle: '已建立過預算單的歷史專案受系統保護不可刪除，點擊右側「停用」即可封存',
    prepareJs: `
      window.scrollTo(0, 520);
    `,
    fallbackBox: { x: 280, y: 220, w: 950, h: 420 },
  },

  // ==========================================
  // FINANCE SCENARIO 2: 建立預算・派發各部門填報
  // ==========================================
  {
    filename: 'fin-s2-step1.png',
    url: '/budget-codes/overview',
    stepBadge: 1,
    calloutTitle: '進入「預算管理平台 → 建立預算」，選擇預算年度並檢視部門與專案預算科目',
    fallbackBox: { x: 280, y: 90, w: 950, h: 540 },
  },
  {
    filename: 'fin-s2-step2.png',
    url: '/budget-codes/dispatch',
    stepBadge: 2,
    calloutTitle: '勾選要派發填報的部門主管或專案負責人，一鍵派發年度預算編列任務並寄送通知',
    fallbackBox: { x: 280, y: 120, w: 950, h: 520 },
  },
  {
    filename: 'fin-s2-step3.png',
    url: '/budget-codes/management',
    stepBadge: 3,
    calloutTitle: '於「預算管理」即時追蹤各部門與專案的預算表填報進度與總額彙整',
    fallbackBox: { x: 280, y: 120, w: 950, h: 540 },
  },

  // ==========================================
  // FINANCE SCENARIO 3: 預算審核・差異分析報告
  // ==========================================
  {
    filename: 'fin-s3-step1.png',
    url: '/budget-codes/management',
    stepBadge: 1,
    calloutTitle: '於「預算管理」點選部門或專案，展開 SE01~SE99 全科目 1~12 月分月預算明細',
    prepareJs: `
      const btns = Array.from(document.querySelectorAll('button'));
      const expandBtn = btns.find(b => b.textContent && (b.textContent.includes('展開') || b.textContent.includes('明細') || b.textContent.includes('檢視')));
      if (expandBtn) expandBtn.click();
    `,
    fallbackBox: { x: 280, y: 180, w: 950, h: 480 },
  },
  {
    filename: 'fin-s3-step2.png',
    url: '/budget-codes/management',
    stepBadge: 2,
    calloutTitle: '核對各科目分月金額與前一年執行數，執行預算審核、匯入或匯出 Excel',
    prepareJs: `
      window.scrollTo(0, 320);
    `,
    fallbackBox: { x: 280, y: 140, w: 950, h: 500 },
  },
  {
    filename: 'fin-s3-step3.png',
    url: '/budget-codes/analysis',
    stepBadge: 3,
    calloutTitle: '切換至「預算分析」頁籤，檢視全公司跨年度預算差異分析與部門佔比報告',
    fallbackBox: { x: 280, y: 120, w: 950, h: 540 },
  },

  // ==========================================
  // FINANCE SCENARIO 4: 全公司財產清冊・盤點派發複核
  // ==========================================
  {
    filename: 'fin-s4-step1.png',
    url: '/assets',
    stepBadge: 1,
    calloutTitle: '點「財會管理 → 全公司財產清冊」，新增資產、管理自訂欄位或批次匯入／匯出 Excel',
    fallbackBox: { x: 280, y: 90, w: 950, h: 560 },
  },
  {
    filename: 'fin-s4-step2.png',
    url: '/assets/inventory-forms',
    stepBadge: 2,
    calloutTitle: '點「財會管理 → 財產盤點」，勾選保管人並指定清點時間，點「派發財產清點系統表單」',
    fallbackBox: { x: 280, y: 140, w: 950, h: 460 },
  },
  {
    filename: 'fin-s4-step3.png',
    url: '/assets/inventory-forms',
    stepBadge: 3,
    calloutTitle: '於下方「已派發之財產清點單」追蹤保管人確認進度，點入執行清點人第二階複核與匯出',
    prepareJs: `
      window.scrollTo(0, 480);
    `,
    fallbackBox: { x: 280, y: 180, w: 950, h: 480 },
  },

  // ==========================================
  // ADMIN SCENARIO 1: 新進／離職人員同步・權限角色
  // ==========================================
  {
    filename: 'adm-s1-step1.png',
    url: '/admin/org/directory',
    stepBadge: 1,
    calloutTitle: '點「系統管理 → 組織簽核 → 人員同步」，從 Google Workspace 同步全公司最新名單',
    fallbackBox: { x: 280, y: 110, w: 950, h: 540 },
  },
  {
    filename: 'adm-s1-step2.png',
    url: '/admin/accounts',
    stepBadge: 2,
    calloutTitle: '點「系統管理 → 帳號權限」，核准員工 Google 帳號綁定或停用離職人員存取權限',
    fallbackBox: { x: 280, y: 110, w: 950, h: 540 },
  },
  {
    filename: 'adm-s1-step3.png',
    url: '/admin/accounts/roles',
    stepBadge: 3,
    calloutTitle: '切換至「權限角色」頁籤，檢視或自訂一般員工、財會人員、系統管理員的細部權限',
    fallbackBox: { x: 280, y: 110, w: 950, h: 540 },
  },

  // ==========================================
  // ADMIN SCENARIO 2: 部門主管・職務代理人・簽核模擬
  // ==========================================
  {
    filename: 'adm-s2-step1.png',
    url: '/admin/org/departments',
    stepBadge: 1,
    calloutTitle: '於「組織簽核 → 部門／組織層級」設定各部門主管、上層部門與金額核決層級',
    fallbackBox: { x: 280, y: 110, w: 950, h: 540 },
  },
  {
    filename: 'adm-s2-step2.png',
    url: '/admin/org/delegations',
    stepBadge: 2,
    calloutTitle: '於「組織簽核 → 代理人」設定主管請假期間之職務代理人與生效起訖時間',
    fallbackBox: { x: 280, y: 110, w: 950, h: 520 },
  },
  {
    filename: 'adm-s2-step3.png',
    url: '/admin/org/simulator',
    stepBadge: 3,
    calloutTitle: '於「組織簽核 → 流程模擬」選擇表單、申請人與金額，一鍵驗證每一關簽核人',
    fallbackBox: { x: 280, y: 110, w: 950, h: 540 },
  },

  // ==========================================
  // ADMIN SCENARIO 3: 全公司簽核追蹤・展開單據內文・系統日誌
  // ==========================================
  {
    filename: 'adm-s3-step1.png',
    url: '/case-tracking',
    stepBadge: 1,
    calloutTitle: '點「系統管理 → 簽核追蹤」，涵蓋全公司請採驗、費用、出差、用印、資產等所有單據',
    fallbackBox: { x: 280, y: 90, w: 950, h: 550 },
  },
  {
    filename: 'adm-s3-step2.png',
    url: '/case-tracking',
    stepBadge: 2,
    calloutTitle: '點擊任一單據列展開完整表單欄位內文與各關卡簽核狀態（僅供追蹤稽核，不在此代簽）',
    prepareJs: `
      const expandBtns = Array.from(document.querySelectorAll('button'));
      const target = expandBtns.find(b => b.textContent && (b.textContent.includes('展開') || b.textContent.includes('明細') || b.textContent.includes('內文')));
      if (target) target.click();
    `,
    fallbackBox: { x: 280, y: 240, w: 950, h: 440 },
  },
  {
    filename: 'adm-s3-step3.png',
    url: '/admin/system-logs',
    stepBadge: 3,
    calloutTitle: '點「系統管理 → 系統日誌」，查閱不可竄改之單據簽核、郵件簽核、權限異動與 AI 稽核紀錄',
    fallbackBox: { x: 280, y: 100, w: 950, h: 560 },
  },

  // ==========================================
  // ADMIN SCENARIO 4: 表單設計・公告／規章／問卷發布
  // ==========================================
  {
    filename: 'adm-s4-step1.png',
    url: '/admin/form-builder',
    stepBadge: 1,
    calloutTitle: '點「系統管理 → 表單設計」，選擇全系統 13 張簽核表單調整欄位配置與簽核流程並發佈',
    fallbackBox: { x: 280, y: 100, w: 950, h: 560 },
  },
  {
    filename: 'adm-s4-step2.png',
    url: '/admin/announcements',
    stepBadge: 2,
    calloutTitle: '於「公告管理」與「規章管理」發布置頂公告，或從 Google Drive 同步管理辦法至 AI 知識庫',
    fallbackBox: { x: 280, y: 100, w: 950, h: 560 },
  },
  {
    filename: 'adm-s4-step3.png',
    url: '/admin/surveys',
    stepBadge: 3,
    calloutTitle: '於「系統管理 → 問卷管理」建立內部具名問卷、即時追蹤未填同仁名單並匯出統計',
    fallbackBox: { x: 280, y: 100, w: 950, h: 560 },
  },

  // ==========================================
  // ADMIN SCENARIO 5: 功能授權碼・統編設定・信箱測試
  // ==========================================
  {
    filename: 'adm-s5-step1.png',
    url: '/admin/feature-flags',
    stepBadge: 1,
    calloutTitle: '點「系統管理 → 功能授權」，輸入加密授權碼套用模組開關與效期（關閉模組嚴格禁止網址進入）',
    fallbackBox: { x: 280, y: 90, w: 950, h: 560 },
  },
  {
    filename: 'adm-s5-step2.png',
    url: '/admin/company',
    stepBadge: 2,
    calloutTitle: '點「系統管理 → 公司資料」，設定公司正式名稱與 8 碼統編（50887923，連動 AI 發票統編檢核）',
    fallbackBox: { x: 280, y: 90, w: 950, h: 520 },
  },
  {
    filename: 'adm-s5-step3.png',
    url: '/admin/email-settings',
    stepBadge: 3,
    calloutTitle: '點「系統管理 → 信箱設定」，管理 Google 委派寄信（no-reply 別名）並發送實機測試簽核信',
    fallbackBox: { x: 280, y: 90, w: 950, h: 560 },
  },
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = getDb();
  const [emp] = await db
    .select()
    .from(employees)
    .where(eq(employees.role, 'admin'))
    .limit(1);

  if (!emp) {
    throw new Error('Could not find admin employee');
  }

  const { token } = await createSession(db, {
    employeeId: emp.id,
    identityId: null,
    ttlMs: 3600_000,
  });

  console.log('Minted session token for admin employee');

  const debugPort = 9333;
  const userDataDir = '/tmp/accsys-guide-chrome-profile';
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const chrome = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--window-size=1280,760',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    let targets: Array<{ id: string; webSocketDebuggerUrl: string; type: string }> = [];
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (res.ok) {
          targets = (await res.json()) as typeof targets;
          if (targets.some((t) => t.type === 'page')) break;
        }
      } catch {
        // wait
      }
      await sleep(200);
    }

    const pageTarget = targets.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found in headless Chrome');

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) => reject(e));
    });

    let msgId = 1;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

    ws.addEventListener('message', (ev) => {
      const data = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (data.id && pending.has(data.id)) {
        const p = pending.get(data.id)!;
        pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error.message));
        else p.resolve(data.result);
      }
    });

    function sendCdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const id = msgId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendCdp('Page.enable');
    await sendCdp('Network.enable');
    await sendCdp('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 760,
      deviceScaleFactor: 1.5,
      mobile: false,
    });

    await sendCdp('Network.setCookie', {
      name: 'accsys_sid',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    });

    for (const task of TASKS) {
      const fullUrl = `${APP_ORIGIN}${task.url}`;
      console.log(`Capturing ${task.filename} -> ${fullUrl}`);
      await sendCdp('Page.navigate', { url: fullUrl });
      await sleep(1400);

      if (task.prepareJs) {
        await sendCdp('Runtime.evaluate', {
          expression: `(() => { try { ${task.prepareJs} } catch (e) { console.error(e); } })()`,
          awaitPromise: true,
        });
        await sleep(350);
      }

      const box = task.fallbackBox ?? { x: 280, y: 120, w: 940, h: 520 };
      const annotateScript = `
        (() => {
          const old = document.getElementById('__guide_callout_layer');
          if (old) old.remove();

          let rect = { left: ${box.x}, top: ${box.y}, width: ${box.w}, height: ${box.h} };
          const sel = ${JSON.stringify(task.targetSelector ?? '')};
          if (sel) {
            const el = document.querySelector(sel);
            if (el) {
              const r = el.getBoundingClientRect();
              if (r.width > 40 && r.height > 24 && r.top < 720) {
                rect = {
                  left: Math.max(12, r.left - 6),
                  top: Math.max(12, r.top - 6),
                  width: Math.min(1250 - Math.max(12, r.left - 6), r.width + 12),
                  height: Math.min(736 - Math.max(12, r.top - 6), r.height + 12),
                };
              }
            }
          }

          const layer = document.createElement('div');
          layer.id = '__guide_callout_layer';
          layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;';

          const highlight = document.createElement('div');
          highlight.style.cssText = \`
            position:fixed;
            left:\${rect.left}px;
            top:\${rect.top}px;
            width:\${rect.width}px;
            height:\${rect.height}px;
            border:3px solid #dc2626;
            border-radius:12px;
            box-shadow:0 0 0 4px rgba(220,38,38,0.18);
          \`;

          const badge = document.createElement('div');
          const badgeTop = rect.top > 56 ? rect.top - 22 : rect.top + 8;
          badge.style.cssText = \`
            position:fixed;
            left:\${Math.max(16, rect.left + 12)}px;
            top:\${badgeTop}px;
            background:#dc2626;
            color:#ffffff;
            padding:6px 14px;
            border-radius:999px;
            font-size:13.5px;
            font-weight:800;
            font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC",sans-serif;
            box-shadow:0 4px 12px rgba(220,38,38,0.35);
            display:inline-flex;
            align-items:center;
            gap:8px;
            border:2px solid #ffffff;
          \`;
          badge.innerHTML = \`<span style="background:#fff;color:#dc2626;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;">${task.stepBadge}</span><span>\${${JSON.stringify(task.calloutTitle)}}</span>\`;

          layer.appendChild(highlight);
          layer.appendChild(badge);
          document.body.appendChild(layer);
        })()
      `;

      await sendCdp('Runtime.evaluate', { expression: annotateScript });
      await sleep(150);

      const shot = (await sendCdp('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      })) as { data: string };

      fs.writeFileSync(path.join(OUT_DIR, task.filename), Buffer.from(shot.data, 'base64'));
    }

    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }

  console.log('All 42 real screenshots captured to public/guide/shots/');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
