import {
  getEmailSystemConfig,
  HARD_LOCKED_TEST_RECIPIENT,
} from '@/lib/email/config';
import {
  sendViaGmailServiceAccount,
  type GmailSendResult,
} from '@/lib/email/gmail-sender';
import {
  renderTemplateString,
  type EmailCategoryKey,
} from '@/lib/email/templates';

export type WorkScenarioDefinition = {
  id: string;
  code: string;
  category: EmailCategoryKey;
  templateId: string;
  moduleName: string;
  title: string;
  actorDisplay: string;
  recipientDisplay: string;
  recipientEmail: string;
  expectedStatus: 'sent' | 'blocked_by_test_guard';
  systemPath: string;
  description: string;
  vars: {
    recipientName: string;
    recipientEmail: string;
    applicantName: string;
    departmentName: string;
    formLabel: string;
    caseNumber: string;
    title: string;
    amount: string;
    stepLabel: string;
    reason: string;
    message: string;
  };
};

export type WorkScenarioExecutionResult = {
  scenarioId: string;
  code: string;
  title: string;
  moduleName: string;
  templateId: string;
  recipientEmail: string;
  expectedStatus: 'sent' | 'blocked_by_test_guard';
  actualStatus: GmailSendResult['status'];
  passed: boolean;
  subject: string;
  caseNumber: string;
  gmailMessageId?: string;
  delegatedUser?: string;
  dbRecordSummary: string;
  note?: string;
};

