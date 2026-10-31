import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getCurrentEmployee, type CurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { formSubmissions } from '@/lib/db/schema';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { getCaseOverview } from '@/lib/cases/queries';
import { getFilableDefinitions } from '@/lib/custom-forms/queries';
import { getMyExpenseClaims } from '@/lib/expense-claims/queries';
import { getMyNotifications } from '@/lib/notifications/queries';
import { FORM_LABELS, FORM_ROUTE_PREFIX, type FormType } from '@/lib/procurement/form-registry';
import { getMyPurchaseOrders } from '@/lib/purchase-orders/queries';
import { getMyRequests, getPurchaseRequestDetail } from '@/lib/purchase-requests/queries';
import { getFormApprovalSnapshot, formatWaitingDuration } from './approval-snapshot';
import type { AiMessageBlock } from './blocks';
import { buildChangeConfirmCard, buildFieldFormCard, buildTripCarryOverCard } from './block-actions';
import { getDraftForOwner, isDraftInConversation, loadDraftFormContext } from './drafts';
import { draftStatus, type FillRequest } from './draft-fill';
import { createDraftWithFill, fillDraft, formSpec, loadFilableForm, type DraftFillResult, type FillOptions } from './draft-work';
import { attachApprovedSnapshotToDraft } from './attach-approved';
import { attachStagedFilesToDraft } from './attach-staged';
import { getOrCreateApprovedPdfSnapshot } from './approved-pdf';
import { draftOpenResource, type OpenResourceEvent } from './open-resource';
import { loadAssistantInbox } from './inbox';
import { previewNudge } from './nudge';
import { listRecentProjectsForEmployee, searchProjectsPaged } from './projects';
import { startResubmission } from './resubmit';
import { searchMyCustomSubmissions } from './submissions-search';

/** Only these names may be executed. Anything else is rejected. */
export const AI_CHAT_ALLOWED_TOOLS = [
  'get_my_profile',
  'list_recent_projects',
  'search_projects',
  'search_budget_codes',
  'list_filable_forms',
  'list_form_catalog',
  'list_my_approval_queue',
  'list_my_purchase_requests',
  'list_my_purchase_orders',
  'list_my_expense_claims',
  'list_my_notifications',
  'get_purchase_request_detail',
  'get_case_overview',
  'get_form_approval_status',
  'get_form_spec',
  'create_application_draft',
  'describe_application_draft',
  'update_application_draft',
  'propose_choices',
  'propose_project_picker',
  'propose_field_form',
  'propose_draft_changes',
  'propose_nudge',
  'start_resubmission',
  'search_my_submissions',
  'propose_approved_document_picker',
  'attach_approved_document_pdf',
  'attach_staged_files_to_draft',
] as const;

export type AiToolContext = {
  conversationId: string;
  ownerEmployeeId: string;
  /**
   * Resolved session employee for this turn (set by the server-side turn
   * runner). Falls back to the request session when absent.
   */
  actor?: import('@/lib/auth/current-employee').CurrentEmployee;
  /** User turn clientMessageId — used for create_application_draft idempotency. */
  turnId?: string | null;
  /** Ready staged attachment IDs from this user turn (for attach_staged_files_to_draft). */
  recentStagedIds?: string[];
  /** Test-only draft write fault injection (ignored in production). */
  fill?: FillOptions;
};

export type AiChatToolName = (typeof AI_CHAT_ALLOWED_TOOLS)[number];

const ALLOWED = new Set<string>(AI_CHAT_ALLOWED_TOOLS);

const SET_SCHEMA = {
  type: 'ARRAY',
  description: '要寫入的欄位。value 一律用字串：日期時間 YYYY-MM-DDTHH:mm（台北時間）、日期 YYYY-MM-DD、金額數字、選項用選項文字、人員／專案等參照用名稱或代碼（後端比對，不唯一會回傳候選）。複選用 values。',
  items: {
    type: 'OBJECT',
    properties: {
      field: { type: 'STRING', description: '欄位 id' },
      value: { type: 'STRING' },
      values: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['field'],
  },
} as const;

const ROWS_SCHEMA = {
  type: 'ARRAY',
  description: '明細列操作。add 新增一列；update／delete 需 row_id（工作狀態或上次回傳的 row_id）。只送要改的列與欄，其他列不受影響；合計由系統計算。',
  items: {
    type: 'OBJECT',
    properties: {
      op: { type: 'STRING', enum: ['add', 'update', 'delete'] },
      table: { type: 'STRING', description: '明細欄位 id' },
      row_id: { type: 'STRING' },
      cells: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { column: { type: 'STRING', description: '明細欄 id' }, value: { type: 'STRING' } },
          required: ['column', 'value'],
        },
      },
    },
    required: ['op', 'table'],
  },
} as const;

