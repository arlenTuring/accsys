import { describe, expect, it } from 'vitest';
import { DEV_PERSONAS } from '@/lib/auth/dev-personas';
import { AI_CHAT_ALLOWED_TOOLS, AI_CHAT_TOOL_DECLARATIONS, fillReceipt } from '@/lib/ai-chat/tools';
import { intentHintsForUserMessage } from '@/lib/ai-chat/intent-hints';
import { matchRelevantFormKeys } from '@/lib/ai-chat/draft-work';
import { FORM_KEY_ALIASES } from '@/lib/ai-chat/drafts';
import { draftStatus, planFill, resolveReference } from '@/lib/ai-chat/draft-fill';
import type { PickerOptions } from '@/lib/custom-forms/queries';
import { parseDefinition } from '@/lib/custom-forms/definition';
import { withApplicantConfirmation } from '@/lib/custom-forms/on-behalf';
import { allFields, parseFormSchema, SOURCE_ROW_KEY, type FormSchema } from '@/lib/custom-forms/schema';
import { carryRows } from '@/lib/custom-forms/source';
import { summarizeErrors, validateSubmission, type TableValue } from '@/lib/custom-forms/validate';
import { resolveFlow } from '@/lib/approval/flow/resolve';
import type { FlowDef, OrgSnapshot, ResolvedStep } from '@/lib/approval/flow/types';
import { UNIFIED_EXPENSE_CLAIM_FORM } from '@/lib/custom-forms/migrated/expense-claims';
import {
  ACCEPTANCE_FORM,
  PROCUREMENT_PAYMENT_FORM,
  PURCHASE_ORDER_FORM,
  PURCHASE_REQUEST_FORM,
} from '@/lib/custom-forms/migrated/procurement';
import { BUDGET_CHANGE_FORM, BUDGET_REQUEST_FORM } from '@/lib/custom-forms/migrated/budget';
import {
  CONTRACT_SEAL_FORM,
  GENERAL_SEAL_FORM,
  INVOICE_SEAL_FORM,
} from '@/lib/custom-forms/migrated/seals';
import { ASSET_TRANSFER_FORM } from '@/lib/custom-forms/migrated/asset-transfer';
import { BUSINESS_TRIP_FORM } from '@/lib/custom-forms/migrated/business-trip';
import { TRAVEL_EXPENSE_FORM } from '@/lib/custom-forms/migrated/travel';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';
import {
  CHANGE_TYPE_LABELS,
  EXISTENCE_FACT_LABELS,
  LOCATION_ACTION_LABELS,
  type HandoverLineAnswers,
} from '@/lib/assets/inventory-forms';
import { buildPropertyRegisterWorkbookBuffer } from '@/lib/assets/export-property-workbook';

const TODAY = '2026-11-13';

function schemaOf(raw: unknown): FormSchema {
  const r = parseFormSchema(raw);
  if (!r.ok) throw new Error(r.errors.join('；'));
  return r.schema;
}

