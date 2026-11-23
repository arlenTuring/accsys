'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import type { PublicEmailSystemConfig } from '@/lib/email/config';
import {
  COMMON_EMAIL_VARIABLES,
  renderTemplateString,
  type EmailCategoryKey,
  type EmailCategoryMeta,
  type EmailTemplateDefinition,
} from '@/lib/email/templates';
import {
  resetEmailTemplateToDefaultAction,
  runAllWorkScenariosEmailAction,
  runSingleWorkScenarioEmailAction,
  sendTestEmailAction,
  updateEmailConnectionSettingsAction,
  updateEmailTemplatesAction,
} from './actions';
import type {
  WorkScenarioDefinition,
  WorkScenarioExecutionResult,
} from '@/lib/email/work-scenarios';

type Props = {
  initialConfig: PublicEmailSystemConfig;
  categories: EmailCategoryMeta[];
  viewerEmail: string;
  scenarios: WorkScenarioDefinition[];
};

type ActiveTab = 'connection' | 'templates' | 'scenarios' | 'logs';

export function EmailSettingsClient({
  initialConfig,
  categories,
  viewerEmail,
  scenarios: WORK_SCENARIOS,
}: Props) {
  const [config, setConfig] = useState<PublicEmailSystemConfig>(initialConfig);
  const [activeTab, setActiveTab] = useState<ActiveTab>('connection');
  const [isPending, startTransition] = useTransition();
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Tab 1: Connection & Token File state
  const [enabled, setEnabled] = useState(config.enabled);
  const [delegatedUser, setDelegatedUser] = useState(config.delegatedUser);
  const [displayFromEmail, setDisplayFromEmail] = useState(
    config.displayFromEmail
  );
  const [displayFromName, setDisplayFromName] = useState(config.displayFromName);
  const [testModeOnly, setTestModeOnly] = useState(config.testModeOnly);
  const [allowedRecipientInput, setAllowedRecipientInput] = useState(
    config.allowedTestRecipients.join(', ')
  );
  const [serviceAccountJsonInput, setServiceAccountJsonInput] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Test email state
  const [testRecipient, setTestRecipient] = useState(
    config.allowedTestRecipients[0] || ''
  );
  const [testTemplateId, setTestTemplateId] = useState(
    config.templates[0]?.id || 'approval_requested'
  );

  // Tab 2: Templates state
  const [selectedCategory, setSelectedCategory] = useState<
    EmailCategoryKey | 'all'
  >('all');
  const [templatesDraft, setTemplatesDraft] = useState<
    EmailTemplateDefinition[]
  >(config.templates);
  const [activeTemplateId, setActiveTemplateId] = useState<string>(
    config.templates[0]?.id || 'approval_requested'
  );
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html');
  const [scenarioResults, setScenarioResults] = useState<
    Record<string, WorkScenarioExecutionResult>
  >({});

  const activeTemplate = useMemo(
    () =>
      templatesDraft.find((t) => t.id === activeTemplateId) ??
      templatesDraft[0],
    [templatesDraft, activeTemplateId]
  );

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === 'all') return templatesDraft;
    return templatesDraft.filter((t) => t.category === selectedCategory);
  }, [templatesDraft, selectedCategory]);

  const sampleVarsMap = useMemo(() => {
    const map: Record<string, string> = {
      message:
        '阮振瑋（自動駕駛系統部）提出「公出差旅申請單 20261117BT0001」（事由：赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調），目前進入您的簽核關卡。',
      documentDetailsText:
        '【單據欄位明細】\n・申請總額：NT$ 3,600\n・出差時間：2026/11/19 08:30 ～ 2026/11/19 18:30\n・出差地點：新竹縣竹北市（高鐵自駕測試場域）\n・出差事由：赴新竹竹北進行自駕巴士場域光達道路實測與車聯網 V2X 聯調\n\n【簽核流程進度】\n  第 1 關｜申請部門主管簽核（楊為任）— ✓ 已核准\n  第 2 關｜高階主管覆核（沈大維）— ● 待您簽核',
      approvalActionsText:
        '・準許簽核：http://localhost:3001/email-approval?intent=approve\n・簽核退回：http://localhost:3001/email-approval?intent=return',
    };
    for (const v of COMMON_EMAIL_VARIABLES) {
      map[v.key] = v.sample;
    }
    if (activeTemplate?.id === 'request_approved') {
      map.formLabel = '請購單';
      map.caseNumber = '20261117PR0002';
      map.applicantName = '阮振瑋';
      map.departmentName = '自動駕駛系統部 (ADS)';
      map.stepLabel = '✓ 已完成全部關卡決行核准';
      map.message =
        '您申請的「請購單 20261117PR0002」（品項：車載邊緣運算 IPC 模組 2 組，預算編號：115ADSSE15，總金額 NT$ 86,000）已完成最終簽核並正式核准。';
      map.documentDetailsHtml = map.documentDetailsHtml
        .replace('● 目前關卡（待簽核）', '✓ 已核准')
        .replace('#dbeafe;color:#1e40af;border:1px solid #93c5fd', '#ecfdf5;color:#047857;border:1px solid #a7f3d0')
        .replace('background: #eff6ff;', '');
      map.approvalActionsHtml = '';
      map.approvalActionsText = '';
    } else if (activeTemplate?.id === 'request_returned') {
      map.formLabel = '採購單';
      map.caseNumber = '20261117PO0003';
      map.applicantName = '阮振瑋';
      map.departmentName = '自動駕駛系統部 (ADS)';
      map.stepLabel = '管理部財會覆核（許雲茹）';
      map.reason =
        '單筆採購金額逾 5 萬元，請補附第二家供應商比價報價單，並於備註欄註明原廠保固年限後重新送簽。';
      map.message =
        '管理部行政財會 許雲茹 已將您的「採購單 20261117PO0003」退回修正。';
      map.documentDetailsHtml = map.documentDetailsHtml
        .replace('● 目前關卡（待簽核）', '↩ 已退回')
        .replace('#dbeafe;color:#1e40af;border:1px solid #93c5fd', '#fff1f2;color:#be123c;border:1px solid #fecdd3')
        .replace('background: #eff6ff;', 'background: #fff1f2;');
      map.approvalActionsHtml = '';
      map.approvalActionsText = '';
    } else if (activeTemplate?.id === 'budget_form_dispatched') {
      map.formLabel = '預算申請單';
      map.caseNumber = 'BUDGET-115';
      map.title = '115 年度部門預算表、營收/產品專案預算表';
      map.applicantName = '許雲茹';
      map.departmentName = '管理部 (AD)';
      map.message =
        '請於截止日前完成「115 年度部門預算表、營收/產品專案預算表」線上填報（支援即時自動暫存）。';
      map.approvalActionsHtml = '';
      map.approvalActionsText = '';
    } else if (activeTemplate?.id === 'asset_inventory_dispatched') {
      map.formLabel = '財產清點單';
      map.caseNumber = 'INV-20261117-0054-001';
      map.title = '財產清點單 INV-20261117-0054-001';
      map.applicantName = '許雲茹';
      map.departmentName = '管理部 (AD)';
      map.message =
        '請至「我的資產管理」點開此張財產清點單，逐筆確認名下保管資產狀態與存放位置。';
      map.approvalActionsHtml = '';
      map.approvalActionsText = '';
    }
    return map;
  }, [activeTemplate?.id]);

  const renderedPreview = useMemo(() => {
    if (!activeTemplate) return { subject: '', text: '', html: '' };
    return {
      subject: renderTemplateString(
        activeTemplate.subjectTemplate,
        sampleVarsMap
      ),
      text: renderTemplateString(
        activeTemplate.bodyTextTemplate,
        sampleVarsMap
      ),
      html: renderTemplateString(
        activeTemplate.bodyHtmlTemplate,
        sampleVarsMap
      ),
    };
  }, [activeTemplate, sampleVarsMap]);

  function handleJsonFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setServiceAccountJsonInput(content);
      setUploadedFileName(file.name);
      setBanner({
        type: 'success',
        text: `已讀取憑證金鑰檔案「${file.name}」，請點擊下方「儲存信箱與金鑰設定」完成套用。`,
      });
    };
    reader.readAsText(file);
  }

  function handleSaveConnection(e: React.FormEvent) {
    e.preventDefault();
    setBanner(null);
    const recipients = allowedRecipientInput
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    startTransition(async () => {
      const res = await updateEmailConnectionSettingsAction({
        enabled,
        delegatedUser,
        displayFromEmail,
        displayFromName,
        testModeOnly,
        allowedTestRecipients: recipients,
        serviceAccountJsonInput: serviceAccountJsonInput.trim() || undefined,
      });
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      setConfig(res.config);
      setServiceAccountJsonInput('');
      setUploadedFileName(null);
      setBanner({ type: 'success', text: res.message });
    });
  }

  function handleSendTestEmail() {
    setBanner(null);
    startTransition(async () => {
      const res = await sendTestEmailAction({
        recipientEmail: testRecipient,
        templateId: testTemplateId,
      });
      setConfig(res.config);
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      setBanner({ type: 'success', text: res.message });
    });
  }

  function updateActiveTemplateField(
    patch: Partial<
      Pick<
        EmailTemplateDefinition,
        'enabled' | 'subjectTemplate' | 'bodyTextTemplate' | 'bodyHtmlTemplate'
      >
    >
  ) {
    if (!activeTemplate) return;
    setTemplatesDraft((prev) =>
      prev.map((t) => (t.id === activeTemplate.id ? { ...t, ...patch } : t))
    );
  }

  function insertVariableIntoActiveSubject(varKey: string) {
    if (!activeTemplate) return;
    updateActiveTemplateField({
      subjectTemplate: `${activeTemplate.subjectTemplate}{{${varKey}}}`,
    });
  }

  function insertVariableIntoActiveBody(varKey: string) {
    if (!activeTemplate) return;
    updateActiveTemplateField({
      bodyTextTemplate: `${activeTemplate.bodyTextTemplate}{{${varKey}}}`,
    });
  }

  function handleSaveTemplates() {
    setBanner(null);
    startTransition(async () => {
      const res = await updateEmailTemplatesAction({
        templates: templatesDraft.map((t) => ({
          id: t.id,
          enabled: t.enabled,
          subjectTemplate: t.subjectTemplate,
          bodyTextTemplate: t.bodyTextTemplate,
          bodyHtmlTemplate: t.bodyHtmlTemplate,
        })),
      });
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      setConfig(res.config);
      setTemplatesDraft(res.config.templates);
      setBanner({ type: 'success', text: res.message });
    });
  }

  function handleResetSingleTemplate(templateId: string) {
    setBanner(null);
    startTransition(async () => {
      const res = await resetEmailTemplateToDefaultAction(templateId);
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      setConfig(res.config);
      setTemplatesDraft(res.config.templates);
      setBanner({ type: 'success', text: res.message });
    });
  }

  function handleRunSingleScenario(scenarioId: string) {
    setBanner(null);
    startTransition(async () => {
      const res = await runSingleWorkScenarioEmailAction(scenarioId);
      setConfig(res.config);
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      setScenarioResults((prev) => ({
        ...prev,
        [res.result.scenarioId]: res.result,
      }));
      setBanner({ type: 'success', text: res.message });
    });
  }

  function handleRunAllScenarios() {
    setBanner(null);
    startTransition(async () => {
      const res = await runAllWorkScenariosEmailAction();
      setConfig(res.config);
      if (!res.ok) {
        setBanner({ type: 'error', text: res.error });
        return;
      }
      const nextMap: Record<string, WorkScenarioExecutionResult> = {};
      for (const item of res.summary.results) {
        nextMap[item.scenarioId] = item;
      }
      setScenarioResults(nextMap);
      setBanner({ type: 'success', text: res.message });
    });
  }

  return (
    <div className="space-y-6">
      {/* 測試期間嚴格白名單安全防線警示卡 */}
      <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/90 p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white">
              🔒
            </span>
            <div>
              <h2 className="text-sm font-bold text-amber-950">
                測試模式安全防線已啟動（僅限發送至指定測試信箱）
              </h2>
              <p className="mt-0.5 text-xs text-amber-900">
                目前系統所有簽核、採購、預算派發與財產盤點通知信，<strong>只會實際發送給白名單信箱</strong>（預設鎖定為{' '}
                <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-amber-950 ring-1 ring-amber-300">
                  {config.allowedTestRecipients.join(', ')}
                </code>
                ）。任何寄往其他同仁的信件皆會在伺服器端自動攔截並記錄於發信日誌，<strong>絕不會寄給您以外的人</strong>。
              </p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-2xs">
            {config.hasServiceAccountKey ? '✓ Service Account 金鑰已就緒' : '尚未設定金鑰'}
          </span>
        </div>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm font-medium ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* 頂部切換頁籤 */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('connection')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === 'connection'
              ? 'bg-td-blue text-white shadow-xs'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          1. 憑證金鑰 (Token) 與指定寄件信箱
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === 'templates'
              ? 'bg-td-blue text-white shadow-xs'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          2. 系統功能分類與信箱內容模板 ({templatesDraft.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('scenarios')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === 'scenarios'
              ? 'bg-td-blue text-white shadow-xs'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          3. 全系統工作情境模擬與信箱實測 ({WORK_SCENARIOS.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            activeTab === 'logs'
              ? 'bg-td-blue text-white shadow-xs'
              : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          4. 發信與安全攔截紀錄 ({config.recentLogs.length})
        </button>
      </div>

      {/* TAB 1: 憑證金鑰與指定寄件信箱 */}
      {activeTab === 'connection' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <form
            onSubmit={handleSaveConnection}
            className="card space-y-5 p-6 lg:col-span-2"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold text-td-blue-dark">
                  Google Service Account 憑證與寄件信箱設定
                </h2>
                <p className="mt-0.5 text-xs text-td-muted">
                  上傳或貼上 Google Cloud 服務帳戶 JSON 金鑰，並指定委派發信的網域信箱位置。
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-td-blue-dark">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-td-blue"
                />
                啟用 Gmail API 發信
              </label>
            </div>

            {/* 目前已掛載的金鑰資訊摘要 */}
            {config.serviceAccountSummary && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-xs">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-bold text-td-blue-dark">
                    目前伺服器已掛載之 Service Account 憑證
                  </span>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-800">
                    Active
                  </span>
                </div>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">GCP Project ID</dt>
                    <dd className="font-mono font-semibold text-slate-800">
                      {config.serviceAccountSummary.projectId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Service Account Email</dt>
                    <dd className="truncate font-mono font-semibold text-slate-800">
                      {config.serviceAccountSummary.clientEmail}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Client ID (Domain-Wide Delegation)</dt>
                    <dd className="font-mono font-semibold text-slate-800">
                      {config.serviceAccountSummary.clientId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Private Key ID / OAuth Scope</dt>
                    <dd className="truncate font-mono text-slate-700">
                      {config.serviceAccountSummary.privateKeyId} · gmail.send
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* 1. 輸入或上傳 Token JSON 檔案 */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="block text-sm font-semibold text-td-blue-dark">
                  1. 服務帳戶憑證金鑰檔案（Service Account Token .json）
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleJsonFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-td-blue bg-white px-3 py-1.5 text-xs font-semibold text-td-blue transition hover:bg-td-blue-light"
                  >
                    📂 選擇上傳 .json 金鑰檔案
                  </button>
                  {uploadedFileName && (
                    <span className="text-xs font-medium text-emerald-700">
                      已載入：{uploadedFileName}
                    </span>
                  )}
                </div>
              </div>
              <textarea
                rows={5}
                value={serviceAccountJsonInput}
                onChange={(e) => setServiceAccountJsonInput(e.target.value)}
                placeholder={
                  config.hasServiceAccountKey
                    ? '目前已掛載有效金鑰（基於資安考量不回顯私鑰內容）。若需更換金鑰，請點擊右上角「選擇上傳 .json 金鑰檔案」或直接在此貼上新的 JSON 內容...'
                    : '請貼上 Google Service Account .json 完整內容，或點擊上方按鈕上傳檔案...'
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-xs text-slate-800 focus:border-td-blue focus:outline-none"
              />
            </div>

            {/* 2. 指定寄件信箱位置 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-td-blue-dark">
                  2. 委派發信信箱位置（DELEGATED_USER）
                </label>
                <p className="mb-1.5 text-[11px] text-td-muted">
                  須為 Google Workspace 網域內實際存在的帳號或別名（如{' '}
                  <code>turing-drive_mis@turing-drive.com</code> 或{' '}
                  <code>no-reply@turing-drive.com</code>）
                </p>
                <input
                  type="email"
                  required
                  value={delegatedUser}
                  onChange={(e) => setDelegatedUser(e.target.value)}
                  placeholder="no-reply@turing-drive.com"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-sm focus:border-td-blue focus:outline-none"
                />
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[
                    'turing-drive_mis@turing-drive.com',
                    'deploy@turing-drive.com',
                    'no-reply@turing-drive.com',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDelegatedUser(preset)}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-slate-100"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-td-blue-dark">
                  顯示寄件者信箱與名稱（From Header）
                </label>
                <p className="mb-1.5 text-[11px] text-td-muted">
                  收件者在信箱內看到的寄件者顯示名稱與信箱標頭
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={displayFromName}
                    onChange={(e) => setDisplayFromName(e.target.value)}
                    placeholder="TURING DRIVE ACCSYS 系統通知"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-td-blue focus:outline-none"
                  />
                  <input
                    type="email"
                    value={displayFromEmail}
                    onChange={(e) => setDisplayFromEmail(e.target.value)}
                    placeholder="no-reply@turing-drive.com"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 font-mono text-xs text-slate-700 focus:border-td-blue focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* 3. 測試期間收件人安全限制 */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-bold text-amber-950">
                  <input
                    type="checkbox"
                    checked={testModeOnly}
                    onChange={(e) => setTestModeOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-amber-400 text-amber-600"
                  />
                  強制啟用「測試階段白名單限制」（嚴禁發送給白名單以外的任何人）
                </label>
                <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-950">
                  測試保護中
                </span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-amber-900">
                  唯一允許收信的測試信箱（目前鎖定為您的信箱）：
                </label>
                <input
                  type="text"
                  value={allowedRecipientInput}
                  onChange={(e) => setAllowedRecipientInput(e.target.value)}
                  placeholder="test-recipient@turing-drive.com"
                  className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-mono text-xs font-bold text-slate-900"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {isPending ? '儲存中...' : '儲存信箱與金鑰設定'}
              </button>
            </div>
          </form>

          {/* 右側：即時發送測試信卡片 */}
          <div className="card flex flex-col justify-between space-y-5 p-6">
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-td-blue-dark">
                  🧪 立即發送測試信
                </h3>
                <p className="mt-0.5 text-xs text-td-muted">
                  選擇任一系統功能模板，立即透過 Google Service Account 發送測試郵件至您的信箱。
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  測試收件人信箱（僅限您的信箱）
                </label>
                <input
                  type="email"
                  value={testRecipient}
                  onChange={(e) => setTestRecipient(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold text-slate-900"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  若輸入非白名單信箱，可測試系統防線是否正確攔截。目前的登入帳號為{' '}
                  <code>{viewerEmail}</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  套用測試模板樣式
                </label>
                <select
                  value={testTemplateId}
                  onChange={(e) => setTestTemplateId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                >
                  {templatesDraft.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} ({tpl.id})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleSendTestEmail}
                disabled={isPending}
                className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? '發送測試信中...' : '🚀 發送測試信到我的信箱'}
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-600 space-y-1.5">
              <p className="font-bold text-slate-800">💡 架構與資安說明</p>
              <p>
                • 採用 Google 官方 <code>google-auth-library</code> JWT 委派（Impersonate）機制。
              </p>
              <p>
                • 權限範圍僅限{' '}
                <code className="text-[11px]">gmail.send</code>，無法讀取任何信件或刪除郵件。
              </p>
              <p>
                • 若指定之 <code>no-reply@turing-drive.com</code> 尚未於 Google Admin 建立信箱或別名，系統會自動透過網域授權帳號代發並保留顯示標頭。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 系統功能分類與信箱內容模板 */}
      {activeTab === 'templates' && (
        <div className="space-y-5">
          {/* 功能分類篩選列 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              全部系統功能 ({templatesDraft.length})
            </button>
            {categories.map((cat) => {
              const count = templatesDraft.filter(
                (t) => t.category === cat.key
              ).length;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.key);
                    const firstInCat = templatesDraft.find(
                      (t) => t.category === cat.key
                    );
                    if (firstInCat) setActiveTemplateId(firstInCat.id);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    selectedCategory === cat.key
                      ? 'bg-td-blue text-white'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {cat.title} ({count})
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* 左側：模板清單 */}
            <div className="space-y-2.5 lg:col-span-4">
              {filteredTemplates.map((tpl) => {
                const catMeta = categories.find((c) => c.key === tpl.category);
                const isSelected = tpl.id === activeTemplate?.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setActiveTemplateId(tpl.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      isSelected
                        ? 'border-td-blue bg-blue-50/40 shadow-xs ring-1 ring-td-blue'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                          catMeta?.badgeColor ||
                          'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {catMeta?.title || tpl.category}
                      </span>
                      <span
                        className={`text-[11px] font-bold ${
                          tpl.enabled ? 'text-emerald-600' : 'text-slate-400'
                        }`}
                      >
                        {tpl.enabled ? '● 啟用中' : '○ 已停用'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-td-blue-dark">
                      {tpl.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {tpl.description}
                    </p>
                    <p className="mt-2 truncate font-mono text-[11px] text-slate-400">
                      觸發：{tpl.triggerEvent}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* 右側：模板編輯器與即時預覽 */}
            {activeTemplate && (
              <div className="card space-y-5 p-6 lg:col-span-8">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-td-blue-dark">
                        {activeTemplate.name}
                      </h3>
                      <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                        {activeTemplate.id}
                      </code>
                    </div>
                    <p className="mt-1 text-xs text-td-muted">
                      {activeTemplate.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={activeTemplate.enabled}
                        onChange={(e) =>
                          updateActiveTemplateField({
                            enabled: e.target.checked,
                          })
                        }
                        className="h-4 w-4 rounded border-slate-300 text-td-blue"
                      />
                      啟用此通知模板
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        handleResetSingleTemplate(activeTemplate.id)
                      }
                      disabled={isPending}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      還原預設樣板
                    </button>
                  </div>
                </div>

                {/* 可用動態變數膠囊列 */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <p className="mb-2 text-xs font-bold text-slate-700">
                    ✨ 點擊插入動態變數（點擊下方標籤可插入至信件內文）：
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_EMAIL_VARIABLES.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => insertVariableIntoActiveBody(v.key)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          insertVariableIntoActiveSubject(v.key);
                        }}
                        title={`範例值：${v.sample}（左鍵插入內文，右鍵插入主旨）`}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-2xs transition hover:border-td-blue hover:text-td-blue"
                      >
                        <span className="font-mono text-[11px] font-bold text-td-blue">
                          {`{{${v.key}}}`}
                        </span>{' '}
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 信件主旨模板 */}
                <div>
                  <label className="block text-xs font-bold text-td-blue-dark">
                    信件主旨模板（Subject）
                  </label>
                  <input
                    type="text"
                    value={activeTemplate.subjectTemplate}
                    onChange={(e) =>
                      updateActiveTemplateField({
                        subjectTemplate: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-900 focus:border-td-blue focus:outline-none"
                  />
                </div>

                {/* 純文字與 HTML 模板編輯 */}
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-td-blue-dark">
                      純文字內文模板（Plain Text）
                    </label>
                    <textarea
                      rows={9}
                      value={activeTemplate.bodyTextTemplate}
                      onChange={(e) =>
                        updateActiveTemplateField({
                          bodyTextTemplate: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-td-blue focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-td-blue-dark">
                      HTML 樣式內文模板（Rich HTML）
                    </label>
                    <textarea
                      rows={9}
                      value={activeTemplate.bodyHtmlTemplate}
                      onChange={(e) =>
                        updateActiveTemplateField({
                          bodyHtmlTemplate: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-td-blue focus:outline-none"
                    />
                  </div>
                </div>

                {/* 即時渲染預覽區 */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-td-blue-dark">
                        👁️ 信件即時預覽
                      </span>
                      <p className="mt-0.5 text-xs font-semibold text-slate-700">
                        主旨：{renderedPreview.subject}
                      </p>
                    </div>
                    <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1">
                      <button
                        type="button"
                        onClick={() => setPreviewMode('html')}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                          previewMode === 'html'
                            ? 'bg-white text-td-blue-dark shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        HTML 視覺樣式
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode('text')}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                          previewMode === 'text'
                            ? 'bg-white text-td-blue-dark shadow-2xs'
                            : 'text-slate-600'
                        }`}
                      >
                        純文字預覽
                      </button>
                    </div>
                  </div>

                  {previewMode === 'html' ? (
                    <div
                      className="rounded-xl bg-white p-4 shadow-2xs"
                      dangerouslySetInnerHTML={{ __html: renderedPreview.html }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-xl bg-white p-4 font-sans text-xs leading-relaxed text-slate-800 shadow-2xs">
                      {renderedPreview.text}
                    </pre>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setTestTemplateId(activeTemplate.id);
                      handleSendTestEmail();
                    }}
                    disabled={isPending}
                    className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    ✉️ 以此模板發送測試信至 {testRecipient}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTemplates}
                    disabled={isPending}
                    className="btn-primary px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
                  >
                    {isPending ? '儲存中...' : '儲存全部模板修改'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: 全系統工作情境模擬與信箱實測 */}
      {activeTab === 'scenarios' && (
        <div className="space-y-5">
          <div className="card flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h3 className="text-base font-bold text-td-blue-dark">
                台灣智慧駕駛 (TURING DRIVE) 全系統 12 大真實工作情境與信箱通知實測
              </h3>
              <p className="mt-1 text-xs text-td-muted">
                全數採用台灣智慧駕駛真實組織與員工帳號（阮振瑋 0017、楊為任 0053、張晏銘 0060、賴昭宇 0046、陳冠文 0032、汪怡伶 0075、許雲茹 0009、沈大維 0002、陳維隆 0001、吳旭東 0065），寄發情境通知信至目前設定之測試白名單信箱。
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunAllScenarios}
              disabled={isPending}
              className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {isPending
                ? '正在執行全系統情境與發信...'
                : '🚀 一鍵執行全系統 12 大工作情境信箱實測'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {WORK_SCENARIOS.map((sc) => {
              const catMeta = categories.find((c) => c.key === sc.category);
              const execRes = scenarioResults[sc.id];
              return (
                <div
                  key={sc.id}
                  className="card flex flex-col justify-between space-y-4 p-5"
                >
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg bg-slate-900 px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                          {sc.code}
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                            catMeta?.badgeColor ||
                            'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {sc.moduleName}
                        </span>
                      </div>
                      {execRes ? (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            execRes.passed
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {execRes.actualStatus === 'sent'
                            ? `✓ 已寄出 (${execRes.gmailMessageId ?? 'OK'})`
                            : execRes.actualStatus === 'blocked_by_test_guard'
                              ? '🛡️ 防線成功攔截'
                              : `✕ ${execRes.actualStatus}`}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-slate-400">
                          模板：{sc.templateId}
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-bold text-td-blue-dark">
                      {sc.title}
                    </h4>
                    <p className="text-xs leading-relaxed text-slate-600">
                      {sc.description}
                    </p>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-xs space-y-1">
                      <div>
                        <span className="font-semibold text-slate-500">
                          發起／簽核角色：
                        </span>
                        <span className="font-medium text-slate-800">
                          {sc.actorDisplay}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">
                          通知收件人：
                        </span>
                        <span className="font-mono font-semibold text-td-blue-dark">
                          {sc.recipientDisplay}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">
                          單號／案號：
                        </span>
                        <code className="font-mono font-bold text-slate-800">
                          {sc.vars.caseNumber}
                        </code>
                        <span className="mx-2 text-slate-300">|</span>
                        <span className="font-semibold text-slate-500">
                          金額／規模：
                        </span>
                        <span className="font-medium text-slate-800">
                          {sc.vars.amount}
                        </span>
                      </div>
                      {execRes && (
                        <div className="pt-1 text-[11px] font-medium text-emerald-700">
                          ✓ {execRes.dbRecordSummary}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                    <a
                      href={sc.systemPath}
                      className="text-xs font-semibold text-td-blue hover:underline"
                    >
                      前往系統對應頁面 ({sc.systemPath}) →
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRunSingleScenario(sc.id)}
                      disabled={isPending}
                      className="rounded-xl border border-td-blue bg-white px-3.5 py-1.5 text-xs font-bold text-td-blue transition hover:bg-td-blue hover:text-white disabled:opacity-50"
                    >
                      ✉️ 執行此情境並發信
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: 發信與安全攔截紀錄 */}
      {activeTab === 'logs' && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-base font-bold text-td-blue-dark">
              最近發信與測試防線攔截紀錄
            </h3>
            <p className="mt-0.5 text-xs text-td-muted">
              完整記錄每一筆透過 Gmail API 寄出的信件，以及因「測試白名單限制」被安全攔截的非本人信件。
            </p>
          </div>
          {config.recentLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-td-muted">
              目前尚無發信或攔截紀錄。可點擊第一頁籤的「發送測試信到我的信箱」進行驗證。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">時間</th>
                    <th className="px-4 py-3 font-semibold">狀態</th>
                    <th className="px-4 py-3 font-semibold">原始收件人</th>
                    <th className="px-4 py-3 font-semibold">委派發信帳號</th>
                    <th className="px-4 py-3 font-semibold">信件主旨</th>
                    <th className="px-4 py-3 font-semibold">詳細說明 / Gmail ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {config.recentLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-slate-500">
                        {new Date(log.timestamp).toLocaleString('zh-TW')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {log.status === 'sent' && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-800">
                            ✓ 已寄出
                          </span>
                        )}
                        {log.status === 'blocked_by_test_guard' && (
                          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-900">
                            🛡️ 測試防線攔截
                          </span>
                        )}
                        {log.status === 'failed' && (
                          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 font-bold text-rose-800">
                            ✕ 發送失敗
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800">
                        {log.originalRecipient}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {log.delegatedUser}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {log.subject}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.note || log.gmailMessageId || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