export const AI_CHAT_TOOL_DECLARATIONS = [
  {
    name: 'get_my_profile',
    description: '讀取目前登入使用者的基本資料（姓名、工號、部門、角色）。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_recent_projects',
    description: '列出目前使用者最近使用過的專案（最多 5 筆）。若無使用紀錄則回傳空列表。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'search_projects',
    description: '依關鍵字在後端搜尋 ACCSYS 專案（代碼或名稱），分頁上限 25。',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: '關鍵字，至少 1 字' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_budget_codes',
    description: '依關鍵字搜尋預算科目（代碼、部門、專案、類別）。金額僅在有權限時可見。',
    parameters: {
      type: 'OBJECT',
      properties: { query: { type: 'STRING', description: '關鍵字' } },
      required: ['query'],
    },
  },
  {
    name: 'list_filable_forms',
    description: '列出目前使用者可以新開的已發佈表單。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_form_catalog',
    description: '列出 ACCSYS 內建表單類型中文名稱與頁面路徑前綴（說明用）。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_my_approval_queue',
    description: '列出目前使用者待簽核的單據摘要。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_my_purchase_requests',
    description: '列出目前使用者自己的請購單摘要。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_my_purchase_orders',
    description: '列出目前使用者自己的採購單摘要。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_my_expense_claims',
    description: '列出目前使用者自己的費用申請單摘要。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_my_notifications',
    description: '列出目前使用者最近的系統通知。',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_purchase_request_detail',
    description: '讀取一筆請購單明細（僅限目前使用者有權限閱讀的單據）。',
    parameters: {
      type: 'OBJECT',
      properties: { request_id: { type: 'STRING', description: '請購單 UUID' } },
      required: ['request_id'],
    },
  },
  {
    name: 'get_case_overview',
    description: '依案號查詢請採驗費用鏈概況（僅參與者可見；無權限的步驟會標示受限）。',
    parameters: {
      type: 'OBJECT',
      properties: { case_number: { type: 'STRING', description: '案號' } },
      required: ['case_number'],
    },
  },
  {
    name: 'get_form_approval_status',
    description: '查詢單據目前簽核節點、待簽核人與等待多久（依節點開始等待時間）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_type: { type: 'STRING', description: '表單類型，例如 purchase_request 或 custom' },
        form_id: { type: 'STRING', description: '單據 UUID' },
      },
      required: ['form_type', 'form_id'],
    },
  },
  {
    name: 'get_form_spec',
    description:
      '取得某張可填表單的完整欄位規格（欄位 id、型別、必填、合法選項、日期格式、明細欄、參照欄位）。建立草稿前若不知道欄位 id 就先呼叫；工作狀態已附目前草稿的規格時不必再呼叫。',
    parameters: {
      type: 'OBJECT',
      properties: { form_key: { type: 'STRING', description: '表單 key，例如 business-trip、travel-expense' } },
      required: ['form_key'],
    },
  },
  {
    name: 'create_application_draft',
    description:
      '建立一張「新的」申請草稿並同時寫入已知欄位（非正式送件）。只在使用者要新的一張時呼叫；要修改既有草稿請用 update_application_draft。回傳已儲存的欄位、被拒絕的值（含原因與候選）、尚缺必填。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_key: { type: 'STRING', description: '已發布可填表單 key' },
        set: SET_SCHEMA,
        rows: ROWS_SCHEMA,
      },
      required: ['form_key'],
    },
  },
  {
    name: 'describe_application_draft',
    description: '讀取草稿目前版本、已填資料、明細 row_id、尚缺必填與欄位規格。工作狀態沒有列出的草稿才需要呼叫。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING', description: '草稿 UUID' },
      },
      required: ['draft_id'],
    },
  },
  {
    name: 'update_application_draft',
    description:
      '修改既有草稿：set 只寫入列出的欄位，其他欄位不變；clear 清空欄位；rows 對明細逐列新增／修改／刪除。expected_version 用工作狀態或上次回傳的 version。回傳已儲存欄位、被拒絕的值、尚缺必填與最新 version。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING', description: '草稿 UUID' },
        expected_version: { type: 'NUMBER', description: '草稿目前 version' },
        set: SET_SCHEMA,
        clear: { type: 'ARRAY', items: { type: 'STRING' }, description: '要清空的欄位 id' },
        rows: ROWS_SCHEMA,
      },
      required: ['draft_id', 'expected_version'],
    },
  },
  {
    name: 'propose_choices',
    description: '在對話中顯示可點選的選項（表單種類、澄清問題等）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: '問題文字' },
        options: {
          type: 'ARRAY',
          description: '最多 8 項；使用者點選後，label 會當作使用者的回覆送出（表單 key 則直接建立該表單草稿）',
          items: {
            type: 'OBJECT',
            properties: { id: { type: 'STRING' }, label: { type: 'STRING' }, value: { type: 'STRING' } },
            required: ['id', 'label', 'value'],
          },
        },
      },
      required: ['prompt', 'options'],
    },
  },
  {
    name: 'propose_project_picker',
    description: '在對話中顯示專案搜尋選取元件。',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING' },
        draft_id: { type: 'STRING', description: '可選：綁定草稿 UUID' },
        field_id: { type: 'STRING', description: '可選：草稿欄位 id' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'propose_field_form',
    description:
      '在對話中顯示可直接填寫的小表單卡片（日期時間、人員、選項、文字等），用於補填缺少或有歧義的欄位。卡片由後端依表單規格產生；使用者送出後走與 update_application_draft 相同的驗證與版本檢查。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING' },
        field_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: '要請使用者填的欄位 id（最多 8 個）' },
        prompt: { type: 'STRING' },
      },
      required: ['draft_id', 'field_ids', 'prompt'],
    },
  },
  {
    name: 'propose_draft_changes',
    description:
      '要覆蓋已有值或一次改多個欄位時，先顯示「修改差異確認」卡片（原值 → 新值），使用者按確認才寫入；不會先寫 DB。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING' },
        set: SET_SCHEMA,
        prompt: { type: 'STRING' },
      },
      required: ['draft_id', 'set', 'prompt'],
    },
  },
  {
    name: 'start_resubmission',
    description:
      '為自己被退回的單據開補件草稿（沿用原單號與原內容），之後用 update_application_draft 修改。先用 search_my_submissions（status=returned）找到單據。不會送出。',
    parameters: {
      type: 'OBJECT',
      properties: { form_id: { type: 'STRING', description: 'search_my_submissions 回傳的 formId' } },
      required: ['form_id'],
    },
  },
  {
    name: 'propose_nudge',
    description:
      '準備催簽確認卡（不自動發送）。僅申請人可對自己進行中的單據使用；需使用者再確認。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_type: { type: 'STRING' },
        form_id: { type: 'STRING' },
      },
      required: ['form_type', 'form_id'],
    },
  },
  {
    name: 'search_my_submissions',
    description:
      '查詢目前使用者自己的動態表單單據（含公出差旅申請）。可依 key／狀態／關鍵字篩選。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_key: { type: 'STRING', description: '例如 business-trip、travel-expense' },
        status: { type: 'STRING', description: 'pending_approval / approved / returned 等' },
        query: { type: 'STRING', description: '單號、地點或事由關鍵字' },
        approved_only: { type: 'BOOLEAN' },
      },
      required: [],
    },
  },
  {
    name: 'propose_approved_document_picker',
    description:
      '顯示可點選的已核准單據選擇器（預設公出差旅申請）。使用者點「附加核准 PDF」後才真正產生並附加。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_key: { type: 'STRING', description: '預設 business-trip' },
        query: { type: 'STRING' },
        target_draft_id: { type: 'STRING', description: '若已知報支草稿 UUID' },
        target_draft_version: { type: 'NUMBER' },
        prompt: { type: 'STRING' },
      },
      required: [],
    },
  },
  {
    name: 'attach_approved_document_pdf',
    description:
      '將已核准單據的 PDF 快照附加到指定報支草稿。需明確 draft_id、expected_version、來源 form_id。',
    parameters: {
      type: 'OBJECT',
      properties: {
        source_form_id: { type: 'STRING' },
        draft_id: { type: 'STRING' },
        expected_version: { type: 'NUMBER' },
        suggest_trip_order_no: { type: 'BOOLEAN', description: '是否建議填入 tripOrderNo（需使用者確認才寫入）' },
      },
      required: ['source_form_id', 'draft_id', 'expected_version'],
    },
  },
  {
    name: 'attach_staged_files_to_draft',
    description:
      '將本則對話已上傳並掃描通過的圖片／PDF（staged_attachment_ids）寫入指定草稿附件。使用者說「夾進去／附加到草稿」時必須呼叫此工具，不可只回覆無法附加。若省略 staged_ids，使用本回合剛上傳的全部檔案。需 draft_id 與 expected_version。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING' },
        expected_version: { type: 'NUMBER' },
        staged_ids: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'staged attachment UUID 列表；可空＝本回合全部',
        },
      },
      required: ['draft_id', 'expected_version'],
    },
  },
] as const;