export const WORK_SCENARIOS: WorkScenarioDefinition[] = [
  {
    id: 'scenario_01_pending_approval',
    code: 'S01',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '簽核與表單流程',
    title: '【待簽核】公出差旅申請單送出待審核通知',
    actorDisplay: '阮振瑋 (0017 · 自動駕駛系統部 工程經理)',
    recipientDisplay: '簽核主管（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications',
    description:
      '自動駕駛系統部工程經理 阮振瑋 (0017) 送出《公出差旅申請單》（前往新竹 ARTC 車測中心進行自駕巴士實車整合測試），經簽核流轉進入待簽核關卡。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '公出差旅申請單',
      caseNumber: '20261117BT0001',
      title: '新竹 ARTC 車測中心自駕巴士實車整合測試出差案',
      amount: 'NT$ 4,800',
      stepLabel: '高階主管覆核',
      reason: '無（正常送簽）',
      message:
        '阮振瑋（自動駕駛系統部）提出「公出差旅申請單 20261117BT0001」（事由：前往新竹 ARTC 進行自駕巴士感知與控制系統實車測試，同行人：呂京霖、何宗璟），目前進入您的簽核關卡，請撥冗審核。',
    },
  },
  {
    id: 'scenario_02_approved_closure',
    code: 'S02',
    category: 'approval',
    templateId: 'request_approved',
    moduleName: '簽核與表單流程',
    title: '【已核准】請購單全關卡決行通過結案通知',
    actorDisplay: '沈大維 (0002 · 總經理室 執行長)',
    recipientDisplay: '申請同仁（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications?status=approved',
    description:
      '申請人提出之《請購單》（自駕車載邊緣運算工業電腦 IPC 模組採購案，NT$ 86,000），經預算負責人 楊為任 (0053) 與執行長 沈大維 (0002) 最終決行核准通過。',
    vars: {
      recipientName: '申請同仁',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '請購單',
      caseNumber: '20261117PR0002',
      title: '自駕車載邊緣運算工業電腦 IPC 模組採購案',
      amount: 'NT$ 86,000',
      stepLabel: '總經理決行（已完成全部關卡）',
      reason: '核准通過',
      message:
        '您申請的「請購單 20261117PR0002」（品項：車載邊緣運算 IPC 模組 2 組，預算編號：115ADSSE15，總金額 NT$ 86,000）已由執行長 沈大維 完成最終簽核並正式核准，可接續轉開採購單。',
    },
  },
  {
    id: 'scenario_03_returned_revision',
    code: 'S03',
    category: 'approval',
    templateId: 'request_returned',
    moduleName: '簽核與表單流程',
    title: '【已退回】採購單退回補充報價單修正通知',
    actorDisplay: '許雲茹 (0009 · 管理部 行政財會)',
    recipientDisplay: '申請同仁（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications?status=returned',
    description:
      '申請人提出之《採購單》經管理部行政財會 許雲茹 (0009) 檢核發現需補附第二家比價報價單與原廠保固年限說明，執行退回修正。',
    vars: {
      recipientName: '申請同仁',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '採購單',
      caseNumber: '20261117PO0003',
      title: '車載高精定位 GNSS/INS 雙天線接收機採購案',
      amount: 'NT$ 95,000',
      stepLabel: '管理部財會覆核',
      reason: '單筆採購金額逾 5 萬元，請補附第二家供應商比價報價單，並於備註欄註明原廠保固年限（至少 2 年）後重新送簽。',
      message:
        '管理部行政財會 許雲茹 已將您的「採購單 20261117PO0003」退回修正。退回原因：單筆採購金額逾 5 萬元，請補附第二家供應商比價報價單，並於備註欄註明原廠保固年限後重新送出。',
    },
  },
  {
    id: 'scenario_04_procurement_stage',
    code: 'S04',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '採購流程管理（四階段鏈路）',
    title: '【待簽核】請購 ➔ 採購 ➔ 驗收單點交審核通知',
    actorDisplay: '陳維隆 (0001 · 董事長) ／ 賴昭宇 (0046 · 車輛開發部)',
    recipientDisplay: '簽核主管（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/procurement',
    description:
      '逾 10 萬元之「Ouster OS1-64 高精光達感測器採購案（NT$ 168,000）」經董事長 陳維隆 (0001) 決行通過，並由車輛開發部 賴昭宇 (0046) 與陳冠文 (0032) 完成實物點交《驗收單》，進入待簽核關卡。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '賴昭宇',
      departmentName: '車輛開發部 (VD)',
      formLabel: '驗收單',
      caseNumber: '20261117AC0004',
      title: 'Ouster OS1-64 高精光達感測器模組採購案（案號 CP1151100004）',
      amount: 'NT$ 168,000',
      stepLabel: '高階主管覆核驗收與請款放行（待您簽核）',
      reason: '實物點交與測試合格',
      message:
        '車輛開發部 賴昭宇（0046）與陳冠文（0032）已完成採購案 CP1151100004（Ouster OS1-64 光達感測器模組，含稅總額 NT$ 168,000）實物點交並送出「驗收單 20261117AC0004」，目前進入您的簽核關卡。',
    },
  },
  {
    id: 'scenario_05_expense_claim',
    code: 'S05',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '費用報支與出差旅費',
    title: '【待簽核】費用報支申請單送出待審核通知',
    actorDisplay: '張晏銘 (0060 · 產品部 產品經理)',
    recipientDisplay: '簽核主管（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications',
    description:
      '產品部產品經理 張晏銘 (0060) 針對「自駕巴士智慧座艙產品專案 (TD2601 / 預算 115TD2601PR01)」送出《費用報支申請單》（NT$ 24,600），通知進行簽核審核。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '張晏銘',
      departmentName: '產品部 (PD)',
      formLabel: '費用報支申請單',
      caseNumber: '20261117EC0005',
      title: '自駕巴士智慧座艙產品專案 (TD2601) 觸控面板樣品費用報支',
      amount: 'NT$ 24,600',
      stepLabel: '高階主管簽核（待您簽核）',
      reason: '專案研發材料費用核銷',
      message:
        '產品部 張晏銘（0060）提交「費用報支申請單 20261117EC0005」（歸屬專案：TD2601 自駕巴士智慧座艙產品專案，預算代號：115TD2601PR01，報支金額：NT$ 24,600），已檢附電子發票證明聯與明細，請審核。',
    },
  },
  {
    id: 'scenario_06_seal_request',
    code: 'S06',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '用印申請管理',
    title: '【待簽核】合約用印申請單審核與蓋印放行通知',
    actorDisplay: '劉君怡 (0070 · 營業行銷部 資深專案經理)',
    recipientDisplay: '簽核主管（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications',
    description:
      '營業行銷部資深專案經理 劉君怡 (0070) 提出《合約用印申請單》（桃園機場自駕接駁營收專案 RV2601 技術合作備忘錄 MOU 一式二份，申請合約章與騎縫章），進入簽核關卡。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '劉君怡',
      departmentName: '營業行銷部 (S&M)',
      formLabel: '合約用印申請單',
      caseNumber: '20261117CS0006',
      title: '桃園機場自駕接駁營收專案 (RV2601) 技術合作備忘錄一式二份',
      amount: '無涉金額（用印份數：2 份）',
      stepLabel: '高階主管覆核用印申請（待您簽核）',
      reason: '申請蓋用合約章及騎縫章',
      message:
        '營業行銷部 劉君怡（0070）提出「合約用印申請單 20261117CS0006」（用印文件：桃園機場自駕接駁專案 RV2601 技術合作備忘錄 MOU 一式二份，相對人：桃園國際機場股份有限公司），目前進入您的簽核關卡。',
    },
  },
  {
    id: 'scenario_07_budget_dispatch',
    code: 'S07',
    category: 'finance',
    templateId: 'budget_form_dispatched',
    moduleName: '財會與預算管理',
    title: '【預算申請派發】115 年度部門／專案預算申請單線上填寫通知',
    actorDisplay: '許雲茹 (0009 · 管理部 行政財會)',
    recipientDisplay: '預算負責人（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/my-tasks/budget',
    description:
      '管理部財會 許雲茹 (0009) 透過預算管理平台派發「115 年度部門預算表、營收/產品專案預算表 (BUDGET-115)」，可點擊信中連結直接進入「我的待辦 ➔ 年度預算表填報」線上填寫並即時自動儲存。',
    vars: {
      recipientName: '預算負責人',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '許雲茹',
      departmentName: '管理部 (AD)',
      formLabel: '預算申請單',
      caseNumber: 'BUDGET-115',
      title: '115 年度部門預算表、營收/產品專案預算表',
      amount: '年度預算編列作業',
      stepLabel: '部門主管／專案負責人線上編列',
      reason: '115 會計年度預算編列期程',
      message:
        '【115 年度預算編列通知】由 管理部財會 許雲茹 (0009) 派發：請於截止日前完成「部門預算表、營收/產品專案預算表」填報。請前往「我的待辦 → 年度預算表填報（/my-tasks/budget）」線上填寫《預算申請單》（系統支援即時自動暫存，可隨時關閉並接續填寫）。',
    },
  },
  {
    id: 'scenario_08_asset_inventory',
    code: 'S08',
    category: 'asset',
    templateId: 'asset_inventory_dispatched',
    moduleName: '資產管理與財產盤點',
    title: '【財產盤點通知】派發【財產清點單】至保管人進行線上盤點確認',
    actorDisplay: '許雲茹 (0009 · 管理部 財產清點人)',
    recipientDisplay: '資產保管人（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/assets/mine',
    description:
      '財產清點人 許雲茹 (0009) 為資產保管人排定年度財產盤點，派發【財產清點單】，請保管人至「我的資產管理 (/assets/mine)」逐一核對名下保管財產之狀態、數量與存放位置。',
    vars: {
      recipientName: '資產保管人',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '許雲茹',
      departmentName: '管理部 (AD)',
      formLabel: '財產清點單',
      caseNumber: 'INV-20261117-0001',
      title: '財產清點單 INV-20261117-0001',
      amount: '名下保管資產清點',
      stepLabel: '第一階段：保管人線上清點確認',
      reason: '115 年度定期財產盤點作業',
      message:
        '【財產盤點通知】財產清點人 許雲茹 (0009) 已為您派發【財產清點單 INV-20261117-0001】。請前往「我的資產管理（/assets/mine）」點開該張財產清點單，逐筆確認名下保管資產狀態與存放位置；雙方確認完成後將自動封存至財產清單紀錄。',
    },
  },
  {
    id: 'scenario_09_asset_transfer',
    code: 'S09',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '資產管理與財產盤點',
    title: '【待簽核】跨部門財產保管人移轉與接收簽核通知',
    actorDisplay: '阮振瑋 (0017 · 原保管人) ／ 楊為任 (0053 · 原部門主管)',
    recipientDisplay: '新保管人（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/assets/transfers',
    description:
      '自動駕駛系統部 阮振瑋 (0017) 發起《資產異動申請單》，將車載光達測試設備移轉予新保管人進行跨部門接收確認，簽核鏈涵蓋原保管人 ➔ 原主管 楊為任 (0053) ➔ 新保管人 ➔ 新主管 ➔ 總務 汪怡伶 (0075)。',
    vars: {
      recipientName: '新保管人',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '資產異動申請單',
      caseNumber: '20261117AT0009',
      title: 'Velodyne VLP-16 光達感測器 (TD-ADS-EQ-0002) 保管人移轉案',
      amount: '資產數量：1 組',
      stepLabel: '新保管人接收確認簽核（待您簽核）',
      reason: '跨部門專案實車測試設備調撥移轉',
      message:
        '自動駕駛系統部 阮振瑋（0017）已送出「資產異動申請單 20261117AT0009」，申請將財產「TD-ADS-EQ-0002 Velodyne VLP-16 光達感測器」移轉至您的名下保管，請確認設備點交狀態並進行簽核。',
    },
  },
  {
    id: 'scenario_10_company_announcement',
    code: 'S10',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: '簽核與表單流程',
    title: '【待簽核】一般用印申請單送出待審核通知',
    actorDisplay: '吳旭東 (0065 · 管理部 協理)',
    recipientDisplay: '簽核主管（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/applications',
    description:
      '管理部協理 吳旭東 (0065) 提出《一般用印申請單》（高鐵自駕場域道路測試路權申請公文用印），進入簽核關卡。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '吳旭東',
      departmentName: '管理部 (AD)',
      formLabel: '一般用印申請單',
      caseNumber: '20261117GS0010',
      title: '高鐵自駕場域道路測試路權申請公文用印案',
      amount: '用印份數：1 份',
      stepLabel: '高階主管覆核（待您簽核）',
      reason: '主管機關公文送件用印',
      message:
        '管理部協理 吳旭東（0065）提出「一般用印申請單 20261117GS0010」（用印文件：高鐵自駕場域道路測試路權申請公文），目前進入您的簽核關卡。',
    },
  },
  {
    id: 'scenario_11_ai_nudge_reminder',
    code: 'S11',
    category: 'approval',
    templateId: 'approval_requested',
    moduleName: 'AI 智慧助手協作',
    title: '【催簽提醒】申請人透過 AI 智慧助手發送急件禮貌催簽通知',
    actorDisplay: '阮振瑋 (0017 · 透過 AI 智慧助手發起催簽)',
    recipientDisplay: '目前關卡簽核人（測試白名單信箱）',
    recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
    expectedStatus: 'sent',
    systemPath: '/tools/ai-chat',
    description:
      '申請人 阮振瑋 (0017) 於 ACCSYS AI 助手對話框使用「催簽提醒（Nudge）」功能，針對急需出差之單據向目前關卡簽核人發送每日限一次之禮貌催簽通知信。',
    vars: {
      recipientName: '簽核主管',
      recipientEmail: HARD_LOCKED_TEST_RECIPIENT,
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '公出差旅申請單（急件催簽）',
      caseNumber: '20261117BT0013',
      title: '【AI 助手禮貌催簽】新竹竹北高鐵自駕場域光達道路實測與 V2X 聯調出差案',
      amount: 'NT$ 3,600',
      stepLabel: '高階主管覆核（待您簽核）',
      reason: '明日上午需出發前往新竹竹北高鐵自駕測試場域，懇請優先協助審核',
      message:
        '【催簽提醒】申請人 阮振瑋（0017）透過 ACCSYS AI 智慧助手發送禮貌提醒：公出差旅申請單 20261117BT0013（新竹竹北高鐵自駕場域光達道路實測與車聯網 V2X 聯調）因出發在即，仍待您進行簽核確認。',
    },
  },
  {
    id: 'scenario_12_safety_guard_block',
    code: 'S12',
    category: 'system',
    templateId: 'approval_requested',
    moduleName: '資安白名單防線驗證',
    title: '【安全防線攔截驗證】嘗試寄往非白名單信箱 (wayne@turing-drive.com) 自動攔截測試',
    actorDisplay: '系統自動安全防線 (Recipient Safety Guard)',
    recipientDisplay: '阮振瑋 (0017 · wayne@turing-drive.com) — 預期自動攔截不寄出',
    recipientEmail: 'wayne@turing-drive.com',
    expectedStatus: 'blocked_by_test_guard',
    systemPath: '/admin/email-settings',
    description:
      '驗證在測試模式下，當系統產生寄往非白名單信箱（如 阮振瑋 wayne@turing-drive.com）的信件時，第一道安全防線是否 100% 自動攔截並寫入攔截紀錄。',
    vars: {
      recipientName: '阮振瑋',
      recipientEmail: 'wayne@turing-drive.com',
      applicantName: '阮振瑋',
      departmentName: '自動駕駛系統部 (ADS)',
      formLabel: '請購單（防線攔截測試）',
      caseNumber: 'GUARD-TEST-0017',
      title: '測試階段非白名單信箱自動攔截驗證',
      amount: 'NT$ 15,000',
      stepLabel: '部門主管簽核',
      reason: '驗證非白名單信箱必定被攔截',
      message:
        '此為資安防線驗證情境：收件人為 wayne@turing-drive.com（非白名單信箱），系統必須強制攔截此信件並記錄 status = blocked_by_test_guard。',
    },
  },
];