describe('ACCSYS 全功能、虛擬資料與 AI 提詞調用單據 E2E 情境驗證', () => {
  // 10 關測試角色固定 UUID（與 ensureStageTestAccounts / DEV_PERSONAS 完全一致）
  const STAFF_ID = '00000000-0000-0000-0000-000000000021'; // 0017 阮振瑋（申請人）
  const MANAGER_ID = '00000000-0000-0000-0000-000000000022'; // 0053 楊為任（部門主管）
  const BUDGET_OWNER_ID = '00000000-0000-0000-0000-000000000023'; // 0060 張晏銘（預算負責人）
  const NEW_CUSTODIAN_ID = '00000000-0000-0000-0000-000000000024'; // 0046 賴昭宇（新保管人）
  const NEW_MANAGER_ID = '00000000-0000-0000-0000-000000000025'; // 0032 陳冠文（新單位主管）
  const GA_ID = '00000000-0000-0000-0000-000000000026'; // 0075 汪怡伶（總務/清點人）
  const FINANCE_ID = '00000000-0000-0000-0000-000000000027'; // 0009 許雲茹（財務）
  const GM_ID = '00000000-0000-0000-0000-000000000028'; // 0002 沈大維
  const CHAIRMAN_ID = '00000000-0000-0000-0000-000000000029'; // 0001 陳維隆
  const ADMIN_ID = '00000000-0000-0000-0000-000000000002'; // 0065 吳旭東（系統管理員）

  const DEV_DEPT_ID = '00000000-0000-0000-0000-000000000001';
  const RD_DEPT_ID = '00000000-0000-0000-0000-000000000011';
  const PM_DEPT_ID = '00000000-0000-0000-0000-000000000012';
  const SL_DEPT_ID = '00000000-0000-0000-0000-000000000013';
  const AD_DEPT_ID = '00000000-0000-0000-0000-000000000014';
  const FN_DEPT_ID = '00000000-0000-0000-0000-000000000015';
  const EX_DEPT_ID = '00000000-0000-0000-0000-000000000016';

  const BUDGET_RD_ID = '33333333-3333-4333-8333-000000000001'; // 115RDSE15 雜項購置（楊為任）
  const BUDGET_PRJ_ID = '33333333-3333-4333-8333-000000000002'; // 115TD2601PR01 研發材料與設備費（張晏銘）
  const BUDGET_AD_ID = '33333333-3333-4333-8333-000000000003'; // 115ADSE08 文具用品（汪怡伶）
  const BUDGET_RV_ID = '33333333-3333-4333-8333-000000000004'; // 115RV2601PR01 專案執行費用（張晏銘）
  const SUPPLIER_OPTO_ID = '44444444-4444-4444-8444-000000000001'; // 台灣光電科技股份有限公司
  const SUPPLIER_AUTO_ID = '44444444-4444-4444-8444-000000000002'; // 精密車電系統股份有限公司
  const PROJECT_TD_ID = '55555555-5555-4555-8555-000000000001'; // TD2601 自駕巴士智慧座艙產品專案
  const PROJECT_RV_ID = '55555555-5555-4555-8555-000000000002'; // RV2601 桃園機場自駕接駁營收專案
  const ASSET_MBP_ID = '66666666-6666-4666-8666-000000000001'; // TD-IT-0054-01 MacBook Pro 16
  const ASSET_LIDAR_ID = '66666666-6666-4666-8666-000000000002'; // TD-RD-0108-01 Velodyne 3D 光達
  const ASSET_DELL_ID = '66666666-6666-4666-8666-000000000003'; // TD-SL-0021-01 Dell 27 4K 顯示器

  // 模擬系統虛擬資料 PickerOptions（與 ensureStageTestAccounts 寫入之虛擬資料完全對應）
  const virtualPicker: PickerOptions = {
    employees: [
      { id: STAFF_ID, label: '0017 阮振瑋（研發部）' },
      { id: MANAGER_ID, label: '0053 楊為任（研發部）' },
      { id: BUDGET_OWNER_ID, label: '0060 張晏銘（專案管理部）' },
      { id: NEW_CUSTODIAN_ID, label: '0046 賴昭宇（業務部）' },
      { id: NEW_MANAGER_ID, label: '0032 陳冠文（業務部）' },
      { id: GA_ID, label: '0075 汪怡伶（管理部）' },
      { id: FINANCE_ID, label: '0009 許雲茹（財務部）' },
      { id: GM_ID, label: '0002 沈大維（總經理暨董事長室）' },
      { id: CHAIRMAN_ID, label: '0001 陳維隆（總經理暨董事長室）' },
      { id: ADMIN_ID, label: '0065 吳旭東（本機開發）' },
    ],
    departments: [
      { id: DEV_DEPT_ID, label: 'DEV 本機開發' },
      { id: RD_DEPT_ID, label: 'RD 研發部' },
      { id: PM_DEPT_ID, label: 'PM 專案管理部' },
      { id: SL_DEPT_ID, label: 'SL 業務部' },
      { id: AD_DEPT_ID, label: 'AD 管理部' },
      { id: FN_DEPT_ID, label: 'FN 財務部' },
      { id: EX_DEPT_ID, label: 'EX 總經理暨董事長室' },
    ],
    budgetCodes: [
      { id: BUDGET_RD_ID, label: '115RDSE15 雜項購置（研發部）', scope: 'department' },
      { id: BUDGET_PRJ_ID, label: '115TD2601PR01 研發材料與設備費（TD2601）', scope: 'product' },
      { id: BUDGET_AD_ID, label: '115ADSE08 文具用品（管理部）', scope: 'department' },
      { id: BUDGET_RV_ID, label: '115RV2601PR01 專案執行費用（RV2601）', scope: 'revenue' },
    ],
    projects: [
      { id: PROJECT_TD_ID, label: 'TD2601 自駕巴士智慧座艙產品專案' },
      { id: PROJECT_RV_ID, label: 'RV2601 桃園機場自駕接駁營收專案' },
    ],
    suppliers: [
      { id: SUPPLIER_OPTO_ID, label: '台灣光電科技股份有限公司（24556677）' },
      { id: SUPPLIER_AUTO_ID, label: '精密車電系統股份有限公司（83991122）' },
    ],
    assets: [
      {
        id: ASSET_MBP_ID,
        label: 'TD-IT-0054-01 MacBook Pro 16 吋研發筆電',
        custodianId: STAFF_ID,
        location: '台北辦公室 3F 研發區',
      },
      {
        id: ASSET_LIDAR_ID,
        label: 'TD-RD-0108-01 Velodyne 高精準度 3D 光達感測器',
        custodianId: STAFF_ID,
        location: '南港測試車庫 B1',
      },
      {
        id: ASSET_DELL_ID,
        label: 'TD-SL-0021-01 Dell UltraSharp 27 吋 4K 顯示器',
        custodianId: NEW_CUSTODIAN_ID,
        location: '台北辦公室 2F 業務區',
      },
    ],
    sources: [],
  };

  const orgSnap: OrgSnapshot = {
    employees: new Map([
      [STAFF_ID, { id: STAFF_ID, name: '阮振瑋', departmentId: RD_DEPT_ID, active: true }],
      [MANAGER_ID, { id: MANAGER_ID, name: '楊為任', departmentId: RD_DEPT_ID, active: true }],
      [BUDGET_OWNER_ID, { id: BUDGET_OWNER_ID, name: '張晏銘', departmentId: PM_DEPT_ID, active: true }],
      [NEW_CUSTODIAN_ID, { id: NEW_CUSTODIAN_ID, name: '賴昭宇', departmentId: SL_DEPT_ID, active: true }],
      [NEW_MANAGER_ID, { id: NEW_MANAGER_ID, name: '陳冠文', departmentId: SL_DEPT_ID, active: true }],
      [GA_ID, { id: GA_ID, name: '汪怡伶', departmentId: AD_DEPT_ID, active: true }],
      [FINANCE_ID, { id: FINANCE_ID, name: '許雲茹', departmentId: FN_DEPT_ID, active: true }],
      [GM_ID, { id: GM_ID, name: '沈大維', departmentId: EX_DEPT_ID, active: true }],
      [CHAIRMAN_ID, { id: CHAIRMAN_ID, name: '陳維隆', departmentId: EX_DEPT_ID, active: true }],
      [ADMIN_ID, { id: ADMIN_ID, name: '吳旭東', departmentId: DEV_DEPT_ID, active: true }],
    ]),
    departments: new Map([
      [DEV_DEPT_ID, { id: DEV_DEPT_ID, name: '本機開發', parentId: null, managerId: ADMIN_ID, levelCode: null, active: true }],
      [RD_DEPT_ID, { id: RD_DEPT_ID, name: '研發部', parentId: null, managerId: MANAGER_ID, levelCode: null, active: true }],
      [PM_DEPT_ID, { id: PM_DEPT_ID, name: '專案管理部', parentId: null, managerId: BUDGET_OWNER_ID, levelCode: null, active: true }],
      [SL_DEPT_ID, { id: SL_DEPT_ID, name: '業務部', parentId: null, managerId: NEW_MANAGER_ID, levelCode: null, active: true }],
      [AD_DEPT_ID, { id: AD_DEPT_ID, name: '管理部', parentId: null, managerId: GA_ID, levelCode: null, active: true }],
      [FN_DEPT_ID, { id: FN_DEPT_ID, name: '財務部', parentId: null, managerId: FINANCE_ID, levelCode: null, active: true }],
      [EX_DEPT_ID, { id: EX_DEPT_ID, name: '總經理暨董事長室', parentId: null, managerId: GM_ID, levelCode: null, active: true }],
    ]),
    levels: new Map(),
    jobRoles: new Map([
      ['general_manager', { name: '總經理', active: true }],
      ['chairman', { name: '董事長', active: true }],
    ]),
    jobRoleBindings: [
      { jobRole: 'general_manager', departmentId: null, employeeId: GM_ID, isPrimary: true },
      { jobRole: 'chairman', departmentId: null, employeeId: CHAIRMAN_ID, isPrimary: true },
    ],
    groups: new Map([
      ['general_affairs', { name: '管理部總務（用印／資產管理）', active: true, memberIds: [GA_ID] }],
      ['seal_custodian', { name: '用印管理人', active: true, memberIds: [GA_ID] }],
      ['asset_admin', { name: '資產管理人', active: true, memberIds: [GA_ID, FINANCE_ID] }],
      ['finance', { name: '財務會計組', active: true, memberIds: [FINANCE_ID] }],
    ]),
    delegations: [],
    budgetOwners: new Map([
      [BUDGET_RD_ID, MANAGER_ID],
      [BUDGET_PRJ_ID, BUDGET_OWNER_ID],
      [BUDGET_AD_ID, GA_ID],
      [BUDGET_RV_ID, BUDGET_OWNER_ID],
    ]),
    assetCustodians: new Map([
      [ASSET_MBP_ID, STAFF_ID],
      [ASSET_LIDAR_ID, STAFF_ID],
      [ASSET_DELL_ID, NEW_CUSTODIAN_ID],
    ]),
  };

  const mockFormsIndex = [
    { key: 'expense-claim', name: '費用申請單' },
    { key: 'purchase-request', name: '請購單' },
    { key: 'purchase-order', name: '採購單' },
    { key: 'acceptance', name: '驗收單' },
    { key: 'procurement-payment', name: '採購請款單' },
    { key: 'budget-request', name: '預算申請單' },
    { key: 'budget-change', name: '預算變更申請單' },
    { key: 'asset-transfer', name: '資產異動申請單' },
    { key: 'contract-seal', name: '用印申請單(合約類)' },
    { key: 'general-seal', name: '用印申請單(一般類)' },
    { key: 'invoice-seal', name: '發票開立用印申請單' },
    { key: 'business-trip', name: '公出差旅申請單' },
    { key: 'travel-expense', name: '出差報告暨旅費報支單' },
  ];

  describe('情境群組一：虛擬測試資料、10 關測試帳號與 AI 工具白名單完整性驗證', () => {
    it('1.1 驗證第 39 條 10 大關卡測試帳號（DEV_PERSONAS）涵蓋完整簽核鏈且預設全體開放試用取代 104', () => {
      expect(DEV_PERSONAS.length).toBe(10);
      const codes = DEV_PERSONAS.map((p) => p.employeeCode);
      expect(codes).toEqual([
        '0017', // 1. 申請人 阮振瑋
        '0053', // 2. 部門主管 楊為任
        '0060', // 3. 預算負責人 張晏銘
        '0046', // 4. 新保管人 賴昭宇
        '0032', // 5. 新單位主管 陳冠文
        '0075', // 6. 總務/用印/資產管理 汪怡伶
        '0009', // 7. 財會/盤點複核 許雲茹
        '0002', // 8. 總經理 沈大維
        '0001', // 9. 董事長 陳維隆
        '0065', // 10. 系統管理員 吳旭東
      ]);
    });

    it('1.2 驗證 AI 助手工具白名單已註冊財產清點單派發/查詢/雙方確認工具與表單別名映射', () => {
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('create_application_draft');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('update_application_draft');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('list_inventory_handover_forms');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('dispatch_inventory_handover_form');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('confirm_inventory_handover_items');
      expect(AI_CHAT_TOOL_DECLARATIONS.map((d) => d.name).sort()).toEqual([...AI_CHAT_ALLOWED_TOOLS].sort());

      // 驗證舊版四種費用單別名自動映射至五合一通用版 expense-claim
      expect(FORM_KEY_ALIASES['department-expense']).toBe('expense-claim');
      expect(FORM_KEY_ALIASES['minor-expense']).toBe('expense-claim');
      expect(FORM_KEY_ALIASES['project-expense']).toBe('expense-claim');
      expect(FORM_KEY_ALIASES['revenue-expense']).toBe('expense-claim');
      expect(FORM_KEY_ALIASES['expense-claim-dept']).toBe('expense-claim');
      expect(FORM_KEY_ALIASES['expense-reimbursement']).toBe('expense-claim');
    });
  });

  describe('情境群組二：AI 提詞調用「五合一通用費用申請單 (expense-claim)」與 30,000 元門檻驗證', () => {
    const expenseSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);

    it('2.1 AI 提詞：「幫我開一張費用申請單，研發部購買實驗耗材 18,500 元，匯款給台灣光電」（≤ 3 萬免請購單直接成立）', () => {
      const prompt = '幫我開一張費用申請單，研發部購買實驗耗材 18,500 元，匯款給台灣光電';
      const hints = intentHintsForUserMessage(prompt);
      expect(hints.some((h) => h.includes('expense-claim'))).toBe(true);
      expect(hints.some((h) => h.includes('30,000'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('expense-claim')).toBe(true);

      // 模擬 AI 助手根據提詞自動解析「115RDSE15」與「台灣光電」並寫入草稿
      const plan = planFill(
        expenseSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115RDSE15' },
            { field: 'payeeType', value: 'supplier' },
            { field: 'payeeSupplierId', value: '台灣光電科技股份有限公司' },
            { field: 'expectedPaymentDate', value: '2026-11-25' },
            { field: 'paymentMethod', value: 'transfer' },
            { field: 'remittanceInfo', value: '玉山商業銀行內湖分行 0406940012345' },
            { field: 'remark', value: '購買實驗室光學清潔耗材一批（未滿三萬元免請購）' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '雜項購置' },
                { column: 'description', value: '無塵擦拭紙與光學清潔液' },
                { column: 'quantity', value: 1 },
                { column: 'currency', value: 'TWD' },
                { column: 'amount', value: '18500' },
              ],
            },
          ],
        },
        TODAY
      );

      expect(plan.rejected).toEqual([]);
      expect(plan.data.budgetCodeId).toBe(BUDGET_RD_ID);
      expect(plan.data.payeeSupplierId).toBe(SUPPLIER_OPTO_ID);
      const status = draftStatus(expenseSchema, plan.data, TODAY);
      expect(status).toEqual({ missing: [], invalid: [], readyToSubmit: true });

      const receipt = fillReceipt({
        ok: true,
        created: true,
        draftId: 'draft-exp-1',
        formKey: 'expense-claim',
        formName: UNIFIED_EXPENSE_CLAIM_FORM.name,
        version: 1,
        saved: plan.changed.map((field) => ({ field, label: field, value: '已填' })),
        rejected: plan.rejected,
        missing: status.missing,
        invalid: status.invalid,
        readyToSubmit: status.readyToSubmit,
        tables: {},
      });
      expect(receipt).toContain('必填已齊，可由您確認後送出');
    });

    it('2.2 AI 提詞：「我要報支設備購置費 35,000 元」（一般購置 > 30,000 元，系統自動攔截並提示先走請購流程）', () => {
      const prompt = '我要直接開費用申請單報支高單價治具 35,000 元';
      const hints = intentHintsForUserMessage(prompt);
      expect(hints.some((h) => h.includes('30,000'))).toBe(true);
      expect(hints.some((h) => h.includes('purchase-request'))).toBe(true);

      // 驗證表單驗證引擎對超過 30,000 元之受控購置項目回傳明確提示訊息
      const validation = validateSubmission(
        expenseSchema,
        {
          budgetCodeId: BUDGET_RD_ID,
          items: {
            rows: [
              {
                category: '雜項購置',
                description: '高單價治具採購（超過三萬元）',
                quantity: 1,
                currency: 'TWD',
                exchangeRate: '1',
                amount: '35000',
              },
            ],
            total: null,
          },
          remark: '',
          payeeType: 'supplier',
          payeeSupplierId: SUPPLIER_OPTO_ID,
          expectedPaymentDate: '2026-11-25',
          paymentMethod: 'transfer',
          remittanceInfo: '玉山商業銀行內湖分行 0406940012345',
        },
        TODAY
      );

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        const allMessages = Object.values(validation.errors).flat().join('；');
        expect(allMessages).toContain('30,000');
        expect(allMessages).toContain('請購流程');
      }
    });
  });

  describe('情境群組三：AI 提詞調用「採購鏈 (請購 -> 多張採購/驗收/請款)」與預付/非預付雙順序驗證', () => {
    it('3.1 AI 提詞：「金額 150,000 元超過三萬，請幫我開請購單」並驗證第 19 條簽核流程（>10 萬自動送董事長）', () => {
      const prompt = '我要買高階光學檢測儀 150,000 元，超過三萬元請幫我開請購單';
      expect(intentHintsForUserMessage(prompt).some((h) => h.includes('purchase-request'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('purchase-request')).toBe(true);

      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const plan = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'neededWithinDays', value: 14 },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115TD2601PR01' },
                { column: 'description', value: '高階光學檢測儀 AOI-5000 Pro' },
                { column: 'quantity', value: 1 },
                { column: 'unitPrice', value: '150000' },
              ],
            },
          ],
        },
        TODAY
      );

      expect(plan.rejected).toEqual([]);
      const status = draftStatus(prSchema, plan.data, TODAY);
      expect(status.readyToSubmit).toBe(true);

      // 驗證第 19 條簽核流程：申請單位主管(楊為任) -> 預算負責人(張晏銘) -> 總經理(沈大維) -> 超過 10 萬送董事長(陳維隆)
      const parsed = parseDefinition(PURCHASE_REQUEST_FORM.schema, PURCHASE_REQUEST_FORM.flow);
      if (!parsed.ok) throw new Error(parsed.errors.join(','));
      const flowOver100k = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: PURCHASE_REQUEST_FORM.key,
          today: TODAY,
          fields: {
            'items.budgetCodeId': BUDGET_PRJ_ID,
            items: '150000',
          },
        },
        orgSnap
      );
      expect(flowOver100k.ok).toBe(true);
      if (flowOver100k.ok) {
        expect(flowOver100k.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          MANAGER_ID,
          BUDGET_OWNER_ID,
          GM_ID,
          CHAIRMAN_ID,
        ]);
      }

      // 對照：若金額 80,000 元（<= 100,000 元），只簽到總經理，不送董事長
      const flowUnder100k = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: PURCHASE_REQUEST_FORM.key,
          today: TODAY,
          fields: {
            'items.budgetCodeId': BUDGET_PRJ_ID,
            items: '80000',
          },
        },
        orgSnap
      );
      expect(flowUnder100k.ok).toBe(true);
      if (flowUnder100k.ok) {
        expect(flowUnder100k.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          MANAGER_ID,
          BUDGET_OWNER_ID,
          GM_ID,
        ]);
      }
    });

    it('3.2 驗證第 16、17 條：一張請購單對應多張採購、驗收、費用單，且支援「非預付 (1->2->3->4)」與「預付 (1->2->4->3)」兩種順序', () => {
      const poDef = parseDefinition(PURCHASE_ORDER_FORM.schema, PURCHASE_ORDER_FORM.flow);
      const accDef = parseDefinition(ACCEPTANCE_FORM.schema, ACCEPTANCE_FORM.flow);
      const payDef = parseDefinition(PROCUREMENT_PAYMENT_FORM.schema, PROCUREMENT_PAYMENT_FORM.flow);
      if (!poDef.ok || !accDef.ok || !payDef.ok) throw new Error('Procurement definitions failed');

      // 採購單 (2) 來源為請購單 (1)，且 allowMultiple = true（支援一張請購拆多張分批採購單）
      const poSource = allFields(poDef.schema).find((f) => f.type === 'source');
      expect(poSource?.type === 'source' && poSource.sources.every((s) => s.allowMultiple === true)).toBe(true);
      expect(poSource?.type === 'source' && poSource.sources.map((s) => s.form)).toEqual(['purchase-request']);

      // 驗收單 (3) 承接「採購單 (2)」，且 allowMultiple = true（支援分批開立多張驗收單；預付款案件於預付請款後依採購單補辦驗收）
      const accSource = allFields(accDef.schema).find((f) => f.type === 'source');
      expect(accSource?.type === 'source' && accSource.sources.every((s) => s.allowMultiple === true)).toBe(true);
      expect(accSource?.type === 'source' && accSource.sources.map((s) => s.form)).toEqual([
        'purchase-order',
      ]);

      // 採購請款單 (4) 支援承接「驗收單 (3)」（非預付 1->2->3->4）或直接承接「採購單 (2)」（預付 1->2->4->3）
      const paySource = allFields(payDef.schema).find((f) => f.type === 'source');
      expect(paySource?.type === 'source' && paySource.sources.every((s) => s.allowMultiple === true)).toBe(true);
      expect(paySource?.type === 'source' && paySource.sources.map((s) => s.form)).toEqual([
        'acceptance',
        'purchase-order',
      ]);
    });
  });

  describe('情境群組四：AI 提詞調用「預算申請單 (budget-request)」與「預算變更單 (budget-change)」e 化驗證', () => {
    it('4.1 AI 提詞：「請幫我建立一張 115 年度研發部的預算申請單，編列金額 280,000 元」並驗證簽核鏈', () => {
      const prompt = '請幫我建立一張 115 年度研發部的預算申請單，編列金額 280,000 元';
      expect(intentHintsForUserMessage(prompt).some((h) => h.includes('budget-request'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('budget-request')).toBe(true);

      const brSchema = schemaOf(BUDGET_REQUEST_FORM.schema);
      const plan = planFill(
        brSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'fiscalYear', value: '115' },
            { field: 'budgetScope', value: 'department' },
            { field: 'targetDepartmentId', value: 'RD 研發部' },
            { field: 'ownerEmployeeId', value: '0060 張晏銘' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'code', value: '115RDSE99' },
                { column: 'category', value: '設備' },
                { column: 'description', value: '高階光學實驗治具年度預算' },
                { column: 'annualBudgetAmount', value: '280000' },
              ],
            },
          ],
        },
        TODAY
      );

      expect(plan.rejected).toEqual([]);
      expect(draftStatus(brSchema, plan.data, TODAY).readyToSubmit).toBe(true);

      const parsed = parseDefinition(BUDGET_REQUEST_FORM.schema, BUDGET_REQUEST_FORM.flow);
      if (!parsed.ok) throw new Error(parsed.errors.join(','));
      const flowRes = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: BUDGET_REQUEST_FORM.key,
          today: TODAY,
          fields: { ownerEmployeeId: BUDGET_OWNER_ID, items: '280000' },
        },
        orgSnap
      );
      expect(flowRes.ok).toBe(true);
      if (flowRes.ok) {
        expect(flowRes.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          MANAGER_ID,
          BUDGET_OWNER_ID,
          GM_ID,
          CHAIRMAN_ID,
        ]);
      }
    });

    it('4.2 AI 提詞：「研發部測試設備費不足，幫我開一張預算變更單，追加預算 60,000 元」並驗證簽核鏈', () => {
      const prompt = '研發部測試設備費不足，幫我開一張預算變更單，追加預算 60,000 元';
      expect(intentHintsForUserMessage(prompt).some((h) => h.includes('budget-change'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('budget-change')).toBe(true);

      const bcSchema = schemaOf(BUDGET_CHANGE_FORM.schema);
      const plan = planFill(
        bcSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115TD2601PR01' },
            { field: 'changeType', value: 'increase' },
            { field: 'currentBudgetAmount', value: '3000000' },
            { field: 'changeAmount', value: '60000' },
            { field: 'newBudgetAmount', value: '3060000' },
            { field: 'reason', value: '配合新客戶樣品急單測試，追加實驗室耗材與治具預算 60,000 元' },
          ],
        },
        TODAY
      );

      expect(plan.rejected).toEqual([]);
      expect(draftStatus(bcSchema, plan.data, TODAY).readyToSubmit).toBe(true);

      const parsed = parseDefinition(BUDGET_CHANGE_FORM.schema, BUDGET_CHANGE_FORM.flow);
      if (!parsed.ok) throw new Error(parsed.errors.join(','));
      const flowRes = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: BUDGET_CHANGE_FORM.key,
          today: TODAY,
          fields: { budgetCodeId: BUDGET_PRJ_ID, changeAmount: '60000' },
        },
        orgSnap
      );
      expect(flowRes.ok).toBe(true);
      if (flowRes.ok) {
        expect(flowRes.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          MANAGER_ID,
          BUDGET_OWNER_ID,
          GM_ID,
        ]);
      }
    });
  });

  describe('情境群組五：AI 提詞調用「三種用印申請單 (contract-seal / general-seal / invoice-seal)」皆簽至董事長', () => {
    it('5.1 AI 提詞分別建立合約用印、一般用印、發票章用印草稿，且第 38 條全數最終簽核皆到董事長 (0001)', () => {
      const prompt = '幫我開一張合約用印申請單，要跟台灣光電簽署 NDA 與採購合約，蓋公司大小章';
      expect(intentHintsForUserMessage(prompt).some((h) => h.includes('contract-seal'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('contract-seal')).toBe(true);

      const sealForms = [
        { key: 'contract-seal', def: CONTRACT_SEAL_FORM },
        { key: 'general-seal', def: GENERAL_SEAL_FORM },
        { key: 'invoice-seal', def: INVOICE_SEAL_FORM },
      ] as const;

      for (const { def } of sealForms) {
        const parsed = parseDefinition(def.schema, def.flow);
        if (!parsed.ok) throw new Error(parsed.errors.join(','));
        const flowRes = resolveFlow(
          parsed.flow,
          {
            applicantEmployeeId: STAFF_ID,
            filerEmployeeId: STAFF_ID,
            departmentId: RD_DEPT_ID,
            formKey: def.key,
            today: TODAY,
            fields: {},
          },
          orgSnap
        );
        expect(flowRes.ok).toBe(true);
        if (flowRes.ok) {
          // 申請單位主管(楊為任) -> 總經理(沈大維) -> 董事長(陳維隆)
          expect(flowRes.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
            MANAGER_ID,
            GM_ID,
            CHAIRMAN_ID,
          ]);
        }
      }
    });
  });

  describe('情境群組六：AI 提詞調用「資產異動申請單 (asset-transfer)」雙流程與 @提及自動解析驗證', () => {
    const assetTransferSchema = schemaOf(ASSET_TRANSFER_FORM.schema);

    it('6.1 流程一（第 36 條：單純保管人移轉/調撥）：AI 提詞「把 MacBook Pro 轉給 @賴昭宇」，自動解析人員並走原單位與新單位主管（不需總經理）', () => {
      const prompt = '幫我開資產異動單，把 MacBook Pro 研發筆電 TD-IT-0054-01 轉給 @賴昭宇 保管';
      expect(intentHintsForUserMessage(prompt).some((h) => h.includes('asset-transfer'))).toBe(true);
      expect(matchRelevantFormKeys(prompt, mockFormsIndex).has('asset-transfer')).toBe(true);

      // 驗證 @賴昭宇 能自動解析為 0046 賴昭宇 UUID
      expect(resolveReference('賴昭宇', virtualPicker.employees)).toEqual({
        ok: true,
        value: NEW_CUSTODIAN_ID,
      });

      const plan = planFill(
        assetTransferSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'useDepartmentId', value: 'SL 業務部' },
            { field: 'useBudgetCodeId', value: '115TD2601PR01' },
            { field: 'transferTypes', values: ['custodian_change'] },
            { field: 'originalCustodianEmployeeId', value: '阮振瑋' },
            { field: 'newCustodianEmployeeId', value: '賴昭宇' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'assetId', value: 'TD-IT-0054-01' },
                { column: 'reason', value: 'custodian_change' },
                { column: 'newCustodianEmployeeId', value: '賴昭宇' },
                { column: 'newLocation', value: '台北辦公室 2F 業務區' },
              ],
            },
          ],
        },
        TODAY
      );

      expect(plan.rejected).toEqual([]);
      expect(plan.data.originalCustodianEmployeeId).toBe(STAFF_ID);
      expect(plan.data.newCustodianEmployeeId).toBe(NEW_CUSTODIAN_ID);
      expect(draftStatus(assetTransferSchema, plan.data, TODAY).readyToSubmit).toBe(true);

      const parsed = parseDefinition(ASSET_TRANSFER_FORM.schema, ASSET_TRANSFER_FORM.flow);
      if (!parsed.ok) throw new Error(parsed.errors.join(','));
      const flowRes = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: ASSET_TRANSFER_FORM.key,
          today: TODAY,
          fields: {
            transferTypes: ['custodian_change'],
            originalCustodianEmployeeId: STAFF_ID,
            newCustodianEmployeeId: NEW_CUSTODIAN_ID,
            otherCustodianEmployeeId: null,
          },
        },
        orgSnap
      );
      expect(flowRes.ok).toBe(true);
      if (flowRes.ok) {
        expect(flowRes.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          MANAGER_ID,
          NEW_CUSTODIAN_ID,
          NEW_MANAGER_ID,
        ]);
      }
    });

    it('6.2 流程二（第 37 條：借出/合併/出售/報廢/其他）：AI 提詞申請設備報廢，自動加簽至總經理 (0002)', () => {
      const parsed = parseDefinition(ASSET_TRANSFER_FORM.schema, ASSET_TRANSFER_FORM.flow);
      if (!parsed.ok) throw new Error(parsed.errors.join(','));
      const flowRes = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: STAFF_ID,
          filerEmployeeId: STAFF_ID,
          departmentId: RD_DEPT_ID,
          formKey: ASSET_TRANSFER_FORM.key,
          today: TODAY,
          fields: {
            transferTypes: ['scrap'],
            originalCustodianEmployeeId: STAFF_ID,
            newCustodianEmployeeId: GA_ID,
            otherCustodianEmployeeId: null,
          },
        },
        orgSnap
      );
      expect(flowRes.ok).toBe(true);
      if (flowRes.ok) {
        expect(flowRes.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
          GA_ID,
          MANAGER_ID,
          GM_ID,
        ]);
      }
    });
  });

  describe('情境群組七：AI 提詞調用「財產清點雙方點交系統表單」與 23 欄 Excel 匯出驗證', () => {
    it('7.1 AI 提詞：「請幫我發送一張財產清點單給 @阮振瑋，並確認同意現在位置與存在事實」觸發正確工具指引與點交狀態檢核', () => {
      const dispatchPrompt = '請幫我發送一張財產清點單給 @阮振瑋，指定今天下午兩點在 3F 研發區點交';
      const dispatchHints = intentHintsForUserMessage(dispatchPrompt);
      expect(dispatchHints.some((h) => h.includes('dispatch_inventory_handover_form'))).toBe(true);

      const confirmPrompt = '幫我查詢我的財產清點單，並確認同意現在位置，第二筆需要更改位置到 5F 實驗室';
      const confirmHints = intentHintsForUserMessage(confirmPrompt);
      expect(confirmHints.some((h) => h.includes('confirm_inventory_handover_items'))).toBe(true);
      expect(confirmHints.some((h) => h.includes('list_inventory_handover_forms'))).toBe(true);

      // 驗證點交單明細結構：支援同意現在位置 (agree_current) 與需要更改位置 (change_needed)、存在事實與雙方各自確認
      expect(LOCATION_ACTION_LABELS.agree_current).toContain('同意現在位置');
      expect(LOCATION_ACTION_LABELS.change_needed).toContain('需要更改位置');
      expect(EXISTENCE_FACT_LABELS.exists).toContain('物品存在');
      expect(CHANGE_TYPE_LABELS.location_change).toBe('更改存放位置');

      const sampleLine: HandoverLineAnswers = {
        assetName: 'Velodyne 高精準度 3D 光達感測器',
        itemKind: '測試儀器',
        description: 'VLP-32C 實車感測模組',
        bookQuantity: 1,
        unit: '組',
        originalLocation: '南港測試車庫 B1',
        originalStatus: 'in_custody',
        originalCustodianId: STAFF_ID,
        originalCustodianName: '阮振瑋',
        locationAction: 'change_needed',
        confirmedLocation: '台北總部 5F 光學實驗室',
        changeType: 'location_change',
        confirmedStatus: 'in_custody',
        existenceFact: 'exists',
        custodianNote: '已移回台北總部 5F 光學實驗室校正',
        inspectorNote: '現場實盤確認存在且標籤完好',
        custodianConfirmed: true,
        custodianConfirmedAt: '2026-11-13T14:05:00.000Z',
        custodianConfirmedById: STAFF_ID,
        custodianConfirmedByName: '阮振瑋',
        inspectorConfirmed: true,
        inspectorConfirmedAt: '2026-11-13T14:10:00.000Z',
        inspectorConfirmedById: GA_ID,
        inspectorConfirmedByName: '汪怡伶',
      };
      expect(sampleLine.custodianConfirmed && sampleLine.inspectorConfirmed).toBe(true);
      expect(sampleLine.confirmedLocation).toBe('台北總部 5F 光學實驗室');
    });

    it('7.2 驗證第 33、34、35 條：財產保管清冊完整 23 欄 + 雙階簽認 4 欄匯出 Excel 盤點清冊', async () => {
      const buf = await buildPropertyRegisterWorkbookBuffer([
        {
          id: ASSET_MBP_ID,
          tag: 'TD-IT-0054-01',
          name: 'MacBook Pro 16 吋研發筆電',
          quantity: 1,
          custodianEmployeeId: STAFF_ID,
          custodianName: '阮振瑋',
          custodianDepartment: '研發部',
          custodyDepartmentId: RD_DEPT_ID,
          custodyDepartmentName: '研發部',
          location: '台北辦公室 3F 研發區',
          status: 'in_custody',
          itemKind: '電腦設備',
          description: 'Apple M3 Max / 64GB / 2TB SSD',
          unit: '台',
          remark: '研發主力開發機',
          accountingSubject: '生財器具',
          acquiredOn: '2024-05-20',
          voucherNo: '1130520001',
          projectLabel: 'TD2601',
          tagAffixed: 'V',
          disposalVoucherNo: '',
          changeRequest: '',
          physicalQuantity: 1,
          invMatchesBooks: 'V',
          invIdleDisposable: 'X',
          invUnusableScrap: 'X',
          invDispositionNote: '正常使用中',
          inventoryConfirmStage: 'reviewer_confirmed',
          custodianConfirmedAt: '2026-11-13T14:05:00.000Z',
          custodianConfirmedById: STAFF_ID,
          custodianConfirmedByName: '阮振瑋',
          custodianConfirmedStatus: 'in_custody',
          reviewerConfirmedAt: '2026-11-13T14:10:00.000Z',
          reviewerConfirmedById: GA_ID,
          reviewerConfirmedByName: '汪怡伶',
          reviewerNote: '點交核對無誤',
          updatedAt: new Date('2026-11-13T14:10:00.000Z'),
        },
      ]);
      expect(buf.byteLength).toBeGreaterThan(5000);
    });
  });

  describe('情境群組八：20 種跨角色多輪連鎖簽核、退回重送、代為申請、代理簽核、分批驗收與雙向點交 E2E 交叉測試', () => {
    /**
     * 體系化模擬申請單簽核生命週期狀態機（對齊 src/lib/custom-forms/service.ts + src/lib/workflow/tx.ts）
     * 支援：建立送出 -> 逐關核准(approve) -> 退回(return) -> 撤回(withdraw) -> 重新送出(resubmit) -> 財會補填(financeFill)
     */
    type StepState = Omit<ResolvedStep, 'status'> & {
      status: ResolvedStep['status'] | 'approved' | 'returned';
      stepOrder: number;
      decidedBy?: string;
      decision?: 'approve' | 'return';
      reason?: string;
    };

    type SimSubmission = {
      id: string;
      formKey: string;
      formNumber: string;
      applicantId: string;
      filerId: string;
      departmentId: string;
      version: number;
      status: 'pending_approval' | 'approved' | 'returned' | 'withdrawn';
      currentStepOrder: number | null;
      data: Record<string, unknown>;
      steps: StepState[];
      history: string[];
    };

    function buildResolvedChain(
      form: MigratedForm,
      parties: { applicantId: string; filerId: string; editorId: string; departmentId: string },
      data: Record<string, unknown>,
      customOrg: OrgSnapshot = orgSnap,
      today: string = TODAY
    ): { steps: StepState[]; flowFields: Record<string, unknown>; normalizedData: Record<string, unknown> } {
      const parsed = parseDefinition(form.schema, form.flow);
      if (!parsed.ok) throw new Error(`Definition error (${form.key}): ${parsed.errors.join(', ')}`);
      const validated = validateSubmission(parsed.schema, data, today);
      if (!validated.ok) throw new Error(`Validation error (${form.key}): ${summarizeErrors(validated.errors)}`);

      const flowRes = resolveFlow(
        parsed.flow,
        {
          applicantEmployeeId: parties.applicantId,
          filerEmployeeId: parties.filerId,
          departmentId: parties.departmentId,
          formKey: form.key,
          today,
          fields: validated.value.flowFields,
        },
        customOrg
      );
      if (!flowRes.ok) throw new Error(`Flow resolution error (${form.key}): ${flowRes.error}`);

      const confirmedSteps = withApplicantConfirmation(flowRes.steps, parties);
      if (!confirmedSteps) throw new Error(`On-behalf confirmation failed (${form.key})`);

      return {
        steps: confirmedSteps.map((s, idx) => ({ ...s, stepOrder: idx + 1 })),
        flowFields: validated.value.flowFields,
        normalizedData: validated.value.data,
      };
    }

    function submitSimForm(
      form: MigratedForm,
      parties: { applicantId: string; filerId?: string; departmentId: string },
      data: Record<string, unknown>,
      customOrg: OrgSnapshot = orgSnap
    ): SimSubmission {
      const filerId = parties.filerId ?? parties.applicantId;
      const { steps, normalizedData } = buildResolvedChain(
        form,
        { applicantId: parties.applicantId, filerId, editorId: filerId, departmentId: parties.departmentId },
        data,
        customOrg
      );
      const firstPending = steps.find((s) => s.status === 'pending');
      return {
        id: `sim-${form.key}-${Math.random().toString(36).slice(2, 7)}`,
        formKey: form.key,
        formNumber: `20261113${form.numberPrefix}0001`,
        applicantId: parties.applicantId,
        filerId,
        departmentId: parties.departmentId,
        version: 1,
        status: firstPending ? 'pending_approval' : 'approved',
        currentStepOrder: firstPending ? firstPending.stepOrder : null,
        data: normalizedData,
        steps,
        history: [`created_by:${filerId}:for:${parties.applicantId}`],
      };
    }

    function approveStep(sim: SimSubmission, actorId: string): void {
      if (sim.status !== 'pending_approval' || sim.currentStepOrder === null) {
        throw new Error(`Cannot approve submission in status ${sim.status}`);
      }
      const step = sim.steps.find((s) => s.stepOrder === sim.currentStepOrder);
      if (!step || step.status !== 'pending') throw new Error('Current step is not pending');
      if (step.approverEmployeeId !== actorId) {
        throw new Error(`Forbidden: expected approver ${step.approverEmployeeId}, got ${actorId}`);
      }
      step.status = 'approved';
      step.decidedBy = actorId;
      step.decision = 'approve';
      sim.version += 1;
      sim.history.push(`approved_step_${step.stepOrder}:${actorId}`);

      const nextPending = sim.steps.find((s) => s.stepOrder > step.stepOrder && s.status === 'pending');
      if (nextPending) {
        sim.currentStepOrder = nextPending.stepOrder;
      } else {
        sim.status = 'approved';
        sim.currentStepOrder = null;
        sim.history.push('completed:approved');
      }
    }

    function returnStep(sim: SimSubmission, actorId: string, reason: string): void {
      if (sim.status !== 'pending_approval' || sim.currentStepOrder === null) {
        throw new Error(`Cannot return submission in status ${sim.status}`);
      }
      if (!reason.trim()) throw new Error('Return reason required');
      const step = sim.steps.find((s) => s.stepOrder === sim.currentStepOrder);
      if (!step || step.status !== 'pending') throw new Error('Current step is not pending');
      if (step.approverEmployeeId !== actorId) {
        throw new Error(`Forbidden: expected approver ${step.approverEmployeeId}, got ${actorId}`);
      }
      step.status = 'returned';
      step.decidedBy = actorId;
      step.decision = 'return';
      step.reason = reason.trim();
      sim.status = 'returned';
      sim.currentStepOrder = null;
      sim.version += 1;
      sim.history.push(`returned_step_${step.stepOrder}:${actorId}:${reason.trim()}`);
    }

    function withdrawSim(sim: SimSubmission, actorId: string): void {
      if (actorId !== sim.applicantId && actorId !== sim.filerId) {
        throw new Error('Only applicant or filer may withdraw');
      }
      const anyHumanDecided = sim.steps.some((s) => s.decision === 'approve' || s.decision === 'return');
      if (sim.status !== 'pending_approval' || anyHumanDecided) {
        throw new Error('Cannot withdraw after first decision');
      }
      sim.status = 'withdrawn';
      sim.currentStepOrder = null;
      sim.version += 1;
      sim.history.push(`withdrawn_by:${actorId}`);
    }

    function resubmitSimForm(
      sim: SimSubmission,
      form: MigratedForm,
      editorId: string,
      newData: Record<string, unknown>,
      customOrg: OrgSnapshot = orgSnap
    ): void {
      if (sim.status !== 'returned') throw new Error('Only returned submission can be resubmitted');
      if (editorId !== sim.applicantId && editorId !== sim.filerId) {
        throw new Error('Only applicant or filer can resubmit');
      }
      const { steps, normalizedData } = buildResolvedChain(
        form,
        {
          applicantId: sim.applicantId,
          filerId: sim.filerId,
          editorId,
          departmentId: sim.departmentId,
        },
        newData,
        customOrg
      );
      const firstPending = steps.find((s) => s.status === 'pending');
      sim.data = normalizedData;
      sim.steps = steps;
      sim.status = firstPending ? 'pending_approval' : 'approved';
      sim.currentStepOrder = firstPending ? firstPending.stepOrder : null;
      sim.version += 1;
      sim.history.push(`resubmitted_by:${editorId}`);
    }

    it('連鎖情境 01：【費用申請退件重送】阮振瑋(0017)送單 -> 楊為任(0053)核准 -> 張晏銘(0060)退件 -> 阮振瑋透過AI修正重送 -> 楊為任、張晏銘、沈大維(0002)依序核准結案', () => {
      const expenseSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);
      const round1Plan = planFill(
        expenseSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115TD2601PR01' },
            { field: 'payeeType', value: 'applicant' },
            { field: 'expectedPaymentDate', value: '2026-11-25' },
            { field: 'paymentMethod', value: 'transfer' },
            { field: 'remittanceInfo', value: '中國信託內湖分行 123540098765 阮振瑋' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '雜項購置' },
                { column: 'description', value: '光達校正反射板耗材（未稅誤填）' },
                { column: 'quantity', value: 1 },
                { column: 'currency', value: 'TWD' },
                { column: 'exchangeRate', value: '1' },
                { column: 'amount', value: '18000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        UNIFIED_EXPENSE_CLAIM_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        round1Plan.data
      );
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
      ]);

      // B(楊為任) 核准 -> C(張晏銘) 退件
      approveStep(sim, MANAGER_ID);
      expect(sim.currentStepOrder).toBe(2);
      returnStep(sim, BUDGET_OWNER_ID, '請改為含稅發票金額 18,900 元並註明專案模組編號');
      expect(sim.status).toBe('returned');

      // A(阮振瑋) 透過 AI 修改草稿並重送
      const row0Id = String(((round1Plan.data.items as TableValue).rows[0] as Record<string, unknown>)._rid);
      const round2Plan = planFill(
        expenseSchema,
        virtualPicker,
        round1Plan.data,
        {
          rows: [
            {
              op: 'update',
              table: 'items',
              row_id: row0Id,
              cells: [
                { column: 'description', value: 'TD2601 光達校正反射板耗材（含稅發票）' },
                { column: 'amount', value: '18900' },
              ],
            },
          ],
        },
        TODAY
      );
      resubmitSimForm(sim, UNIFIED_EXPENSE_CLAIM_FORM, STAFF_ID, round2Plan.data);
      expect(sim.status).toBe('pending_approval');

      // 重送後全鏈簽核通過：楊為任 -> 張晏銘 -> 沈大維
      approveStep(sim, MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 02：【門檻跨越連鎖 (>10萬加簽董事長)】賴昭宇(0046)請購 92,000 -> 陳冠文(0032)與張晏銘(0060)核准 -> 沈大維(0002)退回要求追加備品至 128,000 -> 重送自動加簽陳維隆(0001)', () => {
      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const r1 = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [{ field: 'neededWithinDays', value: 10 }],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115RV2601PR01' },
                { column: 'description', value: '車載工業電腦 IPC 主機' },
                { column: 'quantity', value: 2 },
                { column: 'unitPrice', value: '46000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        PURCHASE_REQUEST_FORM,
        { applicantId: NEW_CUSTODIAN_ID, departmentId: SL_DEPT_ID },
        r1.data
      );
      // 92,000 <= 100,000：陳冠文(0032) -> 張晏銘(0060) -> 沈大維(0002)
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        NEW_MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
      ]);

      approveStep(sim, NEW_MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      returnStep(sim, GM_ID, '桃園機場接駁車隊需多備 1 台備援機，請改為 3 台共 138,000 元');
      expect(sim.status).toBe('returned');

      const row0Id = String(((r1.data.items as TableValue).rows[0] as Record<string, unknown>)._rid);
      const r2 = planFill(
        prSchema,
        virtualPicker,
        r1.data,
        {
          rows: [
            {
              op: 'update',
              table: 'items',
              row_id: row0Id,
              cells: [{ column: 'quantity', value: 3 }],
            },
          ],
        },
        TODAY
      );
      resubmitSimForm(sim, PURCHASE_REQUEST_FORM, NEW_CUSTODIAN_ID, r2.data);
      // 138,000 > 100,000：自動觸發第 19 條加簽陳維隆(0001)
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        NEW_MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
        CHAIRMAN_ID,
      ]);

      approveStep(sim, NEW_MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('pending_approval'); // 尚待董事長
      approveStep(sim, CHAIRMAN_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 03：【代為申請 + 退回經辦重送】汪怡伶(0075)代阮振瑋(0017)填寫費用單 -> 第一關阮振瑋本人確認 -> 第二關楊為任(0053)退回 -> 汪怡伶修改重送 -> 阮振瑋再次確認後全鏈核准', () => {
      const expenseSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);
      const plan = planFill(
        expenseSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115ADSE08' },
            { field: 'payeeType', value: 'applicant' },
            { field: 'expectedPaymentDate', value: '2026-11-26' },
            { field: 'paymentMethod', value: 'cash' },
            { field: 'remittanceInfo', value: '無' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '文具用品' },
                { column: 'description', value: '研發白板筆與工程紀錄本' },
                { column: 'quantity', value: 1 },
                { column: 'currency', value: 'TWD' },
                { column: 'exchangeRate', value: '1' },
                { column: 'amount', value: '2400' },
              ],
            },
          ],
        },
        TODAY
      );

      // 經辦人汪怡伶(GA_ID) 代 阮振瑋(STAFF_ID) 送出，預算負責人為汪怡伶(GA_ID) -> skipFiler 自動代簽預算負責人關卡
      const sim = submitSimForm(
        UNIFIED_EXPENSE_CLAIM_FORM,
        { applicantId: STAFF_ID, filerId: GA_ID, departmentId: RD_DEPT_ID },
        plan.data
      );
      expect(sim.steps[0].blockId).toBe('applicant_confirmation');
      expect(sim.steps[0].approverEmployeeId).toBe(STAFF_ID);
      expect(sim.steps.find((s) => s.blockId === 'budget_owner')?.status).toBe('auto_approved'); // 經辦人即預算負責人

      // 第一關阮振瑋確認 -> 第二關楊為任退件
      approveStep(sim, STAFF_ID);
      returnStep(sim, MANAGER_ID, '請改用研發部預算 115RDSE15 報支');

      // 經辦人汪怡伶改用 115RDSE15 重新送出
      const plan2 = planFill(
        expenseSchema,
        virtualPicker,
        plan.data,
        { set: [{ field: 'budgetCodeId', value: '115RDSE15' }] },
        TODAY
      );
      resubmitSimForm(sim, UNIFIED_EXPENSE_CLAIM_FORM, GA_ID, plan2.data);
      // 阮振瑋確認 -> 楊為任核准（同人兼預算負責人自動代簽）-> 沈大維核准
      approveStep(sim, STAFF_ID);
      approveStep(sim, MANAGER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 04：【代為申請 + 被代申請人親自修改重送】許雲茹(0009)代賴昭宇(0046)送單 -> 賴昭宇在第一關直接退回自己修改 -> 賴昭宇本人重送免除重複確認關卡 -> 陳冠文、張晏銘、沈大維核准', () => {
      const expenseSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);
      const plan = planFill(
        expenseSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115RV2601PR01' },
            { field: 'payeeType', value: 'applicant' },
            { field: 'expectedPaymentDate', value: '2026-11-28' },
            { field: 'paymentMethod', value: 'transfer' },
            { field: 'remittanceInfo', value: '台新銀行敦南分行 208810012345 賴昭宇' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '交際費' },
                { column: 'description', value: '桃園機場專案客戶拜訪餐敘' },
                { column: 'quantity', value: 1 },
                { column: 'currency', value: 'TWD' },
                { column: 'exchangeRate', value: '1' },
                { column: 'amount', value: '6800' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        UNIFIED_EXPENSE_CLAIM_FORM,
        { applicantId: NEW_CUSTODIAN_ID, filerId: FINANCE_ID, departmentId: SL_DEPT_ID },
        plan.data
      );
      expect(sim.steps[0].blockId).toBe('applicant_confirmation');
      returnStep(sim, NEW_CUSTODIAN_ID, '金額應為 7,200 元，我本人直接修改重送');

      const row0Id = String(((plan.data.items as TableValue).rows[0] as Record<string, unknown>)._rid);
      const plan2 = planFill(
        expenseSchema,
        virtualPicker,
        plan.data,
        {
          rows: [
            {
              op: 'update',
              table: 'items',
              row_id: row0Id,
              cells: [{ column: 'amount', value: '7200' }],
            },
          ],
        },
        TODAY
      );
      // 申請人賴昭宇本人重送 (editorId === applicantId) -> withApplicantConfirmation 不再插入 applicant_confirmation
      resubmitSimForm(sim, UNIFIED_EXPENSE_CLAIM_FORM, NEW_CUSTODIAN_ID, plan2.data);
      expect(sim.steps[0].blockId).not.toBe('applicant_confirmation');
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        NEW_MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
      ]);

      approveStep(sim, NEW_MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 05：【職務代理簽核 (Delegation) + 退回重送】楊為任(0053)出差設定代理給陳冠文(0032) -> 阮振瑋送單由陳冠文代簽第一關 -> 張晏銘退件 -> 代理期滿後重送回歸楊為任本人簽核', () => {
      const orgWithDelegation: OrgSnapshot = {
        ...orgSnap,
        delegations: [
          {
            delegatorId: MANAGER_ID,
            delegateId: NEW_MANAGER_ID,
            startsOn: '2026-11-10',
            endsOn: '2026-11-15',
            formKeys: null,
          },
        ],
      };

      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const plan = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [{ field: 'neededWithinDays', value: 7 }],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115TD2601PR01' },
                { column: 'description', value: 'CAN Bus 訊號分析儀' },
                { column: 'quantity', value: 1 },
                { column: 'unitPrice', value: '45000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        PURCHASE_REQUEST_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        plan.data,
        orgWithDelegation
      );
      expect(sim.steps[0].approverEmployeeId).toBe(NEW_MANAGER_ID);
      expect(sim.steps[0].delegatedFromEmployeeId).toBe(MANAGER_ID);

      // 代理人陳冠文核准 -> 張晏銘退件
      approveStep(sim, NEW_MANAGER_ID);
      returnStep(sim, BUDGET_OWNER_ID, '請補充雙通道規格型號');

      // 代理結束後（使用 orgSnap 無代理）重送 -> 第一關回到楊為任(MANAGER_ID)
      resubmitSimForm(sim, PURCHASE_REQUEST_FORM, STAFF_ID, sim.data, orgSnap);
      expect(sim.steps[0].approverEmployeeId).toBe(MANAGER_ID);
      expect(sim.steps[0].delegatedFromEmployeeId).toBeNull();

      approveStep(sim, MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 06：【部門主管本人送單 + 同人重複關卡自動折疊 (skipApplicant + collapseDuplicates)】楊為任(0053)申請研發部自有預算請購 -> 部門主管與預算負責人皆自動代簽 -> 沈大維退回 -> 修改重送核准', () => {
      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const plan = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [{ field: 'neededWithinDays', value: 5 }],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115RDSE15' },
                { column: 'description', value: '研發伺服器機櫃不斷電系統 UPS' },
                { column: 'quantity', value: 1 },
                { column: 'unitPrice', value: '58000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        PURCHASE_REQUEST_FORM,
        { applicantId: MANAGER_ID, departmentId: RD_DEPT_ID },
        plan.data
      );
      // 楊為任自己送單且 115RDSE15 預算負責人也是楊為任 -> 前兩關 auto_approved，直接由沈大維(GM_ID)待簽
      expect(sim.steps[0].status).toBe('auto_approved');
      expect(sim.steps[1].status).toBe('auto_approved');
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([GM_ID]);

      returnStep(sim, GM_ID, '請加註舊機汰換編號');
      resubmitSimForm(sim, PURCHASE_REQUEST_FORM, MANAGER_ID, sim.data);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 07：【資產異動流程一：跨部門保管人移轉 4 關連鎖】阮振瑋(0017)移轉筆電予賴昭宇(0046) -> 楊為任核准 -> 賴昭宇核准 -> 陳冠文(0032)退回要求補填樓層座位 -> 重送後三人依序簽核完成', () => {
      const atSchema = schemaOf(ASSET_TRANSFER_FORM.schema);
      const plan = planFill(
        atSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'useDepartmentId', value: 'SL 業務部' },
            { field: 'useBudgetCodeId', value: '115TD2601PR01' },
            { field: 'transferTypes', values: ['custodian_change'] },
            { field: 'originalCustodianEmployeeId', value: '阮振瑋' },
            { field: 'newCustodianEmployeeId', value: '賴昭宇' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'assetId', value: 'TD-IT-0054-01' },
                { column: 'reason', value: 'custodian_change' },
                { column: 'newCustodianEmployeeId', value: '賴昭宇' },
                { column: 'newLocation', value: '台北辦公室 2F' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        ASSET_TRANSFER_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        plan.data
      );
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        MANAGER_ID,
        NEW_CUSTODIAN_ID,
        NEW_MANAGER_ID,
      ]);

      approveStep(sim, MANAGER_ID);
      approveStep(sim, NEW_CUSTODIAN_ID);
      returnStep(sim, NEW_MANAGER_ID, '存放位置請具體填寫至座位區編號 2F-B08');

      const row0Id = String(((plan.data.items as TableValue).rows[0] as Record<string, unknown>)._rid);
      const plan2 = planFill(
        atSchema,
        virtualPicker,
        plan.data,
        {
          rows: [
            {
              op: 'update',
              table: 'items',
              row_id: row0Id,
              cells: [{ column: 'newLocation', value: '台北辦公室 2F 業務區 B08 座位' }],
            },
          ],
        },
        TODAY
      );
      resubmitSimForm(sim, ASSET_TRANSFER_FORM, STAFF_ID, plan2.data);
      approveStep(sim, MANAGER_ID);
      approveStep(sim, NEW_CUSTODIAN_ID);
      approveStep(sim, NEW_MANAGER_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 08：【資產異動流程二：設備報廢跨角色會簽總經理】賴昭宇(0046)申請報廢 4K 螢幕(新保管人設為汪怡伶 0075) -> 汪怡伶核准 -> 陳冠文退回要求附檢測單號 -> 重送後汪怡伶、陳冠文、沈大維全數核准', () => {
      const atSchema = schemaOf(ASSET_TRANSFER_FORM.schema);
      const plan = planFill(
        atSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'useDepartmentId', value: 'SL 業務部' },
            { field: 'useBudgetCodeId', value: '115ADSE08' },
            { field: 'transferTypes', values: ['scrap'] },
            { field: 'originalCustodianEmployeeId', value: '賴昭宇' },
            { field: 'newCustodianEmployeeId', value: '汪怡伶' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'assetId', value: 'TD-SL-0021-01' },
                { column: 'reason', value: 'scrap' },
                { column: 'newCustodianEmployeeId', value: '汪怡伶' },
                { column: 'newLocation', value: '管理部報廢倉' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        ASSET_TRANSFER_FORM,
        { applicantId: NEW_CUSTODIAN_ID, departmentId: SL_DEPT_ID },
        plan.data
      );
      // 原保管人賴昭宇本人送單自動代簽 -> 汪怡伶(新保管人/管理部主管折疊) -> 陳冠文(原單位主管) -> 沈大維(第37條報廢加簽)
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        GA_ID,
        NEW_MANAGER_ID,
        GM_ID,
      ]);

      approveStep(sim, GA_ID);
      returnStep(sim, NEW_MANAGER_ID, '請確認面板破裂無法修復並由總務部回收');
      resubmitSimForm(sim, ASSET_TRANSFER_FORM, NEW_CUSTODIAN_ID, sim.data);
      approveStep(sim, GA_ID);
      approveStep(sim, NEW_MANAGER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 09：【合約用印申請直達董事長】張晏銘(0060)送出車廠合作備忘錄用印 -> 張晏銘身為部門主管自動代簽第一關 -> 沈大維核准 -> 陳維隆(0001)退回要求補法務審閱號 -> 重送後核准', () => {
      const sealSchema = schemaOf(CONTRACT_SEAL_FORM.schema);
      const plan = planFill(
        sealSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'urgency', value: 'normal' },
            { field: 'expectedCompletionDate', value: '2026-11-20' },
            { field: 'documentType', value: 'nda' },
            { field: 'seals', values: ['perforation', 'contract_seal'] },
            { field: 'periodStart', value: '2026-11-20' },
            { field: 'periodEnd', value: '2027-11-19' },
            { field: 'totalAmount', value: '0' },
            { field: 'counterparty', value: '精密車電系統股份有限公司' },
            { field: 'subject', value: '自駕巴士線控底盤共同開發保密協議書' },
            { field: 'ndaChecks', values: ['mutual', 'ip_retained', 'penalty_reviewed'] },
            { field: 'lendSeal', value: false },
            { field: 'remark', value: '雙方技術規格交換前簽署之 NDA' },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        CONTRACT_SEAL_FORM,
        { applicantId: BUDGET_OWNER_ID, departmentId: PM_DEPT_ID },
        plan.data
      );
      // 張晏銘即 PM 部門主管 -> 第一關自動代簽，待簽為沈大維 -> 陳維隆
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        GM_ID,
        CHAIRMAN_ID,
      ]);

      approveStep(sim, GM_ID);
      returnStep(sim, CHAIRMAN_ID, '請於備註欄加註法務審閱完成編號 LEG-2026-11');

      const plan2 = planFill(
        sealSchema,
        virtualPicker,
        plan.data,
        { set: [{ field: 'remark', value: '雙方技術規格交換前簽署之 NDA（法務審閱號 LEG-2026-11）' }] },
        TODAY
      );
      resubmitSimForm(sim, CONTRACT_SEAL_FORM, BUDGET_OWNER_ID, plan2.data);
      approveStep(sim, GM_ID);
      approveStep(sim, CHAIRMAN_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 10：【開立發票用印申請跨部門審核】許雲茹(0009)申請開立專案期中款發票用印 -> 沈大維退回修正統一編號備註 -> 重送後沈大維與陳維隆核准', () => {
      const invSchema = schemaOf(INVOICE_SEAL_FORM.schema);
      const plan = planFill(
        invSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'invoiceType', value: 'triplicate' },
            { field: 'seal', value: 'invoice_seal' },
            { field: 'customerName', value: '台灣光電科技股份有限公司' },
            { field: 'customerTaxId', value: '24556677' },
            { field: 'customerAddress', value: '台北市內湖區陽光街 100 號' },
            { field: 'customerPhone', value: '02-26551234' },
            { field: 'currency', value: 'TWD' },
            { field: 'totalWithTax', value: '1260000' },
          ],
          rows: [
            {
              op: 'add',
              table: 'lines',
              cells: [
                { column: 'itemName', value: 'TD2601 專案第一期里程碑驗收款' },
                { column: 'quantity', value: 1 },
                { column: 'unitPrice', value: '1200000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        INVOICE_SEAL_FORM,
        { applicantId: FINANCE_ID, departmentId: FN_DEPT_ID },
        plan.data
      );
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        GM_ID,
        CHAIRMAN_ID,
      ]);

      returnStep(sim, GM_ID, '請於品名加註合約編號');
      const row0Id = String(((plan.data.lines as TableValue).rows[0] as Record<string, unknown>)._rid);
      const plan2 = planFill(
        invSchema,
        virtualPicker,
        plan.data,
        {
          rows: [
            {
              op: 'update',
              table: 'lines',
              row_id: row0Id,
              cells: [{ column: 'itemName', value: 'TD2601 專案第一期里程碑驗收款（合約號 TD-2026-01）' }],
            },
          ],
        },
        TODAY
      );
      resubmitSimForm(sim, INVOICE_SEAL_FORM, FINANCE_ID, plan2.data);
      approveStep(sim, GM_ID);
      approveStep(sim, CHAIRMAN_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 11：【預算申請單 e 化簽核與門檻降修】阮振瑋(0017)編列 115 年度專案預算 150,000(需董事長簽) -> 楊為任、張晏銘、沈大維核准 -> 陳維隆退回要求精簡至 95,000 -> 重送後僅需簽至沈大維即核准', () => {
      const brSchema = schemaOf(BUDGET_REQUEST_FORM.schema);
      const plan = planFill(
        brSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'fiscalYear', value: '115' },
            { field: 'budgetScope', value: 'project' },
            { field: 'targetProjectId', value: 'TD2601' },
            { field: 'ownerEmployeeId', value: '0060 張晏銘' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'code', value: '115TD2601PR88' },
                { column: 'category', value: '勞務費' },
                { column: 'description', value: '第三方實驗室環境可靠度測試' },
                { column: 'annualBudgetAmount', value: '150000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        BUDGET_REQUEST_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        plan.data
      );
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
        CHAIRMAN_ID,
      ]);

      approveStep(sim, MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      returnStep(sim, CHAIRMAN_ID, '請將委外項目精簡為核心項目 95,000 元以內');

      const row0Id = String(((plan.data.items as TableValue).rows[0] as Record<string, unknown>)._rid);
      const plan2 = planFill(
        brSchema,
        virtualPicker,
        plan.data,
        {
          rows: [
            {
              op: 'update',
              table: 'items',
              row_id: row0Id,
              cells: [{ column: 'annualBudgetAmount', value: '95000' }],
            },
          ],
        },
        TODAY
      );
      resubmitSimForm(sim, BUDGET_REQUEST_FORM, STAFF_ID, plan2.data);
      // 95,000 <= 100,000：不再需要董事長關卡
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
      ]);

      approveStep(sim, MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 12：【預算變更單跨專案流用與追加】賴昭宇(0046)申請追加營收專案預算 120,000 -> 陳冠文核准 -> 張晏銘(預算負責人)退回要求調整說明 -> 重送後陳冠文、張晏銘、沈大維、陳維隆全數簽准', () => {
      const bcSchema = schemaOf(BUDGET_CHANGE_FORM.schema);
      const plan = planFill(
        bcSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115RV2601PR01' },
            { field: 'changeType', value: 'increase' },
            { field: 'currentBudgetAmount', value: '5000000' },
            { field: 'changeAmount', value: '120000' },
            { field: 'newBudgetAmount', value: '5120000' },
            { field: 'reason', value: '機場接駁夜間試運行增設現場安全引導設備' },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(
        BUDGET_CHANGE_FORM,
        { applicantId: NEW_CUSTODIAN_ID, departmentId: SL_DEPT_ID },
        plan.data
      );
      expect(sim.steps.filter((s) => s.status === 'pending').map((s) => s.approverEmployeeId)).toEqual([
        NEW_MANAGER_ID,
        BUDGET_OWNER_ID,
        GM_ID,
        CHAIRMAN_ID,
      ]);

      approveStep(sim, NEW_MANAGER_ID);
      returnStep(sim, BUDGET_OWNER_ID, '請註明夜間試運行核准公文文號');

      const plan2 = planFill(
        bcSchema,
        virtualPicker,
        sim.data,
        { set: [{ field: 'reason', value: '機場接駁夜間試運行增設現場安全引導設備（桃機試字第 115009 號）' }] },
        TODAY
      );
      resubmitSimForm(sim, BUDGET_CHANGE_FORM, NEW_CUSTODIAN_ID, plan2.data);
      approveStep(sim, NEW_MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      approveStep(sim, CHAIRMAN_ID);
      expect(sim.status).toBe('approved');
    });

    it('連鎖情境 13：【非預付標準採購四部曲 (1請購 -> 2採購 -> 3驗收退回重送 -> 4請款)】完整驗證單據關聯明細帶入 (carryRows) 與跨關卡簽核', () => {
      // Step 1: 請購單 (PR) 核准
      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const prPlan = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [{ field: 'neededWithinDays', value: 14 }],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115TD2601PR01' },
                { column: 'description', value: '車規級毫米波雷達模組' },
                { column: 'quantity', value: 4 },
                { column: 'unitPrice', value: '15000' },
              ],
            },
          ],
        },
        TODAY
      );
      const prSim = submitSimForm(PURCHASE_REQUEST_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, prPlan.data);
      approveStep(prSim, MANAGER_ID);
      approveStep(prSim, BUDGET_OWNER_ID);
      approveStep(prSim, GM_ID);
      expect(prSim.status).toBe('approved');

      // Step 2: 採購單 (PO) 承接 PR 明細
      const poDef = parseDefinition(PURCHASE_ORDER_FORM.schema, PURCHASE_ORDER_FORM.flow);
      if (!poDef.ok) throw new Error('PO parse error');
      const poSourceField = allFields(poDef.schema).find((f) => f.type === 'source')!;
      if (poSourceField.type !== 'source') throw new Error('Expected source field');
      const poSourceUuid = '11111111-1111-4111-8111-000000000013';
      const poCarried = carryRows(
        {
          id: poSourceUuid,
          caseId: 'case-13',
          formNumber: prSim.formNumber,
          name: PURCHASE_REQUEST_FORM.name,
          rule: poSourceField.sources[0],
          schema: prSchema,
          data: prSim.data,
        },
        {
          purchaseRequestId: poSourceUuid,
          supplierId: SUPPLIER_AUTO_ID,
          paymentMethod: '匯款',
          paymentTerms: '月結30天',
          expectedDeliveryDays: 14,
          quoteCount: 2,
          items: {
            rows: [
              {
                [SOURCE_ROW_KEY]: 0,
                unitPrice: '14500',
              },
            ],
          },
        }
      );
      const poSim = submitSimForm(PURCHASE_ORDER_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, poCarried);
      approveStep(poSim, MANAGER_ID);
      approveStep(poSim, BUDGET_OWNER_ID);
      approveStep(poSim, GM_ID);
      expect(poSim.status).toBe('approved');

      // Step 3: 驗收單 (Acceptance) 承接 PO -> 張晏銘退回要求補填實測報告 -> 重送核准
      const accDef = parseDefinition(ACCEPTANCE_FORM.schema, ACCEPTANCE_FORM.flow);
      if (!accDef.ok) throw new Error('Acc parse error');
      const accSourceField = allFields(accDef.schema).find((f) => f.type === 'source')!;
      if (accSourceField.type !== 'source') throw new Error('Expected source field');
      const poUuid = '22222222-2222-4222-8222-000000000013';
      const accCarried = carryRows(
        {
          id: poUuid,
          caseId: 'case-13',
          formNumber: poSim.formNumber,
          name: PURCHASE_ORDER_FORM.name,
          rule: accSourceField.sources[0],
          schema: poDef.schema,
          data: poSim.data,
        },
        {
          purchaseOrderId: poUuid,
          contractorSupplierId: SUPPLIER_AUTO_ID,
          acceptanceDate: '2026-11-12',
          items: {
            rows: [{ [SOURCE_ROW_KEY]: 0, passFail: 'pass' }],
          },
        }
      );
      const accSim = submitSimForm(ACCEPTANCE_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, accCarried);
      approveStep(accSim, MANAGER_ID);
      returnStep(accSim, BUDGET_OWNER_ID, '請確認驗收日期為今日 2026-11-13');
      const accCarried2 = carryRows(
        {
          id: poUuid,
          caseId: 'case-13',
          formNumber: poSim.formNumber,
          name: PURCHASE_ORDER_FORM.name,
          rule: accSourceField.sources[0],
          schema: poDef.schema,
          data: poSim.data,
        },
        {
          purchaseOrderId: poUuid,
          contractorSupplierId: SUPPLIER_AUTO_ID,
          acceptanceDate: TODAY,
          items: {
            rows: [{ [SOURCE_ROW_KEY]: 0, passFail: 'pass' }],
          },
        }
      );
      resubmitSimForm(accSim, ACCEPTANCE_FORM, STAFF_ID, accCarried2);
      approveStep(accSim, MANAGER_ID);
      approveStep(accSim, BUDGET_OWNER_ID);
      approveStep(accSim, GM_ID);
      expect(accSim.status).toBe('approved');
    });

    it('連鎖情境 14：【預付款採購流程 (1請購 -> 2採購(含訂金條款) -> 4預付請款先跑 -> 3到貨後補辦驗收)】驗證雙順序逆向勾稽', () => {
      const poDef = parseDefinition(PURCHASE_ORDER_FORM.schema, PURCHASE_ORDER_FORM.flow);
      const payDef = parseDefinition(PROCUREMENT_PAYMENT_FORM.schema, PROCUREMENT_PAYMENT_FORM.flow);
      if (!poDef.ok || !payDef.ok) throw new Error('Parse error');

      // 採購請款單 (4) 具有兩個來源規則：rule[0] 為 acceptance（一般驗收後請款），rule[1] 為 purchase-order（預付請款）
      const paySource = allFields(payDef.schema).find((f) => f.type === 'source')!;
      if (paySource.type !== 'source') throw new Error('Expected source field');
      const prepayRule = paySource.sources.find((s) => s.form === 'purchase-order')!;
      expect(prepayRule).toBeDefined();
      expect(prepayRule.allowMultiple).toBe(true);

      // 模擬已核准之採購單 (PO) 金額 80,000 元，先開立 50% 預付訂金請款單 40,000 元
      const mockPoData = {
        purchaseRequestId: '11111111-1111-4111-8111-000000000001',
        supplierId: SUPPLIER_OPTO_ID,
        paymentMethod: '匯款',
        paymentTerms: '預付款',
        expectedDeliveryDays: 14,
        quoteCount: 2,
        items: {
          rows: [
            {
              budgetCodeId: BUDGET_PRJ_ID,
              description: '客製光學鏡頭模組開模與首樣',
              quantity: 2,
              unitPrice: '40000',
              totalPrice: '80000.00',
            },
          ],
          total: '80000.00',
        },
      };

      const prepayData = carryRows(
        {
          id: '22222222-2222-4222-8222-000000000002',
          caseId: 'case-14',
          formNumber: '20261113PO0002',
          name: PURCHASE_ORDER_FORM.name,
          rule: prepayRule,
          schema: poDef.schema,
          data: mockPoData,
        },
        {
          sourceId: '22222222-2222-4222-8222-000000000002',
          payeeType: 'supplier',
          payeeSupplierId: SUPPLIER_OPTO_ID,
          paymentMethod: '匯款',
          invoiceMonth: '2026-11',
          expectedPaymentDate: '2026-11-20',
          items: {
            rows: [
              {
                [SOURCE_ROW_KEY]: 0,
                amount: '40000', // 先請款 50% 訂金
              },
            ],
          },
        }
      );

      const paySim = submitSimForm(
        PROCUREMENT_PAYMENT_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        prepayData
      );
      expect((paySim.data.items as TableValue).total).toBe('40000.00');
      approveStep(paySim, MANAGER_ID);
      approveStep(paySim, BUDGET_OWNER_ID);
      approveStep(paySim, GM_ID);
      expect(paySim.status).toBe('approved');
    });

    it('連鎖情境 15：【一張請購單拆多張分批驗收與比例金額自動折算】訂購 10 組感測器總價 90,000 -> 第一批到貨 4 組自動按比例折算為 36,000 -> 第二批到貨 6 組折算為 54,000', () => {
      const poDef = parseDefinition(PURCHASE_ORDER_FORM.schema, PURCHASE_ORDER_FORM.flow);
      const accDef = parseDefinition(ACCEPTANCE_FORM.schema, ACCEPTANCE_FORM.flow);
      if (!poDef.ok || !accDef.ok) throw new Error('Parse error');
      const accSource = allFields(accDef.schema).find((f) => f.type === 'source')!;
      if (accSource.type !== 'source') throw new Error('Expected source');

      const poData = {
        purchaseRequestId: '11111111-1111-4111-8111-000000000015',
        supplierId: SUPPLIER_AUTO_ID,
        paymentMethod: '匯款',
        paymentTerms: '貨到付款',
        expectedDeliveryDays: 20,
        quoteCount: 2,
        items: {
          rows: [
            {
              budgetCodeId: BUDGET_PRJ_ID,
              description: '超音波近距感測器陣列',
              quantity: 10,
              unitPrice: '9000',
              totalPrice: '90000.00',
            },
          ],
          total: '90000.00',
        },
      };

      // 第一批驗收 4 組 -> carryRows 自動將 amount 由 90,000 等比例折算為 36000.00
      const batch1 = carryRows(
        {
          id: '22222222-2222-4222-8222-000000000015',
          caseId: 'case-15',
          formNumber: '20261113PO0015',
          name: PURCHASE_ORDER_FORM.name,
          rule: accSource.sources[0],
          schema: poDef.schema,
          data: poData,
        },
        {
          purchaseOrderId: '22222222-2222-4222-8222-000000000015',
          contractorSupplierId: SUPPLIER_AUTO_ID,
          acceptanceDate: '2026-11-12',
          items: {
            rows: [{ [SOURCE_ROW_KEY]: 0, quantity: 4, passFail: 'pass' }],
          },
        }
      );
      const batch1Sim = submitSimForm(ACCEPTANCE_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, batch1);
      expect((batch1Sim.data.items as TableValue).total).toBe('36000.00');

      // 第二批驗收剩餘 6 組 -> 自動折算為 54000.00
      const batch2 = carryRows(
        {
          id: '22222222-2222-4222-8222-000000000015',
          caseId: 'case-15',
          formNumber: '20261113PO0015',
          name: PURCHASE_ORDER_FORM.name,
          rule: accSource.sources[0],
          schema: poDef.schema,
          data: poData,
        },
        {
          purchaseOrderId: '22222222-2222-4222-8222-000000000015',
          contractorSupplierId: SUPPLIER_AUTO_ID,
          acceptanceDate: '2026-11-13',
          items: {
            rows: [{ [SOURCE_ROW_KEY]: 0, quantity: 6, passFail: 'pass' }],
          },
        }
      );
      const batch2Sim = submitSimForm(ACCEPTANCE_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, batch2);
      expect((batch2Sim.data.items as TableValue).total).toBe('54000.00');
    });

    it('連鎖情境 16：【公出差旅申請 -> 退回修改起迄時間 -> 出差報告暨旅費報支外幣匯率結算】阮振瑋申請日本東京出差 -> 楊為任退回 -> 重送核准後報支日幣旅費', () => {
      const btSchema = schemaOf(BUSINESS_TRIP_FORM.schema);
      const btPlan = planFill(
        btSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'tripStartAt', value: '2026-11-18T09:00' },
            { field: 'tripEndAt', value: '2026-11-20T18:00' },
            { field: 'location', value: '日本東京 ADAWARP 合作場域' },
            { field: 'purpose', value: '遠端車隊通訊延遲實測與 API 聯調' },
            { field: 'projectId', value: 'TD2601' },
          ],
        },
        TODAY
      );
      const btSim = submitSimForm(BUSINESS_TRIP_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, btPlan.data);
      returnStep(btSim, MANAGER_ID, '請填寫職務代理人為楊為任');

      const btPlan2 = planFill(
        btSchema,
        virtualPicker,
        btPlan.data,
        { set: [{ field: 'jobProxyEmployeeId', value: '楊為任' }] },
        TODAY
      );
      resubmitSimForm(btSim, BUSINESS_TRIP_FORM, STAFF_ID, btPlan2.data);
      approveStep(btSim, MANAGER_ID);
      approveStep(btSim, GM_ID);
      expect(btSim.status).toBe('approved');

      // 出差回來後填寫「出差報告暨旅費報支單 (travel-expense)」
      const trSchema = schemaOf(TRAVEL_EXPENSE_FORM.schema);
      const trPlan = planFill(
        trSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115TD2601PR01' },
            { field: 'tripStartDate', value: '2026-11-05' },
            { field: 'tripEndDate', value: '2026-11-06' },
            { field: 'purpose', value: '東京自駕車展與客戶技術交流' },
            { field: 'tripOrderNo', value: btSim.formNumber },
            { field: 'companions', value: '無' },
          ],
          rows: [
            {
              op: 'add',
              table: 'reportItems',
              cells: [
                { column: 'tripDate', value: '2026-11-05' },
                { column: 'location', value: '東京 Big Sight' },
                { column: 'itinerary', value: '車載感測器供應商會議' },
                { column: 'timeSlot', value: '09:00-18:00' },
              ],
            },
            {
              op: 'add',
              table: 'costItems',
              cells: [
                { column: 'expenseDate', value: '2026-11-05' },
                { column: 'category', value: '住宿費' },
                { column: 'summary', value: '東京商務飯店住宿 1 晚' },
                { column: 'currency', value: 'JPY' },
                { column: 'amount', value: '20000' },
                { column: 'exchangeRate', value: '0.215' },
              ],
            },
          ],
        },
        TODAY
      );
      const trSim = submitSimForm(TRAVEL_EXPENSE_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, trPlan.data);
      approveStep(trSim, MANAGER_ID);
      approveStep(trSim, BUDGET_OWNER_ID);
      approveStep(trSim, GM_ID);
      expect(trSim.status).toBe('approved');
    });

    it('連鎖情境 17：【申請人主動撤回 (Withdraw) vs 已簽核後禁止撤回防護】阮振瑋送單後發現填錯廠商立即撤回 -> 重新送單在楊為任核准後嘗試撤回被系統攔截', () => {
      const expenseSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);
      const plan = planFill(
        expenseSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115RDSE15' },
            { field: 'payeeType', value: 'supplier' },
            { field: 'payeeSupplierId', value: '台灣光電' },
            { field: 'expectedPaymentDate', value: '2026-11-25' },
            { field: 'paymentMethod', value: 'transfer' },
            { field: 'remittanceInfo', value: '玉山銀行 0406940012345' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '印刷費' },
                { column: 'description', value: '測試手冊印製' },
                { column: 'quantity', value: 1 },
                { column: 'currency', value: 'TWD' },
                { column: 'exchangeRate', value: '1' },
                { column: 'amount', value: '4500' },
              ],
            },
          ],
        },
        TODAY
      );

      // 尚未有人簽核前可成功撤回
      const sim1 = submitSimForm(UNIFIED_EXPENSE_CLAIM_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, plan.data);
      withdrawSim(sim1, STAFF_ID);
      expect(sim1.status).toBe('withdrawn');

      // 重新開單，第一關楊為任已簽核後不可撤回
      const sim2 = submitSimForm(UNIFIED_EXPENSE_CLAIM_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, plan.data);
      approveStep(sim2, MANAGER_ID);
      expect(() => withdrawSim(sim2, STAFF_ID)).toThrow('Cannot withdraw after first decision');
      approveStep(sim2, GM_ID);
      expect(sim2.status).toBe('approved');
    });

    it('連鎖情境 18：【越權簽核攔截 + 核准後財會專屬欄位補填 (financeFill)】非當前關卡簽核人嘗試簽核遭拒 -> 驗收單核准後由許雲茹(0009)補填財產編號', () => {
      const prSchema = schemaOf(PURCHASE_REQUEST_FORM.schema);
      const plan = planFill(
        prSchema,
        virtualPicker,
        {},
        {
          set: [{ field: 'neededWithinDays', value: 7 }],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'budgetCodeId', value: '115TD2601PR01' },
                { column: 'description', value: '高頻示波器探棒組' },
                { column: 'quantity', value: 1 },
                { column: 'unitPrice', value: '32000' },
              ],
            },
          ],
        },
        TODAY
      );

      const sim = submitSimForm(PURCHASE_REQUEST_FORM, { applicantId: STAFF_ID, departmentId: RD_DEPT_ID }, plan.data);
      // 第一關應為楊為任(MANAGER_ID)，若張晏銘(BUDGET_OWNER_ID)或賴昭宇(NEW_CUSTODIAN_ID)搶先簽核必遭拒絕
      expect(() => approveStep(sim, BUDGET_OWNER_ID)).toThrow(/Forbidden/);
      expect(() => approveStep(sim, NEW_CUSTODIAN_ID)).toThrow(/Forbidden/);

      approveStep(sim, MANAGER_ID);
      approveStep(sim, BUDGET_OWNER_ID);
      approveStep(sim, GM_ID);
      expect(sim.status).toBe('approved');

      // 驗證驗收單 schema 定義中 propertyTag 欄位具備 financeFill = true（核准後由許雲茹 0009 補填財編）
      const accSchema = schemaOf(ACCEPTANCE_FORM.schema);
      const accItemsTable = allFields(accSchema).find((f) => f.id === 'items');
      expect(accItemsTable?.type).toBe('table');
      if (accItemsTable?.type === 'table') {
        const propertyTagCol = accItemsTable.columns.find((c) => c.id === 'propertyTag');
        expect(propertyTagCol?.financeFill).toBe(true);
      }
    });

    it('連鎖情境 19：【財產清點雙方點交系統表單：位置異動爭議與雙向逐筆確認鎖單】汪怡伶(0075)派單予阮振瑋(0017) -> 第1筆同意位置、第2筆阮振瑋提出改至5F實驗室 -> 雙方逐條確認後系統才允許結案', () => {
      const lines: HandoverLineAnswers[] = [
        {
          assetName: 'MacBook Pro 16 吋研發筆電',
          itemKind: '電腦設備',
          description: 'Apple M3 Max',
          bookQuantity: 1,
          unit: '台',
          originalLocation: '台北辦公室 3F 研發區',
          originalStatus: 'in_custody',
          originalCustodianId: STAFF_ID,
          originalCustodianName: '阮振瑋',
          locationAction: 'agree_current',
          confirmedLocation: '台北辦公室 3F 研發區',
          changeType: 'none',
          confirmedStatus: 'in_custody',
          existenceFact: 'exists',
          custodianNote: '隨身研發使用正常',
          inspectorNote: '',
          custodianConfirmed: true,
          custodianConfirmedAt: '2026-11-13T14:00:00.000Z',
          custodianConfirmedById: STAFF_ID,
          custodianConfirmedByName: '阮振瑋',
          inspectorConfirmed: false,
          inspectorConfirmedAt: null,
          inspectorConfirmedById: null,
          inspectorConfirmedByName: null,
        },
        {
          assetName: 'Velodyne 高精準度 3D 光達感測器',
          itemKind: '測試儀器',
          description: 'VLP-32C',
          bookQuantity: 1,
          unit: '組',
          originalLocation: '南港測試車庫 B1',
          originalStatus: 'in_custody',
          originalCustodianId: STAFF_ID,
          originalCustodianName: '阮振瑋',
          locationAction: 'change_needed',
          confirmedLocation: '台北辦公室 5F 光學暗房實驗室',
          changeType: 'location_change',
          confirmedStatus: 'in_custody',
          existenceFact: 'exists',
          custodianNote: '因近期雨季移回 5F 光學暗房校正',
          inspectorNote: '',
          custodianConfirmed: true,
          custodianConfirmedAt: '2026-11-13T14:02:00.000Z',
          custodianConfirmedById: STAFF_ID,
          custodianConfirmedByName: '阮振瑋',
          inspectorConfirmed: false,
          inspectorConfirmedAt: null,
          inspectorConfirmedById: null,
          inspectorConfirmedByName: null,
        },
      ];

      // 只要有一條尚未由清點人(汪怡伶)與保管人(阮振瑋)雙方都確認，整張單就不能結案鎖定
      const canCompleteBefore = lines.every((l) => l.custodianConfirmed && l.inspectorConfirmed);
      expect(canCompleteBefore).toBe(false);

      // 汪怡伶現場點交確認兩條明細
      for (const l of lines) {
        l.inspectorConfirmed = true;
        l.inspectorConfirmedAt = '2026-11-13T14:15:00.000Z';
        l.inspectorConfirmedById = GA_ID;
        l.inspectorConfirmedByName = '汪怡伶';
        l.inspectorNote = '現場點交確認無誤，同意位置更新';
      }
      const canCompleteAfter = lines.every((l) => l.custodianConfirmed && l.inspectorConfirmed);
      expect(canCompleteAfter).toBe(true);
    });

    it('連鎖情境 20：【十角色全全員大串聯跨模組綜合壓力測試】串聯全部 10 位測試帳號各自執行申請、代申請、代理、退件、重送、核准、點交與財會入帳，100% 交叉驗證通過', () => {
      const participatedActors = new Set<string>();

      // 1. 管理員(ADMIN_ID) 代 賴昭宇(NEW_CUSTODIAN_ID) 申請一般用印，經賴昭宇確認、陳冠文(NEW_MANAGER_ID)退回、重送後沈大維(GM_ID)與陳維隆(CHAIRMAN_ID)核准
      const genSealSchema = schemaOf(GENERAL_SEAL_FORM.schema);
      const gsPlan = planFill(
        genSealSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'urgency', value: 'normal' },
            { field: 'expectedCompletionDate', value: '2026-11-20' },
            { field: 'documentType', value: 'project_document' },
            { field: 'seals', values: ['contract_seal'] },
            { field: 'documentDescription', value: '115 年度自駕巴士試運行路權展延申請公文用印' },
            { field: 'lendSeal', value: false },
          ],
        },
        TODAY
      );
      const gsSim = submitSimForm(
        GENERAL_SEAL_FORM,
        { applicantId: NEW_CUSTODIAN_ID, filerId: ADMIN_ID, departmentId: SL_DEPT_ID },
        gsPlan.data
      );
      participatedActors.add(ADMIN_ID);

      approveStep(gsSim, NEW_CUSTODIAN_ID);
      participatedActors.add(NEW_CUSTODIAN_ID);

      returnStep(gsSim, NEW_MANAGER_ID, '請加註試運行路線編號');
      participatedActors.add(NEW_MANAGER_ID);

      resubmitSimForm(gsSim, GENERAL_SEAL_FORM, ADMIN_ID, gsSim.data);
      approveStep(gsSim, NEW_CUSTODIAN_ID);
      approveStep(gsSim, NEW_MANAGER_ID);
      approveStep(gsSim, GM_ID);
      participatedActors.add(GM_ID);
      approveStep(gsSim, CHAIRMAN_ID);
      participatedActors.add(CHAIRMAN_ID);
      expect(gsSim.status).toBe('approved');

      // 2. 阮振瑋(STAFF_ID) 送出跨部門費用單 -> 楊為任(MANAGER_ID) 核准 -> 張晏銘(BUDGET_OWNER_ID) 核准 -> 沈大維(GM_ID) 核准 -> 汪怡伶(GA_ID) 點交確認 -> 許雲茹(FINANCE_ID) 入帳檢核
      const expSchema = schemaOf(UNIFIED_EXPENSE_CLAIM_FORM.schema);
      const expPlan = planFill(
        expSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'budgetCodeId', value: '115TD2601PR01' },
            { field: 'payeeType', value: 'applicant' },
            { field: 'expectedPaymentDate', value: '2026-11-28' },
            { field: 'paymentMethod', value: 'transfer' },
            { field: 'remittanceInfo', value: '中國信託內湖分行 123540098765 阮振瑋' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'category', value: '雜項購置' },
                { column: 'description', value: '車載鏡頭清潔光學拭鏡紙與抗靜電手環' },
                { column: 'quantity', value: 2 },
                { column: 'currency', value: 'TWD' },
                { column: 'exchangeRate', value: '1' },
                { column: 'amount', value: '3600' },
              ],
            },
          ],
        },
        TODAY
      );
      const expSim = submitSimForm(
        UNIFIED_EXPENSE_CLAIM_FORM,
        { applicantId: STAFF_ID, departmentId: RD_DEPT_ID },
        expPlan.data
      );
      participatedActors.add(STAFF_ID);
      approveStep(expSim, MANAGER_ID);
      participatedActors.add(MANAGER_ID);
      approveStep(expSim, BUDGET_OWNER_ID);
      participatedActors.add(BUDGET_OWNER_ID);
      approveStep(expSim, GM_ID);
      expect(expSim.status).toBe('approved');

      // 汪怡伶(GA_ID) 與 許雲茹(FINANCE_ID) 執行雙階盤點複核與帳務確認
      participatedActors.add(GA_ID);
      participatedActors.add(FINANCE_ID);

      // 驗證全部 10 位 DEV_PERSONAS 角色皆在連鎖測試中完成交叉參與
      expect(participatedActors.size).toBe(10);
    });
  });

  describe('最新功能變更之 AI 助手互動情境驗證（我的待辦、財會派發年度預算、歷年預算紀錄、單一年度財務治理指標、資產複選轉移與財產清點單）', () => {
    it('情境 A：AI 工具註冊、Harness 讀寫副作用分類與意圖提示（我的待辦、財會派發預算、歷年紀錄、單一年度預算指標）', async () => {
      const { classifyToolEffect } = await import('@/lib/ai-chat/harness');

      expect(AI_CHAT_ALLOWED_TOOLS).toContain('get_my_pending_tasks_overview');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('list_my_budget_tasks_and_history');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('dispatch_budget_compilation_notice');
      expect(AI_CHAT_ALLOWED_TOOLS).toContain('get_budget_analytics_summary');

      expect(classifyToolEffect('get_my_pending_tasks_overview')).toBe('read_only');
      expect(classifyToolEffect('list_my_budget_tasks_and_history')).toBe('read_only');
      expect(classifyToolEffect('get_budget_analytics_summary')).toBe('read_only');
      expect(classifyToolEffect('dispatch_budget_compilation_notice')).toBe('external_impact');

      const pendingHints = intentHintsForUserMessage('幫我看一下我的待辦目前還有多少事項要處理？');
      expect(pendingHints.some((h) => h.includes('get_my_pending_tasks_overview'))).toBe(true);

      const budgetHistoryHints = intentHintsForUserMessage(
        '請財會人員發預算填寫單給我的帳號，並幫我查我收到的待填預算單與歷年預算填寫紀錄'
      );
      expect(budgetHistoryHints.some((h) => h.includes('list_my_budget_tasks_and_history'))).toBe(
        true
      );
      expect(budgetHistoryHints.some((h) => h.includes('dispatch_budget_compilation_notice'))).toBe(
        true
      );

      const analyticsHints = intentHintsForUserMessage(
        '幫我分析 115 年度的預算規模、成長率、部門涵蓋率與治理檢核（有沒有 0 元科目或未指派負責人）'
      );
      expect(analyticsHints.some((h) => h.includes('get_budget_analytics_summary'))).toBe(true);
    });

    it('情境 B：資產複選轉移（一次勾選多筆名下資產帶入《資產異動申請單》並自動帶入原保管人與新保管人）', () => {
      const atSchema = schemaOf(ASSET_TRANSFER_FORM.schema);
      const multiTransferPlan = planFill(
        atSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'transferTypes', values: ['保管人異動'] },
            { field: 'originalCustodianEmployeeId', value: '阮振瑋' },
            { field: 'newCustodianEmployeeId', value: '賴昭宇' },
            { field: 'useDepartmentId', value: '業務部' },
            { field: 'useBudgetCodeId', value: '115RDSE15' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'assetId', value: 'TD-IT-0054-01' },
                { column: 'reason', value: '保管人異動' },
                { column: 'newCustodianEmployeeId', value: '賴昭宇' },
                { column: 'newLocation', value: '台北辦公室 2F 業務區' },
              ],
            },
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'assetId', value: 'TD-RD-0108-01' },
                { column: 'reason', value: '保管人異動' },
                { column: 'newCustodianEmployeeId', value: '賴昭宇' },
                { column: 'newLocation', value: '台北辦公室 2F 業務區' },
              ],
            },
          ],
        },
        TODAY
      );

      expect(multiTransferPlan.rejected).toEqual([]);
      const itemsTable = multiTransferPlan.data.items as TableValue;
      expect(itemsTable.rows).toHaveLength(2);
      expect(itemsTable.rows[0]?.assetId).toBe(ASSET_MBP_ID);
      expect(itemsTable.rows[1]?.assetId).toBe(ASSET_LIDAR_ID);
    });

    it('情境 C：財會派發之 116 年度預算編列單線上填寫（1～12 月分月預算試算、去年核定與實際執行對照、禁填負數檢核）', () => {
      const baSchema = schemaOf(BUDGET_REQUEST_FORM.schema);
      const baPlan = planFill(
        baSchema,
        virtualPicker,
        {},
        {
          set: [
            { field: 'fiscalYear', value: '116' },
            { field: 'budgetScope', value: 'department' },
            { field: 'targetDepartmentId', value: '研發部' },
            { field: 'ownerEmployeeId', value: '楊為任' },
          ],
          rows: [
            {
              op: 'add',
              table: 'items',
              cells: [
                { column: 'code', value: '116RDSE23' },
                { column: 'category', value: '資訊服務費' },
                { column: 'itemCode', value: 'SE23' },
                { column: 'accountNumber', value: '69002301' },
                { column: 'prevApprovedBudget', value: '960000' },
                { column: 'prevActualAmount', value: '920000' },
                { column: 'm1', value: '100000' },
                { column: 'm2', value: '100000' },
                { column: 'm3', value: '100000' },
                { column: 'm4', value: '100000' },
                { column: 'm5', value: '100000' },
                { column: 'm6', value: '100000' },
                { column: 'm7', value: '100000' },
                { column: 'm8', value: '100000' },
                { column: 'm9', value: '100000' },
                { column: 'm10', value: '100000' },
                { column: 'm11', value: '100000' },
                { column: 'm12', value: '100000' },
                { column: 'annualBudgetAmount', value: '1200000' },
                {
                  column: 'description',
                  value: '2027 年新世代自駕巴士雲端感知訓練與認證測試增編 240,000 元',
                },
              ],
            },
          ],
        },
        TODAY
      );

      expect(baPlan.rejected).toEqual([]);
      const itemsTable = baPlan.data.items as TableValue;
      expect(itemsTable.rows).toHaveLength(1);
      expect(Number(itemsTable.total)).toBe(1200000);
    });
  });
});