function clip<T>(rows: T[], n: number): T[] {
  return rows.slice(0, n);
}

function profilePayload(employee: CurrentEmployee) {
  return {
    employeeCode: employee.employeeCode,
    name: employee.name,
    title: employee.title,
    departmentCode: employee.departmentCode,
    departmentName: employee.departmentName,
    role: employee.role,
  };
}

export type ToolExecResult = {
  ok: boolean;
  name: string;
  /** Short label for UI feedback */
  label: string;
  response: Record<string, unknown>;
  /** Controlled UI blocks to attach to the model message. */
  blocks?: AiMessageBlock[];
  /** Controlled UI open events — never inferred from model text. */
  openResources?: OpenResourceEvent[];
};

const TOOL_LABELS: Record<AiChatToolName, string> = {
  get_my_profile: '個人資料',
  list_recent_projects: '近期專案',
  search_projects: '專案搜尋',
  search_budget_codes: '預算科目',
  list_filable_forms: '可填表單',
  list_form_catalog: '表單目錄',
  list_my_approval_queue: '待簽核',
  list_my_purchase_requests: '我的請購',
  list_my_purchase_orders: '我的採購',
  list_my_expense_claims: '我的費用申請',
  list_my_notifications: '通知',
  get_purchase_request_detail: '請購明細',
  get_case_overview: '案件概況',
  get_form_approval_status: '簽核進度',
  get_form_spec: '表單欄位',
  create_application_draft: '建立草稿',
  describe_application_draft: '讀取草稿',
  update_application_draft: '更新草稿',
  propose_choices: '選項',
  propose_project_picker: '專案選取',
  propose_field_form: '補填卡片',
  propose_draft_changes: '修改確認',
  propose_nudge: '催簽確認',
  search_my_submissions: '查詢我的單據',
  start_resubmission: '開補件草稿',
  propose_approved_document_picker: '選擇核准單據',
  attach_approved_document_pdf: '附加核准 PDF',
  attach_staged_files_to_draft: '附加聊天附件到草稿',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireString(args: Record<string, unknown> | undefined, key: string, opts?: { min?: number; max?: number }) {
  const v = args?.[key];
  if (typeof v !== 'string') return { ok: false as const, error: `${key}_invalid` };
  const s = v.trim();
  if (opts?.min && s.length < opts.min) return { ok: false as const, error: `${key}_too_short` };
  if (opts?.max && s.length > opts.max) return { ok: false as const, error: `${key}_too_long` };
  return { ok: true as const, value: s };
}

function requireUuid(args: Record<string, unknown> | undefined, key: string) {
  const s = requireString(args, key, { min: 36, max: 36 });
  if (!s.ok) return s;
  if (!UUID_RE.test(s.value)) return { ok: false as const, error: `${key}_invalid` };
  return s;
}

function stringList(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)) : undefined;
}

/** Tool arguments → fill request. Only plain structured values; no JSON-in-string. */
function fillRequestFrom(args: Record<string, unknown> | undefined): FillRequest {
  const rec = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const set = (Array.isArray(args?.set) ? args.set : [])
    .map(rec)
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x.field === 'string'))
    .slice(0, 60)
    .map((x) => ({ field: String(x.field), value: x.value, values: stringList(x.values) }));
  const rows = (Array.isArray(args?.rows) ? args.rows : [])
    .map(rec)
    .filter((x): x is Record<string, unknown> => Boolean(x && typeof x.table === 'string' && ['add', 'update', 'delete'].includes(String(x.op))))
    .slice(0, 60)
    .map((x) => ({
      op: x.op as 'add' | 'update' | 'delete',
      table: String(x.table),
      row_id: typeof x.row_id === 'string' ? x.row_id : undefined,
      cells: (Array.isArray(x.cells) ? x.cells : [])
        .map(rec)
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c.column === 'string'))
        .map((c) => ({ column: String(c.column), value: c.value })),
    }));
  return { set, clear: stringList(args?.clear)?.slice(0, 60), rows };
}

function fillDigest(req: FillRequest): string {
  return createHash('sha256').update(JSON.stringify(req)).digest('hex').slice(0, 16);
}

/** Backend-written receipt of what the database now holds — shown as-is, never model text. */
export function fillReceipt(r: Extract<DraftFillResult, { ok: true }>): string {
  const parts: string[] = [];
  parts.push(`${r.created ? '已建立' : '已儲存'}「${r.formName}」草稿（版本 ${r.version}）`);
  if (r.saved.length) parts.push(`寫入：${r.saved.map((x) => `${x.label} ${x.value}`).join('、')}`);
  else if (!r.created) parts.push('沒有欄位變更');
  if (r.rejected.length) parts.push(`未寫入：${r.rejected.map((x) => `${x.label}（${x.message}）`).join('、')}`);
  parts.push(r.missing.length ? `尚缺必填：${r.missing.map((m) => m.label).join('、')}` : '必填已齊，可由您確認後送出');
  return `${parts.join('。')}。`;
}

