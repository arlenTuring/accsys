/**
 * ACCSYS 實際啟用之核心信件通知模板（共 5 組真實系統觸發範本）
 *
 * 全系統實際發信觸發點：
 * 1. approval_requested       — 單據待簽核通知（src/lib/workflow/tx.ts：所有 13 張簽核表單進入待簽核關卡時觸發）
 * 2. request_approved         — 單據核准結案通知（src/lib/workflow/tx.ts：所有簽核表單完成最後一關決行核准時觸發）
 * 3. request_returned         — 單據退回修正通知（src/lib/workflow/tx.ts：任一關卡簽核人選擇退回並填寫原因時觸發）
 * 4. budget_form_dispatched   — 預算申請單派發填寫通知（src/lib/budget-codes/actions.ts：財會派發年度／專案預算申請單時觸發）
 * 5. asset_inventory_dispatched — 財產清點單派發盤點通知（src/lib/assets/inventory-forms.ts：財產清點人派發盤點單時觸發）
 */

export type EmailCategoryKey =
  | 'approval'
  | 'finance'
  | 'asset'
  | 'procurement'
  | 'expense'
  | 'seal'
  | 'system';

export type EmailCategoryMeta = {
  key: EmailCategoryKey;
  title: string;
  description: string;
  badgeColor: string;
};