/**
 * 執行單一工作情境信箱通知測試（不於資料庫自動塞入任何特定員工的假單據或待辦）
 */
export async function executeWorkScenarioWithEmail(
  scenarioId: string,
  _options?: {
    createDbRecords?: boolean;
  }
): Promise<WorkScenarioExecutionResult> {
  const scenario = WORK_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    throw new Error(`找不到指定的工作情境：${scenarioId}`);
  }

  const config = await getEmailSystemConfig();
  const tpl =
    config.templates.find((t) => t.id === scenario.templateId) ??
    config.templates[0];

  const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3001';
  const resolvedActionUrl = `${appOrigin}${scenario.systemPath}`;
  const targetEmail =
    scenario.expectedStatus === 'sent'
      ? config.allowedTestRecipients[0] || scenario.recipientEmail
      : scenario.recipientEmail;

  const fullVars: Record<string, string> = {
    ...scenario.vars,
    recipientEmail: targetEmail,
    actionUrl: resolvedActionUrl,
    companyName: '台灣智慧駕駛股份有限公司 (TURING DRIVE)',
    documentDetailsHtml: '',
    documentDetailsText: '',
    approvalActionsHtml: '',
    approvalActionsText: '',
  };

  let subject = tpl
    ? renderTemplateString(tpl.subjectTemplate, fullVars)
    : `【${scenario.moduleName}】${scenario.title}`;
  if (scenario.id === 'scenario_11_ai_nudge_reminder' && !subject.includes('催簽')) {
    subject = `【AI 催簽提醒】${subject}`;
  }

  const text = tpl
    ? renderTemplateString(tpl.bodyTextTemplate, fullVars)
    : scenario.vars.message;
  const html = tpl?.bodyHtmlTemplate
    ? renderTemplateString(tpl.bodyHtmlTemplate, fullVars)
    : undefined;

  const sendRes = await sendViaGmailServiceAccount(
    {
      to: targetEmail,
      subject,
      text,
      html,
      templateId: scenario.templateId,
    },
    config
  );

  const passed = sendRes.status === scenario.expectedStatus;

  return {
    scenarioId: scenario.id,
    code: scenario.code,
    title: scenario.title,
    moduleName: scenario.moduleName,
    templateId: scenario.templateId,
    recipientEmail: targetEmail,
    expectedStatus: scenario.expectedStatus,
    actualStatus: sendRes.status,
    passed,
    subject,
    caseNumber: scenario.vars.caseNumber,
    gmailMessageId: sendRes.gmailMessageId,
    delegatedUser: sendRes.delegatedUser,
    dbRecordSummary: '僅發送信箱通知測試（不寫入特定人員單據資料）',
    note: sendRes.reason,
  };
}

/**
 * 批次執行全系統 12 大工作情境信箱通知測試
 */
export async function executeAllWorkScenariosWithEmail(): Promise<{
  total: number;
  passedCount: number;
  sentCount: number;
  blockedByGuardCount: number;
  results: WorkScenarioExecutionResult[];
}> {
  const results: WorkScenarioExecutionResult[] = [];
  for (const scenario of WORK_SCENARIOS) {
    const r = await executeWorkScenarioWithEmail(scenario.id, {
      createDbRecords: false,
    });
    results.push(r);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const sentCount = results.filter((r) => r.actualStatus === 'sent').length;
  const blockedByGuardCount = results.filter(
    (r) => r.actualStatus === 'blocked_by_test_guard'
  ).length;

  return {
    total: results.length,
    passedCount,
    sentCount,
    blockedByGuardCount,
    results,
  };
}