function draftResult(
  tool: AiChatToolName,
  label: string,
  result: DraftFillResult,
  operation: 'created' | 'opened' | 'updated'
): ToolExecResult {
  if (!result.ok) {
    const blocks: AiMessageBlock[] = [
      { kind: 'action_result', id: `fill_fail_${result.draftId ?? 'new'}_${result.version ?? 0}`, action: label, ok: false, message: result.message },
    ];
    return { ok: false, name: tool, label, response: { error: result.error, message: result.message, draftId: result.draftId, version: result.version }, blocks };
  }
  const receipt = fillReceipt(result);
  const blocks: AiMessageBlock[] = [
    {
      kind: 'draft_reference',
      id: `draft_${result.draftId}`,
      draftId: result.draftId,
      formKey: result.formKey,
      formName: result.formName,
      version: result.version,
      status: 'draft',
    },
    { kind: 'action_result', id: `fill_${result.draftId}_v${result.version}`, action: label, ok: result.rejected.length === 0, message: receipt },
  ];
  const open = draftOpenResource({
    draftId: result.draftId,
    title: result.formName,
    version: result.version,
    operation,
    formKey: result.formKey,
    status: 'draft',
  });
  return {
    ok: true,
    name: tool,
    label,
    response: {
      resourceType: 'application_draft',
      draftId: result.draftId,
      formKey: result.formKey,
      version: result.version,
      created: result.created,
      saved: result.saved,
      rejected: result.rejected,
      missing: result.missing,
      invalid: result.invalid,
      readyToSubmit: result.readyToSubmit,
      tables: result.tables,
      patchedKeys: result.saved.map((x) => x.field),
      receipt,
    },
    blocks,
    openResources: [open],
  };
}