export const EMAIL_CATEGORIES: EmailCategoryMeta[] = [
  {
    key: 'approval',
    title: '簽核與表單流程 (核心)',
    description: '涵蓋全系統 13 張簽核表單之「待簽核」、「核准結案」、「退回修正」三大實際發信通知。',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'finance',
    title: '財會與預算派發',
    description: '財會管理員於預算管理平台派發年度／專案預算申請單時之填報通知。',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  {
    key: 'asset',
    title: '資產管理與財產盤點',
    description: '財產清點人派發【財產清點單】予各資產保管人執行線上盤點確認通知。',
    badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  },
];

export type EmailTemplateDefinition = {
  id: string;
  category: EmailCategoryKey;
  name: string;
  description: string;
  triggerEvent: string;
  enabled: boolean;
  subjectTemplate: string;
  bodyTextTemplate: string;
  bodyHtmlTemplate: string;
  variables: Array<{ key: string; label: string; sample: string }>;
};

/**
 * 最新單據格式之範例 HTML（供信箱設定「信件即時預覽」與測試信渲染真實單據欄位、品項表格、簽核進度與信件內簽核按鈕）
 */
export const SAMPLE_DOCUMENT_DETAILS_HTML = `<div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
  <div style="background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 700; font-size: 13.5px; color: #334155;">
    單據欄位明細（公出差旅申請單 · 20261117BT0001）
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 160px; white-space: nowrap; vertical-align: top; font-weight: 600;">申請總額</td>
      <td style="padding: 10px 16px; color: #047857; font-weight: 700; font-family: monospace; white-space: nowrap;">NT$ 3,600</td>
    </tr>
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 160px; white-space: nowrap; vertical-align: top; font-weight: 600;">出差時間</td>
      <td style="padding: 10px 16px; color: #0f172a; white-space: nowrap;">2026/11/19 08:30 ～ 2026/11/19 18:30</td>
    </tr>
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 160px; white-space: nowrap; vertical-align: top; font-weight: 600;">出差地點</td>
      <td style="padding: 10px 16px; color: #0f172a;">新竹縣竹北市（高鐵自駕測試場域）</td>
    </tr>
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 160px; white-space: nowrap; vertical-align: top; font-weight: 600;">出差事由</td>
      <td style="padding: 10px 16px; color: #0f172a;">赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調</td>
    </tr>
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 160px; white-space: nowrap; vertical-align: top; font-weight: 600;">行程概要</td>
      <td style="padding: 10px 16px; color: #0f172a;">上午進行實車感測器校正與封閉場域測試，下午進行開放道路 V2X 號誌優先聯調與數據回收</td>
    </tr>
  </table>
</div>
<div style="margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
  <div style="background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 700; font-size: 13.5px; color: #334155;">
    簽核流程進度
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 16px; color: #64748b; width: 90px; font-weight: 600; white-space: nowrap;">第 1 關</td>
      <td style="padding: 10px 16px; color: #0f172a; font-weight: 600; white-space: nowrap;">申請部門主管簽核</td>
      <td style="padding: 10px 16px; color: #334155; white-space: nowrap;">楊為任</td>
      <td style="padding: 10px 16px; text-align: right; white-space: nowrap;"><span style="display:inline-block;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;">已核准</span></td>
    </tr>
    <tr style="border-bottom: 1px solid #f1f5f9; background: #eff6ff;">
      <td style="padding: 10px 16px; color: #64748b; width: 90px; font-weight: 600; white-space: nowrap;">第 2 關</td>
      <td style="padding: 10px 16px; color: #0f172a; font-weight: 600; white-space: nowrap;">高階主管覆核（待您簽核）</td>
      <td style="padding: 10px 16px; color: #334155; white-space: nowrap;">沈大維</td>
      <td style="padding: 10px 16px; text-align: right; white-space: nowrap;"><span style="display:inline-block;background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;padding:3px 10px;border-radius:999px;font-size:11.5px;font-weight:700;white-space:nowrap;">目前關卡（待簽核）</span></td>
    </tr>
  </table>
</div>`;

export const SAMPLE_APPROVAL_ACTIONS_HTML = `<div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; padding: 18px 20px;">
  <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 14px;">
    郵件直接簽核作業
  </div>
  <table role="presentation" style="width: 100%; border-collapse: collapse; table-layout: fixed;">
    <tr>
      <td style="padding-right: 8px; width: 50%; vertical-align: middle;">
        <a href="#preview-approve" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background-color: #059669; border: 1px solid #059669; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
          準許簽核
        </a>
      </td>
      <td style="padding-left: 8px; width: 50%; vertical-align: middle;">
        <a href="#preview-return" style="display: block; box-sizing: border-box; width: 100%; text-align: center; background-color: #e11d48; border: 1px solid #e11d48; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px; line-height: 20px; padding: 12px 16px; border-radius: 8px; white-space: nowrap;">
          簽核退回
        </a>
      </td>
    </tr>
  </table>
</div>`;

export const COMMON_EMAIL_VARIABLES: Array<{ key: string; label: string; sample: string }> = [
  { key: 'recipientName', label: '收件人姓名', sample: '沈大維' },
  { key: 'recipientEmail', label: '收件人信箱', sample: 'approver@turing-drive.com' },
  { key: 'applicantName', label: '申請人／發起人', sample: '阮振瑋' },
  { key: 'departmentName', label: '申請部門', sample: '自動駕駛系統部 (ADS)' },
  { key: 'formLabel', label: '單據／表單名稱', sample: '公出差旅申請單' },
  { key: 'caseNumber', label: '單號／案號', sample: '20261117BT0001' },
  { key: 'title', label: '主旨／專案名稱', sample: '新竹竹北高鐵自駕場域光達道路實測與 V2X 聯調' },
  { key: 'amount', label: '金額', sample: 'NT$ 3,600' },
  { key: 'stepLabel', label: '簽核關卡', sample: '第 2 關：高階主管覆核（待您簽核）' },
  { key: 'reason', label: '退回原因／備註說明', sample: '請補附第二家供應商比價報價單與保固年限說明' },
  { key: 'companyName', label: '公司名稱', sample: '台灣智慧駕駛股份有限公司 (TURING DRIVE)' },
  {
    key: 'documentDetailsHtml',
    label: '單據完整欄位、品項明細表與簽核進度 (HTML)',
    sample: SAMPLE_DOCUMENT_DETAILS_HTML,
  },
  {
    key: 'approvalActionsHtml',
    label: '信件內直接簽核按鈕區 (HTML)',
    sample: SAMPLE_APPROVAL_ACTIONS_HTML,
  },
];

function wrapStandardHtml(headerBadge: string, accentColor: string, innerHtml: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Noto Sans TC', 'Segoe UI', sans-serif; max-width: 1080px; width: 100%; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden;">
  <div style="background: ${accentColor}; padding: 20px 28px; color: #ffffff;">
    <div style="font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.9;">TURING DRIVE · ACCSYS 系統通知</div>
    <div style="font-size: 19px; font-weight: 700; margin-top: 4px;">${headerBadge}</div>
  </div>
  <div style="padding: 26px 28px; color: #1e293b; font-size: 14px; line-height: 1.7;">
    ${innerHtml}
    {{documentDetailsHtml}}
    {{approvalActionsHtml}}
  </div>
  <div style="background: #f8fafc; padding: 14px 28px; color: #64748b; font-size: 12px; border-top: 1px solid #e2e8f0;">
    此信件由 {{companyName}} ACCSYS 系統自動發送，請勿直接回覆。
  </div>
</div>`;
}

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  // 1. 單據待簽核通知（實際使用：workflow/tx.ts deliverOutbox）
  {
    id: 'approval_requested',
    category: 'approval',
    name: '單據待簽核通知',
    description:
      '【系統實際觸發】當全系統 13 張簽核表單（請購、採購、驗收、採購付款、費用報支、公出差旅、差旅報支、三類用印、資產異動、預算申請／變更）進入待簽核關卡時，自動帶入完整單據欄位明細與信件內直接簽核按鈕發送予當前簽核人。',
    triggerEvent: 'approval_requested (src/lib/workflow/tx.ts · 所有簽核表單進入待簽核關卡)',
    enabled: true,
    subjectTemplate: '【待簽核】{{formLabel}} {{caseNumber}} — {{applicantName}} 提出申請',
    bodyTextTemplate: `{{recipientName}} 您好：\n\n您有一張待簽核的「{{formLabel}}」需要處理：\n・單據類型：{{formLabel}}\n・單據案號：{{caseNumber}}\n・申請人員：{{applicantName}}（{{departmentName}}）\n・簽核關卡：{{stepLabel}}\n・摘要說明：{{message}}\n\n{{documentDetailsText}}\n{{approvalActionsText}}`,
    bodyHtmlTemplate: wrapStandardHtml(
      '【待簽核】{{formLabel}} {{caseNumber}}',
      '#1e40af',
      `<p style="margin: 0 0 12px;"><strong>{{recipientName}}</strong> 您好：</p>
      <p style="margin: 0 0 14px;">您有一張待簽核的單據需要審核處理，以下為單據摘要與完整明細：</p>
      <table style="width: 100%; border-collapse: collapse; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 16px; color: #64748b; width: 150px; white-space: nowrap; font-weight: 600;">單據類型</td><td style="padding: 10px 16px; font-weight: 700; color: #0f172a;">{{formLabel}}</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 16px; color: #64748b; width: 150px; white-space: nowrap; font-weight: 600;">單據案號</td><td style="padding: 10px 16px; font-family: monospace; font-weight: 700; color: #0f172a; white-space: nowrap;">{{caseNumber}}</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 16px; color: #64748b; width: 150px; white-space: nowrap; font-weight: 600;">申請人員</td><td style="padding: 10px 16px; color: #1e293b;">{{applicantName}}（{{departmentName}}）</td></tr>
        <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 10px 16px; color: #64748b; width: 150px; white-space: nowrap; font-weight: 600;">目前關卡</td><td style="padding: 10px 16px; font-weight: 600; color: #1e40af;">{{stepLabel}}</td></tr>
        <tr><td style="padding: 10px 16px; color: #64748b; width: 150px; white-space: nowrap; font-weight: 600;">摘要訊息</td><td style="padding: 10px 16px; color: #334155;">{{message}}</td></tr>
      </table>`
    ),
    variables: COMMON_EMAIL_VARIABLES,
  },

  // 2. 單據核准結案通知（實際使用：workflow/tx.ts deliverOutbox）
  {
    id: 'request_approved',
    category: 'approval',
    name: '單據核准結案通知',
    description:
      '【系統實際觸發】當簽核表單完成最後一關決行核准時，自動帶入完整單據明細與全數核准之簽核流程進度通知原申請人。',
    triggerEvent: 'request_approved (src/lib/workflow/tx.ts · 最後一關簽核決行通過時)',
    enabled: true,
    subjectTemplate: '【已核准】{{formLabel}} {{caseNumber}} 已完成簽核',
    bodyTextTemplate: `{{recipientName}} 您好：\n\n您申請的「{{formLabel}}」（單號：{{caseNumber}}）已完成所有簽核關卡並正式核准：\n・單據類型：{{formLabel}}\n・單據案號：{{caseNumber}}\n・申請人員：{{applicantName}}（{{departmentName}}）\n・核准狀態：已完成全部關卡決行核准\n・通知說明：{{message}}\n\n{{documentDetailsText}}`,
    bodyHtmlTemplate: wrapStandardHtml(
      '【已核准】{{formLabel}} {{caseNumber}}',
      '#047857',
      `<p style="margin: 0 0 12px;"><strong>{{recipientName}}</strong> 您好：</p>
      <p style="margin: 0 0 14px;">您提交的單據已順利通過所有簽核關卡並正式核准：</p>
      <table style="width: 100%; border-collapse: collapse; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; overflow: hidden; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #d1fae5;"><td style="padding: 10px 16px; color: #065f46; width: 150px; white-space: nowrap; font-weight: 600;">單據類型</td><td style="padding: 10px 16px; font-weight: 700; color: #064e3b;">{{formLabel}}</td></tr>
        <tr style="border-bottom: 1px solid #d1fae5;"><td style="padding: 10px 16px; color: #065f46; width: 150px; white-space: nowrap; font-weight: 600;">單據案號</td><td style="padding: 10px 16px; font-family: monospace; font-weight: 700; color: #064e3b; white-space: nowrap;">{{caseNumber}}</td></tr>
        <tr style="border-bottom: 1px solid #d1fae5;"><td style="padding: 10px 16px; color: #065f46; width: 150px; white-space: nowrap; font-weight: 600;">申請人員</td><td style="padding: 10px 16px; color: #065f46;">{{applicantName}}（{{departmentName}}）</td></tr>
        <tr style="border-bottom: 1px solid #d1fae5;"><td style="padding: 10px 16px; color: #065f46; width: 150px; white-space: nowrap; font-weight: 600;">簽核狀態</td><td style="padding: 10px 16px; font-weight: 700; color: #047857; white-space: nowrap;">✓ 已完成全部關卡核准</td></tr>
        <tr><td style="padding: 10px 16px; color: #065f46; width: 150px; white-space: nowrap; font-weight: 600;">核准訊息</td><td style="padding: 10px 16px; color: #065f46;">{{message}}</td></tr>
      </table>`
    ),
    variables: COMMON_EMAIL_VARIABLES,
  },

  // 3. 單據退回修正通知（實際使用：workflow/tx.ts deliverOutbox）
  {
    id: 'request_returned',
    category: 'approval',
    name: '單據退回修正通知',
    description:
      '【系統實際觸發】當任一關卡簽核人將單據退回時，自動帶入退回原因、單據完整欄位明細與簽核紀錄通知原申請人修改重送。',
    triggerEvent: 'request_returned (src/lib/workflow/tx.ts · 任一關卡簽核人選擇退回時)',
    enabled: true,
    subjectTemplate: '【已退回】{{formLabel}} {{caseNumber}} 請檢視原因後修正重送',
    bodyTextTemplate: `{{recipientName}} 您好：\n\n您申請的「{{formLabel}}」（單號：{{caseNumber}}）已被退回修正：\n・單據類型：{{formLabel}}\n・單據案號：{{caseNumber}}\n・退回關卡：{{stepLabel}}\n・退回原因：{{reason}}\n・通知說明：{{message}}\n\n{{documentDetailsText}}\n{{approvalActionsText}}`,
    bodyHtmlTemplate: wrapStandardHtml(
      '【已退回】{{formLabel}} {{caseNumber}}',
      '#be123c',
      `<p style="margin: 0 0 12px;"><strong>{{recipientName}}</strong> 您好：</p>
      <p style="margin: 0 0 14px;">您的單據在簽核過程中被退回，請檢視以下退回原因與單據明細後修正重送：</p>
      <table style="width: 100%; border-collapse: collapse; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 10px; overflow: hidden; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #ffe4e6;"><td style="padding: 10px 16px; color: #9f1239; width: 150px; white-space: nowrap; font-weight: 600;">單據類型</td><td style="padding: 10px 16px; font-weight: 700; color: #881337;">{{formLabel}}</td></tr>
        <tr style="border-bottom: 1px solid #ffe4e6;"><td style="padding: 10px 16px; color: #9f1239; width: 150px; white-space: nowrap; font-weight: 600;">單據案號</td><td style="padding: 10px 16px; font-family: monospace; font-weight: 700; color: #881337; white-space: nowrap;">{{caseNumber}}</td></tr>
        <tr style="border-bottom: 1px solid #ffe4e6;"><td style="padding: 10px 16px; color: #9f1239; width: 150px; white-space: nowrap; font-weight: 600;">申請人員</td><td style="padding: 10px 16px; color: #881337;">{{applicantName}}（{{departmentName}}）</td></tr>
        <tr style="border-bottom: 1px solid #ffe4e6;"><td style="padding: 10px 16px; color: #9f1239; width: 150px; white-space: nowrap; font-weight: 600;">退回原因</td><td style="padding: 10px 16px; font-weight: 700; color: #be123c;">{{reason}}</td></tr>
        <tr><td style="padding: 10px 16px; color: #9f1239; width: 150px; white-space: nowrap; font-weight: 600;">摘要訊息</td><td style="padding: 10px 16px; color: #9f1239;">{{message}}</td></tr>
      </table>`
    ),
    variables: COMMON_EMAIL_VARIABLES,
  },

  // 4. 預算申請單派發填寫通知（實際使用：src/lib/budget-codes/actions.ts）
  {
    id: 'budget_form_dispatched',
    category: 'finance',
    name: '預算申請單派發填寫通知',
    description:
      '【系統實際觸發】財會管理員於預算管理平台派發年度／專案預算申請單時，通知受派發之部門主管或專案負責人線上填報。',
    triggerEvent: 'budget.dispatched (src/lib/budget-codes/actions.ts · 財會派發預算申請單時)',
    enabled: true,
    subjectTemplate: '【預算申請派發】請線上填寫「{{title}}」預算申請單（{{caseNumber}}）',
    bodyTextTemplate: `{{recipientName}} 您好：\n\n財會單位已派發「{{title}}」預算申請單（編號：{{caseNumber}}）給您：\n・單據類型：{{formLabel}}\n・預算單號：{{caseNumber}}\n・派發單位：{{applicantName}}（{{departmentName}}）\n・作業說明：{{message}}\n\n{{documentDetailsText}}\n{{approvalActionsText}}`,
    bodyHtmlTemplate: wrapStandardHtml(
      '【預算申請單派發】{{caseNumber}}',
      '#6d28d9',
      `<p style="margin: 0 0 12px;"><strong>{{recipientName}}</strong> 您好：</p>
      <p style="margin: 0 0 14px;">財會單位已派發一張線上預算申請單給您，以下為派發摘要與預算科目明細：</p>
      <table style="width: 100%; border-collapse: collapse; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 10px; overflow: hidden; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #ede9fe;"><td style="padding: 10px 16px; color: #5b21b6; width: 150px; white-space: nowrap; font-weight: 600;">單據類型</td><td style="padding: 10px 16px; font-weight: 700; color: #4c1d95;">{{formLabel}}</td></tr>
        <tr style="border-bottom: 1px solid #ede9fe;"><td style="padding: 10px 16px; color: #5b21b6; width: 150px; white-space: nowrap; font-weight: 600;">預算單號</td><td style="padding: 10px 16px; font-family: monospace; font-weight: 700; color: #4c1d95; white-space: nowrap;">{{caseNumber}}</td></tr>
        <tr style="border-bottom: 1px solid #ede9fe;"><td style="padding: 10px 16px; color: #5b21b6; width: 150px; white-space: nowrap; font-weight: 600;">派發人員</td><td style="padding: 10px 16px; color: #4c1d95;">{{applicantName}}（{{departmentName}}）</td></tr>
        <tr><td style="padding: 10px 16px; color: #5b21b6; width: 150px; white-space: nowrap; font-weight: 600;">派發說明</td><td style="padding: 10px 16px; color: #5b21b6;">{{message}}</td></tr>
      </table>`
    ),
    variables: COMMON_EMAIL_VARIABLES,
  },

  // 5. 財產清點單派發盤點通知（實際使用：src/lib/assets/inventory-forms.ts）
  {
    id: 'asset_inventory_dispatched',
    category: 'asset',
    name: '財產清點單派發盤點通知',
    description:
      '【系統實際觸發】財產清點人派發盤點批次時，帶入保管人名下待清點財產明細表，通知保管人執行線上盤點確認。',
    triggerEvent: 'asset_inventory.dispatched (src/lib/assets/inventory-forms.ts · 派發財產盤點單時)',
    enabled: true,
    subjectTemplate: '【財產盤點通知】請完成【財產清點單 {{caseNumber}}】名下保管資產清點',
    bodyTextTemplate: `{{recipientName}} 您好：\n\n您收到一張【財產清點單 {{caseNumber}}】：\n・清點單號：{{caseNumber}}\n・清點派發人：{{applicantName}}（{{departmentName}}）\n・作業說明：{{message}}\n\n{{documentDetailsText}}\n{{approvalActionsText}}`,
    bodyHtmlTemplate: wrapStandardHtml(
      '【財產清點單】{{caseNumber}}',
      '#0e7490',
      `<p style="margin: 0 0 12px;"><strong>{{recipientName}}</strong> 您好：</p>
      <p style="margin: 0 0 14px;">財產清點人已派發本批次財產清點單給您，以下為清點單摘要與名下保管資產明細：</p>
      <table style="width: 100%; border-collapse: collapse; background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 10px; overflow: hidden; font-size: 13.5px;">
        <tr style="border-bottom: 1px solid #cffafe;"><td style="padding: 10px 16px; color: #155e75; width: 150px; white-space: nowrap; font-weight: 600;">單據類型</td><td style="padding: 10px 16px; font-weight: 700; color: #164e63;">財產清點單</td></tr>
        <tr style="border-bottom: 1px solid #cffafe;"><td style="padding: 10px 16px; color: #155e75; width: 150px; white-space: nowrap; font-weight: 600;">清點單號</td><td style="padding: 10px 16px; font-family: monospace; font-weight: 700; color: #164e63; white-space: nowrap;">{{caseNumber}}</td></tr>
        <tr style="border-bottom: 1px solid #cffafe;"><td style="padding: 10px 16px; color: #155e75; width: 150px; white-space: nowrap; font-weight: 600;">財產清點人</td><td style="padding: 10px 16px; color: #164e63;">{{applicantName}}（{{departmentName}}）</td></tr>
        <tr><td style="padding: 10px 16px; color: #155e75; width: 150px; white-space: nowrap; font-weight: 600;">盤點說明</td><td style="padding: 10px 16px; color: #0e7490;">{{message}}</td></tr>
      </table>`
    ),
    variables: COMMON_EMAIL_VARIABLES,
  },
];

/**
 * 將模板字串中的 {{key}} 變數替換為實際值
 */
export function renderTemplateString(
  template: string,
  vars: Record<string, string | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

/**
 * 根據通知類型 (type) 與表單類型 (formType / caseNumber) 對應實際使用的 5 大核心模板 ID
 */
export function resolveTemplateIdForNotification(input: {
  type: 'approval_requested' | 'request_returned' | 'request_approved' | string;
  formType?: string;
  caseNumber?: string;
  message?: string;
}): string {
  const { type, formType = '', caseNumber = '', message = '' } = input;

  if (
    formType === 'asset_inventory' ||
    formType === 'asset_inventory_handover' ||
    caseNumber.startsWith('INV-') ||
    message.includes('財產清點單') ||
    message.includes('財產盤點')
  ) {
    return 'asset_inventory_dispatched';
  }
  if (
    formType === 'budget_application' ||
    formType === 'budget_dispatch' ||
    caseNumber.startsWith('BUDGET-') ||
    caseNumber.startsWith('BDG-') ||
    message.includes('預算申請單') ||
    message.includes('預算編列')
  ) {
    return 'budget_form_dispatched';
  }
  if (type === 'request_returned') {
    return 'request_returned';
  }
  if (type === 'request_approved') {
    return 'request_approved';
  }
  return 'approval_requested';
}