export async function executeAiChatTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx?: AiToolContext
): Promise<ToolExecResult> {
  if (!ALLOWED.has(name)) {
    return {
      ok: false,
      name,
      label: name,
      response: {
        error: 'unauthorized_tool',
        message: '此工具未授權。助理不能執行未允許的操作。',
      },
    };
  }

  const tool = name as AiChatToolName;
  const label = TOOL_LABELS[tool];
  const employee = ctx?.actor ?? (await getCurrentEmployee());
  if (!employee) {
    return {
      ok: false,
      name: tool,
      label,
      response: { error: 'unauthenticated', message: '尚未登入。' },
    };
  }
  if (ctx && ctx.ownerEmployeeId !== employee.id) {
    return {
      ok: false,
      name: tool,
      label,
      response: { error: 'forbidden', message: '對話擁有者不符。' },
    };
  }

  try {
    switch (tool) {
      case 'get_my_profile':
        return { ok: true, name: tool, label, response: { profile: profilePayload(employee) } };

      case 'list_recent_projects': {
        const rows = await listRecentProjectsForEmployee(employee.id, 5);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            note: 'source=recent_used 為近期使用；recently_updated 為補齊用近期建立專案，不是代碼排序前 5 筆。',
            projects: rows,
          },
        };
      }

      case 'search_projects': {
        const q = requireString(args, 'query', { min: 1, max: 80 });
        if (!q.ok) {
          return { ok: false, name: tool, label, response: { error: q.error } };
        }
        const page = await searchProjectsPaged({ query: q.value, employeeId: employee.id, limit: 25, offset: 0 });
        return {
          ok: true,
          name: tool,
          label,
          response: { count: page.projects.length, hasMore: page.hasMore, projects: page.projects },
        };
      }

      case 'search_budget_codes': {
        const qReq = requireString(args, 'query', { min: 1, max: 80 });
        if (!qReq.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: qReq.error, message: '請提供搜尋關鍵字。' },
          };
        }
        const q = qReq.value.toLowerCase();
        const all = await getBudgetCodeList();
        const matched = all
          .filter((b) =>
            `${b.code} ${b.category} ${b.departmentName ?? ''} ${b.projectName ?? ''} ${b.ownerName ?? ''}`
              .toLowerCase()
              .includes(q)
          )
          .map((b) => ({
            id: b.id,
            code: b.code,
            category: b.category,
            fiscalYear: b.fiscalYear,
            departmentName: b.departmentName,
            projectName: b.projectName,
            ownerName: b.ownerName,
            annualBudgetAmount: b.annualBudgetAmount,
          }));
        return {
          ok: true,
          name: tool,
          label,
          response: { count: matched.length, budgetCodes: clip(matched, 25) },
        };
      }

      case 'list_filable_forms': {
        const forms = await getFilableDefinitions();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            forms: clip(
              forms.map((f) => ({
                key: f.key,
                name: f.name,
                description: f.description,
                category: f.categoryTitle,
                href: `/f/${f.key}/new`,
              })),
              40
            ),
          },
        };
      }

      case 'list_form_catalog': {
        const catalog = (Object.keys(FORM_LABELS) as FormType[]).map((t) => ({
          formType: t,
          label: FORM_LABELS[t],
          pathPrefix: FORM_ROUTE_PREFIX[t],
        }));
        return { ok: true, name: tool, label, response: { catalog } };
      }

      case 'list_my_approval_queue': {
        // Same source as the welcome summary: designer forms included, real total.
        const inbox = await loadAssistantInbox(30);
        if (inbox.loadError) return { ok: false, name: tool, label, response: { error: 'inbox_unavailable', message: '待簽核清單暫時無法載入，這不代表沒有待辦。' } };
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: inbox.pendingTotal,
            items: inbox.pendingApprovals.map((i) => ({
              formType: i.formType,
              label: i.label,
              id: i.id,
              caseNumber: i.caseNumber,
              applicantName: i.applicantName,
              summary: i.summary,
              totalAmount: i.totalAmount,
              href: i.href,
            })),
          },
        };
      }

      case 'list_my_purchase_requests': {
        const rows = await getMyRequests();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            requests: clip(
              rows.map((r) => ({
                id: r.id,
                caseNumber: r.caseNumber,
                status: r.status,
                totalAmount: r.totalAmount,
                requestDate: r.requestDate,
                href: `/requests/${r.id}`,
              })),
              25
            ),
          },
        };
      }

      case 'list_my_purchase_orders': {
        const rows = await getMyPurchaseOrders();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            orders: clip(
              rows.map((o) => ({
                id: o.id,
                caseNumber: o.caseNumber,
                status: o.status,
                totalAmount: o.totalAmount,
                href: `/purchase-orders/${o.id}`,
              })),
              25
            ),
          },
        };
      }

      case 'list_my_expense_claims': {
        const rows = await getMyExpenseClaims();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            claims: clip(
              rows.map((c) => ({
                id: c.id,
                edition: c.edition,
                caseNumber: c.caseNumber,
                status: c.status,
                totalAmount: c.totalAmount,
                departmentName: c.departmentName,
                applicationDate: c.applicationDate,
                createdAt: c.createdAt.toISOString(),
              })),
              25
            ),
          },
        };
      }

      case 'list_my_notifications': {
        const rows = await getMyNotifications();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            notifications: clip(
              rows.map((n) => ({
                type: n.type,
                formType: n.formType,
                caseNumber: n.caseNumber,
                message: n.message,
                isRead: n.isRead,
                createdAt: n.createdAt,
              })),
              20
            ),
          },
        };
      }

      case 'get_purchase_request_detail': {
        const id = requireUuid(args, 'request_id');
        if (!id.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: id.error },
          };
        }
        const detail = await getPurchaseRequestDetail(id.value);
        if (!detail) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden', message: '找不到或無權限閱讀此請購單。' },
          };
        }
        return {
          ok: true,
          name: tool,
          label,
          response: {
            detail: {
              id: detail.id,
              caseNumber: detail.caseNumber,
              status: detail.status,
              totalAmount: detail.totalAmount,
              applicantName: detail.applicantName,
              departmentName: detail.departmentName,
              items: detail.items,
              steps: detail.steps.map((s) => ({
                stepOrder: s.stepOrder,
                approverName: s.approverName,
                approverRole: s.approverRole,
                status: s.status,
                comment: s.comment,
              })),
              href: `/requests/${detail.id}`,
            },
          },
        };
      }

      case 'get_case_overview': {
        const caseNumber = requireString(args, 'case_number', { min: 4, max: 40 });
        if (!caseNumber.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: caseNumber.error },
          };
        }
        const overview = await getCaseOverview(caseNumber.value);
        if (!overview) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden', message: '找不到案件，或你不是參與者。' },
          };
        }
        return { ok: true, name: tool, label, response: { overview } };
      }

      case 'get_form_approval_status': {
        const formType = requireString(args, 'form_type', { min: 3, max: 40 });
        const formId = requireUuid(args, 'form_id');
        if (!formType.ok) return { ok: false, name: tool, label, response: { error: formType.error } };
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        const snap = await getFormApprovalSnapshot(formType.value as FormType, formId.value);
        if (!snap) {
          return { ok: false, name: tool, label, response: { error: 'not_found', message: '找不到單據。' } };
        }
        return {
          ok: true,
          name: tool,
          label,
          response: {
            status: snap.status,
            currentNodeLabel: snap.currentNodeLabel,
            pendingApproverNames: snap.pendingApproverNames,
            waitingSinceIso: snap.waitingSinceIso,
            waitingFor: formatWaitingDuration(snap.waitingSinceIso),
            caseNumber: snap.caseNumber,
          },
        };
      }

      case 'get_form_spec': {
        const formKey = requireString(args, 'form_key', { min: 1, max: 40 });
        if (!formKey.ok) return { ok: false, name: tool, label, response: { error: formKey.error } };
        const form = await loadFilableForm(formKey.value, employee.id);
        if (!form) {
          return { ok: false, name: tool, label, response: { error: 'form_not_filable', message: '此表單不存在或您不能填寫。' } };
        }
        return { ok: true, name: tool, label, response: { formKey: form.key, formName: form.name, fields: formSpec(form.schema, form.picker) } };
      }

      case 'create_application_draft': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const formKey = requireString(args, 'form_key', { min: 1, max: 40 });
        if (!formKey.ok) return { ok: false, name: tool, label, response: { error: formKey.error } };
        const request = fillRequestFrom(args);
        // Same turn + same form + same content = a retry; anything else is a new draft.
        const idemKey = ctx.turnId ? `${ctx.turnId}:${formKey.value}:${fillDigest(request)}` : null;
        const result = await createDraftWithFill({
          conversationId: ctx.conversationId,
          ownerEmployeeId: employee.id,
          formKey: formKey.value,
          request,
          idempotencyKey: idemKey,
          options: ctx.fill,
        });
        return draftResult(tool, label, result, result.ok && result.created ? 'created' : 'opened');
      }

      case 'start_resubmission': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const formId = requireUuid(args, 'form_id');
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        const started = await startResubmission({ ownerEmployeeId: employee.id, submissionId: formId.value, conversationId: ctx.conversationId });
        if (!started.ok) return { ok: false, name: tool, label, response: { error: started.code, message: started.error } };
        const open = draftOpenResource({
          draftId: started.draft.id,
          title: started.formName,
          version: started.draft.version,
          operation: started.created ? 'created' : 'opened',
          formKey: started.draft.formDefinitionKey,
          status: 'draft',
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: started.draft.id,
            version: started.draft.version,
            formNumber: started.formNumber,
            returnReason: started.reason ?? '退回時未提供原因',
            message: '補件草稿已開好，內容與原單相同。尚未送出。',
          },
          blocks: [
            {
              kind: 'draft_reference',
              id: `draft_${started.draft.id}`,
              draftId: started.draft.id,
              formKey: started.draft.formDefinitionKey,
              formName: started.formName,
              version: started.draft.version,
              status: 'draft',
            },
          ],
          openResources: [open],
        };
      }

      case 'describe_application_draft': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const draftCtx = await loadDraftFormContext(draftId.value, employee.id);
        if (!draftCtx || !(await isDraftInConversation(draftId.value, ctx.conversationId, employee.id))) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden', message: '找不到本草稿或無權限。' },
          };
        }
        const status = draftStatus(draftCtx.schema, draftCtx.draft.data, draftCtx.today);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: draftCtx.draft.id,
            formKey: draftCtx.formKey,
            formName: draftCtx.name,
            version: draftCtx.draft.version,
            status: draftCtx.draft.status,
            data: draftCtx.draft.data,
            missing: status.missing,
            invalid: status.invalid,
            fields: formSpec(draftCtx.schema, draftCtx.options),
            versionMismatch: draftCtx.versionMismatch,
          },
        };
      }

      case 'update_application_draft': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const expectedRaw = args?.expected_version;
        const expectedVersion =
          typeof expectedRaw === 'number'
            ? expectedRaw
            : typeof expectedRaw === 'string' && /^\d+$/.test(expectedRaw)
              ? Number(expectedRaw)
              : NaN;
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, name: tool, label, response: { error: 'expected_version_invalid' } };
        }
        const request = fillRequestFrom(args);
        if (!request.set?.length && !request.clear?.length && !request.rows?.length) {
          return { ok: false, name: tool, label, response: { error: 'nothing_to_update', message: '沒有要更新的欄位。' } };
        }
        const result = await fillDraft({
          draftId: draftId.value,
          ownerEmployeeId: employee.id,
          conversationId: ctx.conversationId,
          expectedVersion,
          request,
          options: ctx.fill,
        });
        return draftResult(tool, label, result, 'updated');
      }

      case 'propose_choices': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const prompt = requireString(args, 'prompt', { min: 1, max: 500 });
        const optionsJson = Array.isArray(args?.options)
          ? { ok: true as const, value: JSON.stringify(args.options) }
          : requireString(args, 'options_json', { min: 2, max: 4000 });
        if (!prompt.ok) return { ok: false, name: tool, label, response: { error: prompt.error } };
        if (!optionsJson.ok) return { ok: false, name: tool, label, response: { error: optionsJson.error } };
        const options: Array<{ id: string; label: string; value: string }> = [];
        try {
          const parsed = JSON.parse(optionsJson.value) as unknown;
          if (!Array.isArray(parsed)) throw new Error('not_array');
          for (const o of parsed.slice(0, 8)) {
            if (!o || typeof o !== 'object') continue;
            const rec = o as Record<string, unknown>;
            if (
              typeof rec.id === 'string' &&
              typeof rec.label === 'string' &&
              typeof rec.value === 'string' &&
              rec.id &&
              rec.label &&
              rec.value
            ) {
              options.push({
                id: rec.id.slice(0, 64),
                label: rec.label.slice(0, 120),
                value: rec.value.slice(0, 200),
              });
            }
          }
        } catch {
          return { ok: false, name: tool, label, response: { error: 'options_json_invalid' } };
        }
        if (options.length === 0) {
          return { ok: false, name: tool, label, response: { error: 'options_empty' } };
        }
        const block: AiMessageBlock = {
          kind: 'choice',
          id: `choice_${Date.now().toString(36)}`,
          prompt: prompt.value,
          options,
          conversationId: ctx.conversationId,
          status: 'open',
        };
        return {
          ok: true,
          name: tool,
          label,
          response: { presented: true, optionCount: options.length },
          blocks: [block],
        };
      }

      case 'propose_project_picker': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const prompt = requireString(args, 'prompt', { min: 1, max: 500 });
        if (!prompt.ok) return { ok: false, name: tool, label, response: { error: prompt.error } };
        const draftId =
          typeof args?.draft_id === 'string' && UUID_RE.test(args.draft_id) ? args.draft_id : undefined;
        const fieldId =
          typeof args?.field_id === 'string' ? args.field_id.trim().slice(0, 80) : undefined;
        const draft = draftId && (await isDraftInConversation(draftId, ctx.conversationId, employee.id)) ? await getDraftForOwner(draftId, employee.id) : null;
        if (draftId && !draft) return { ok: false, name: tool, label, response: { error: 'not_found_or_forbidden' } };
        const block: AiMessageBlock = {
          kind: 'project_picker',
          id: `pp_${Date.now().toString(36)}`,
          prompt: prompt.value,
          conversationId: ctx.conversationId,
          draftId,
          // The card writes against this version; a later edit makes it expire instead of overwriting.
          draftVersion: draft?.version,
          fieldId,
          status: 'open',
        };
        return {
          ok: true,
          name: tool,
          label,
          response: { presented: true },
          blocks: [block],
        };
      }

      case 'propose_field_form': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        const prompt = requireString(args, 'prompt', { min: 1, max: 500 });
        if (!draftId.ok || !prompt.ok) return { ok: false, name: tool, label, response: { error: 'invalid_args' } };
        if (!(await isDraftInConversation(draftId.value, ctx.conversationId, employee.id))) {
          return { ok: false, name: tool, label, response: { error: 'not_found_or_forbidden' } };
        }
        const fieldIds = Array.isArray(args?.field_ids) ? args.field_ids.map(String) : [];
        const card = await buildFieldFormCard({ draftId: draftId.value, ownerEmployeeId: employee.id, conversationId: ctx.conversationId, fieldIds, prompt: prompt.value });
        if (!card.ok) return { ok: false, name: tool, label, response: { error: card.error } };
        return { ok: true, name: tool, label, response: { presented: true, fields: card.block.kind === 'field_form' ? card.block.fields.map((f) => f.id) : [] }, blocks: [card.block] };
      }

      case 'propose_draft_changes': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        const prompt = requireString(args, 'prompt', { min: 1, max: 500 });
        if (!draftId.ok || !prompt.ok) return { ok: false, name: tool, label, response: { error: 'invalid_args' } };
        if (!(await isDraftInConversation(draftId.value, ctx.conversationId, employee.id))) {
          return { ok: false, name: tool, label, response: { error: 'not_found_or_forbidden' } };
        }
        const set = (fillRequestFrom(args).set ?? []).map((x) => ({ field: x.field, value: String(x.value ?? '') }));
        const card = await buildChangeConfirmCard({ draftId: draftId.value, ownerEmployeeId: employee.id, conversationId: ctx.conversationId, set, prompt: prompt.value });
        if (!card.ok) return { ok: false, name: tool, label, response: { error: 'nothing_to_confirm', message: card.error } };
        return { ok: true, name: tool, label, response: { presented: true, rejected: card.rejected, note: '尚未寫入，等待使用者確認' }, blocks: [card.block] };
      }

      case 'propose_nudge': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const formType = requireString(args, 'form_type', { min: 3, max: 40 });
        const formId = requireUuid(args, 'form_id');
        if (!formType.ok) return { ok: false, name: tool, label, response: { error: formType.error } };
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        const preview = await previewNudge(formType.value, formId.value);
        if (!preview) {
          return { ok: false, name: tool, label, response: { error: 'forbidden_or_missing' } };
        }
        const block: AiMessageBlock = {
          kind: 'nudge_confirm',
          id: `nudge_${formId.value.slice(0, 8)}`,
          formType: preview.formType,
          formId: preview.formId,
          caseNumber: preview.caseNumber,
          recipientNames: preview.recipientNames,
          status: preview.alreadyNudgedToday ? 'already_today' : preview.canNudge ? 'open' : 'expired',
          conversationId: ctx.conversationId,
        };
        return {
          ok: true,
          name: tool,
          label,
          response: {
            canNudge: preview.canNudge,
            alreadyNudgedToday: preview.alreadyNudgedToday,
            reason: preview.reason,
            recipients: preview.recipientNames,
          },
          blocks: [block],
        };
      }

      case 'search_my_submissions': {
        const formKey =
          typeof args?.form_key === 'string' ? args.form_key.trim().slice(0, 40) : undefined;
        const status = typeof args?.status === 'string' ? args.status.trim().slice(0, 40) : undefined;
        const query = typeof args?.query === 'string' ? args.query.trim().slice(0, 80) : undefined;
        const approvedOnly = args?.approved_only === true;
        const page = await searchMyCustomSubmissions({
          ownerEmployeeId: employee.id,
          formKey,
          status,
          query,
          approvedOnly,
          limit: 8,
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            items: page.items,
            hasMore: page.hasMore,
            message: page.items.length
              ? `找到 ${page.items.length} 筆。`
              : '沒有符合條件的單據（不是查詢失敗）。',
          },
        };
      }

      case 'propose_approved_document_picker': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const formKey =
          typeof args?.form_key === 'string' && args.form_key.trim()
            ? args.form_key.trim().slice(0, 40)
            : 'business-trip';
        const query = typeof args?.query === 'string' ? args.query.trim().slice(0, 80) : undefined;
        const prompt =
          typeof args?.prompt === 'string' && args.prompt.trim()
            ? args.prompt.trim().slice(0, 500)
            : '請選擇要附加核准 PDF 的單據';
        const targetDraftId =
          typeof args?.target_draft_id === 'string' && UUID_RE.test(args.target_draft_id)
            ? args.target_draft_id
            : undefined;
        const targetDraftVersion =
          typeof args?.target_draft_version === 'number' ? args.target_draft_version : undefined;
        const page = await searchMyCustomSubmissions({
          ownerEmployeeId: employee.id,
          formKey,
          query,
          approvedOnly: true,
          limit: 8,
        });
        const block: AiMessageBlock = {
          kind: 'document_picker',
          id: `docpick_${Date.now().toString(36)}`,
          prompt,
          conversationId: ctx.conversationId,
          targetDraftId,
          targetDraftVersion,
          status: 'open',
          items: page.items.map((i) => ({
            formType: i.formType,
            formId: i.formId,
            formKey: i.formKey,
            formNumber: i.formNumber,
            formName: i.formName,
            status: i.status,
            summary: i.summary,
            approvedAt: i.approvedAt ?? undefined,
          })),
        };
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: page.items.length,
            message:
              page.items.length === 0
                ? '目前沒有可附加的已核准單據。'
                : '已顯示選擇器；請使用者點選「附加核准 PDF」。',
          },
          blocks: [block],
        };
      }

      case 'attach_approved_document_pdf': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const sourceFormId = requireUuid(args, 'source_form_id');
        const draftId = requireUuid(args, 'draft_id');
        if (!sourceFormId.ok) return { ok: false, name: tool, label, response: { error: sourceFormId.error } };
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const expectedVersion = Number(args?.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, name: tool, label, response: { error: 'expected_version_invalid' } };
        }
        const owned = await getDraftForOwner(draftId.value, employee.id);
        if (!owned || !(await isDraftInConversation(owned.id, ctx.conversationId, employee.id))) {
          return { ok: false, name: tool, label, response: { error: 'draft_forbidden' } };
        }
        const actor = { id: employee.id, role: employee.role };
        const snap = await getOrCreateApprovedPdfSnapshot({
          actor,
          formType: 'custom',
          formId: sourceFormId.value,
        });
        if (!snap.ok) {
          return { ok: false, name: tool, label, response: { error: snap.error } };
        }
        try {
          const linked = await attachApprovedSnapshotToDraft({
            actor,
            draftId: draftId.value,
            expectedVersion,
            snapshotId: snap.snapshot.id,
          });
          if (!linked.ok) {
            return {
              ok: false,
              name: tool,
              label,
              response: {
                error: 'version_conflict',
                version: linked.conflict.draft.version,
                message: '草稿版本衝突，請重新整理後再附加。',
              },
            };
          }
          const card: AiMessageBlock = {
            kind: 'approved_pdf_card',
            id: `pdf_${snap.snapshot.id}`,
            snapshotId: snap.snapshot.id,
            formNumber: snap.snapshot.sourceFormNumber,
            fileName: snap.snapshot.fileName,
            contentHash: snap.snapshot.contentHash,
            draftId: draftId.value,
            previewHref: `/api/ai-chat/approved-snapshots/${snap.snapshot.id}`,
          };
          const suggestTrip = args?.suggest_trip_order_no === true;
          const [source] = await getDb().select({ data: formSubmissions.data }).from(formSubmissions).where(eq(formSubmissions.id, sourceFormId.value)).limit(1);
          const carry = linked.created
            ? await buildTripCarryOverCard({
                draftId: draftId.value,
                ownerEmployeeId: employee.id,
                conversationId: ctx.conversationId,
                sourceData: (source?.data ?? {}) as Record<string, unknown>,
                sourceFormNumber: snap.snapshot.sourceFormNumber,
              })
            : null;
          return {
            ok: true,
            name: tool,
            label,
            response: {
              resourceType: 'application_draft',
              resourceId: draftId.value,
              snapshotId: snap.snapshot.id,
              createdLink: linked.created,
              draftVersion: linked.draft.version,
              suggestedTripOrderNo: suggestTrip ? snap.snapshot.sourceFormNumber : null,
              message: linked.created
                ? '已附加核准 PDF 快照到草稿。來源後續變更不會改寫此 PDF。'
                : '此核准 PDF 已附加過，未重複建立。',
            },
            blocks: carry ? [card, carry] : [card],
            openResources: [
              draftOpenResource({
                draftId: draftId.value,
                title: owned.title || owned.formDefinitionKey,
                version: linked.draft.version,
                operation: 'updated',
                formKey: owned.formDefinitionKey,
                status: linked.draft.status,
              }),
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'attach_failed';
          return { ok: false, name: tool, label, response: { error: msg } };
        }
      }

      case 'attach_staged_files_to_draft': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const expectedVersion = Number(args?.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, name: tool, label, response: { error: 'expected_version_invalid' } };
        }
        const owned = await getDraftForOwner(draftId.value, employee.id);
        if (!owned || !(await isDraftInConversation(owned.id, ctx.conversationId, employee.id))) {
          return { ok: false, name: tool, label, response: { error: 'draft_forbidden' } };
        }
        const rawIds = Array.isArray(args?.staged_ids) ? args.staged_ids : [];
        const stagedIds =
          rawIds.length > 0
            ? rawIds.filter((x): x is string => typeof x === 'string')
            : (ctx.recentStagedIds ?? []);
        if (stagedIds.length === 0) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'no_staged_files',
              message: '本回合沒有可附加的已上傳檔案。請先用圖片按鈕上傳並等待掃描完成。',
            },
          };
        }
        // Gate: invoice business reminders require explicit user confirmation before attach.
        const {
          analyzeStagedAttachment,
          hasStagedInvoiceConfirmation,
          invoiceStatusNeedsConfirm,
        } = await import('./staged-invoice');
        const { aiChatStagedAttachments } = await import('@/lib/db/schema');
        const { getDb } = await import('@/lib/db');
        const { and, eq, isNull } = await import('drizzle-orm');
        const pendingConfirm: Array<{
          stagedId: string;
          fileName: string;
          status: string;
          summary: string;
        }> = [];
        for (const sid of stagedIds) {
          const [row] = await getDb()
            .select()
            .from(aiChatStagedAttachments)
            .where(
              and(
                eq(aiChatStagedAttachments.id, sid),
                eq(aiChatStagedAttachments.ownerEmployeeId, employee.id),
                eq(aiChatStagedAttachments.scanStatus, 'ready'),
                isNull(aiChatStagedAttachments.purgedAt)
              )
            )
            .limit(1);
          if (!row) continue;
          let analysis = row.analysisResult as { overallStatus?: string; summary?: string } | null;
          if (!analysis?.overallStatus) {
            const analyzed = await analyzeStagedAttachment({
              ownerEmployeeId: employee.id,
              stagedId: sid,
            });
            if (analyzed.ok) analysis = analyzed.result;
          }
          if (analysis?.overallStatus && invoiceStatusNeedsConfirm(analysis.overallStatus)) {
            const confirmed = await hasStagedInvoiceConfirmation({
              stagedId: sid,
              draftId: draftId.value,
              contentSha256: row.sha256,
            });
            if (!confirmed) {
              pendingConfirm.push({
                stagedId: sid,
                fileName: row.fileName,
                status: analysis.overallStatus,
                summary: analysis.summary ?? analysis.overallStatus,
              });
            }
          }
        }
        if (pendingConfirm.length > 0) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'confirmation_required',
              message:
                '發票／統編業務提醒尚未經使用者確認「仍要夾帶」。請在圖片卡片上確認後再附加；安全掃描已通過，此提醒不阻擋安全上傳，但阻擋寫入草稿直到確認。',
              pendingConfirm,
            },
            blocks: pendingConfirm.map((p) => ({
              kind: 'attachment_status' as const,
              id: `confirm_${p.stagedId}`,
              fileName: p.fileName,
              state: 'rejected' as const,
              detail: `需確認後才可夾帶：${p.summary}`,
            })),
          };
        }

        const linked = await attachStagedFilesToDraft({
          actor: { id: employee.id, role: employee.role },
          conversationId: ctx.conversationId,
          draftId: draftId.value,
          expectedVersion,
          stagedIds,
        });
        if ('conflict' in linked && linked.conflict) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'version_conflict',
              version: linked.conflict.draft.version,
              message: '草稿版本衝突，請重新讀取草稿後再附加。',
            },
          };
        }
        if (!linked.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'error' in linked ? linked.error : 'attach_failed',
              message:
                'error' in linked && linked.error === 'staged_not_ready'
                  ? '指定的聊天附件尚未就緒或已失效，請重新上傳。'
                  : '附加失敗。',
            },
          };
        }
        const names = linked.attached.map((a) => a.fileName).join('、');
        // Deterministic invoice / tax-id check (vision for photos) — business reminder, not security block.
        const { runInvoiceCheckOnBytes } = await import('@/lib/attachments/invoice-check');
        const { readDraftFileBytes } = await import('./attach-staged');
        const invoiceChecks: Array<{
          fileName: string;
          status: string;
          summary: string;
          buyerTaxId: string | null;
          sellerTaxId: string | null;
          usedVision?: boolean;
        }> = [];
        for (const a of linked.attached) {
          const file = await readDraftFileBytes(draftId.value, a.id);
          if (!file) continue;
          try {
            const check = await runInvoiceCheckOnBytes({
              bytes: new Uint8Array(file.bytes),
              mimeType: file.mimeType,
            });
            const p0 = check.pages[0];
            invoiceChecks.push({
              fileName: a.fileName,
              status: check.overallStatus,
              summary: check.summary,
              buyerTaxId: p0?.buyerTaxId ?? null,
              sellerTaxId: p0?.sellerTaxId ?? null,
              usedVision: check.usedVision,
            });
          } catch (err) {
            invoiceChecks.push({
              fileName: a.fileName,
              status: 'analysis_failed',
              summary: err instanceof Error ? err.message : '分析失敗',
              buyerTaxId: null,
              sellerTaxId: null,
            });
          }
        }
        const reminderLines = invoiceChecks
          .filter((c) => c.status !== 'match' && c.status !== 'not_invoice')
          .map((c) => `· ${c.fileName}：${c.summary}（狀態 ${c.status}）`);
        const reminderNote =
          reminderLines.length > 0
            ? `業務提醒（非安全阻擋，簽核者仍可見）：\n${reminderLines.join('\n')}\n請向使用者說明；若其知情仍要夾帶，可繼續保留附件並在回覆中記錄其確認。`
            : null;

        return {
          ok: true,
          name: tool,
          label,
          response: {
            resourceType: 'application_draft',
            resourceId: draftId.value,
            draftVersion: linked.draft.version,
            attachedCount: linked.attached.length,
            attachedFiles: linked.attached.map((a) => ({
              id: a.id,
              fileName: a.fileName,
              mimeType: a.mimeType,
              fileSizeBytes: a.fileSizeBytes,
            })),
            skipped: linked.skipped,
            invoiceChecks,
            businessReminder: reminderNote,
            message:
              linked.attached.length > 0
                ? `已將 ${linked.attached.length} 個檔案附加到草稿附件（${names}）。送出草稿時會一併寫入正式單據。${
                    reminderNote ? ' 另有統編／發票業務提醒，請向使用者說明。' : ''
                  }`
                : '沒有新檔案被附加。',
          },
          blocks: linked.attached.map((a) => {
            const check = invoiceChecks.find((c) => c.fileName === a.fileName);
            return {
              kind: 'attachment_status' as const,
              id: `draft_file_${a.id}`,
              fileName: a.fileName,
              state: 'ready' as const,
              detail: check
                ? `已夾入草稿｜發票檢查：${check.summary}`
                : `已夾入草稿 ${draftId.value.slice(0, 8)}…`,
            };
          }),
          openResources: [
            draftOpenResource({
              draftId: draftId.value,
              title: owned.title || owned.formDefinitionKey,
              version: linked.draft.version,
              operation: 'updated',
              formKey: owned.formDefinitionKey,
              status: linked.draft.status,
            }),
          ],
        };
      }

      default: {
        const _exhaustive: never = tool;
        return {
          ok: false,
          name: String(_exhaustive),
          label: 'unknown',
          response: { error: 'unhandled_tool' },
        };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      name: tool,
      label,
      response: { error: 'tool_failed', message: message.slice(0, 300) },
    };
  }
}
