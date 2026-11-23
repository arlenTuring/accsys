import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getCurrentEmployee, type CurrentEmployee } from '@/lib/auth/current-employee';
import { getDb } from '@/lib/db';
import { formSubmissions } from '@/lib/db/schema';
import { getBudgetCodeList } from '@/lib/budget-codes/queries';
import { getCaseOverview } from '@/lib/cases/queries';
import { recordAudit } from '@/lib/audit/record';
import { approveCustomFormStep, returnCustomFormStep } from '@/lib/custom-forms/actions';
import { getFilableDefinitions, getSubmissionDetail } from '@/lib/custom-forms/queries';
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
import { factsFor, loadFormFacts } from './form-facts';
import { cardsFromMySubmissions, cardsFromPendingApprovals } from './submission-cards';
import { previewNudge } from './nudge';
import { listRecentProjectsForEmployee, searchProjectsPaged } from './projects';
import { startResubmission } from './resubmit';
import { searchMyCustomSubmissions } from './submissions-search';
import { translatePhrase, type Locale } from '@/lib/i18n/messages';

async function approveOneForActor(
  employee: CurrentEmployee,
  formId: string,
  conversationId: string | null
): Promise<{ ok: boolean; message: string; formNumber?: string; error?: string }> {
  const { approveSubmissionFromChatAction, getSubmissionPanelAction } = await import('./actions');
  const panel = await getSubmissionPanelAction(formId);
  if (!panel.ok) return { ok: false, error: 'not_found', message: panel.error };
  const result = await approveSubmissionFromChatAction(formId, panel.version);
  if (!result.ok) {
    return { ok: false, error: 'approve_failed', message: result.error, formNumber: panel.formNumber };
  }
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: 'ai.approve_submission',
    entityType: panel.formKey || 'custom',
    entityId: formId,
    requestId: conversationId,
    details: {
      via: 'ai_assistant',
      formNumber: panel.formNumber,
      formName: panel.formName,
      conversationId,
    },
  });
  return {
    ok: true,
    message: result.message ?? `已核准 ${panel.formNumber}（${panel.formName}）。`,
    formNumber: panel.formNumber,
  };
}

async function returnOneForActor(
  employee: CurrentEmployee,
  formId: string,
  reason: string,
  conversationId: string | null
): Promise<{ ok: boolean; message: string; formNumber?: string; error?: string }> {
  const { getSubmissionPanelAction, returnSubmissionFromChatAction } = await import('./actions');
  const panel = await getSubmissionPanelAction(formId);
  if (!panel.ok) return { ok: false, error: 'not_found', message: panel.error };
  const result = await returnSubmissionFromChatAction(formId, reason, panel.version);
  if (!result.ok) {
    return { ok: false, error: 'return_failed', message: result.error, formNumber: panel.formNumber };
  }
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: 'ai.return_submission',
    entityType: panel.formKey || 'custom',
    entityId: formId,
    requestId: conversationId,
    details: {
      via: 'ai_assistant',
      formNumber: panel.formNumber,
      formName: panel.formName,
      reason: reason.slice(0, 200),
      conversationId,
    },
  });
  return {
    ok: true,
    message: result.message ?? `已退回 ${panel.formNumber}（${panel.formName}）。`,
    formNumber: panel.formNumber,
  };
}

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
  'propose_draft_changes',
  'propose_nudge',
  'start_resubmission',
  'search_my_submissions',
  'propose_approved_document_picker',
  'attach_approved_document_pdf',
  'attach_staged_files_to_draft',
  'list_draft_attachments',
  'remove_draft_attachments',
  'duplicate_application_draft',
  'rename_application_draft',
  'search_trip_companion_candidates',
  'search_my_assets',
  'list_inventory_handover_forms',
  'dispatch_inventory_handover_form',
  'confirm_inventory_handover_items',
  'get_my_pending_tasks_overview',
  'list_my_budget_tasks_and_history',
  'dispatch_budget_compilation_notice',
  'get_budget_analytics_summary',
  'search_company_regulations',
  'list_company_announcements',
  'list_company_surveys',
  'approve_submission',
  'return_submission',
  'approve_all_pending',
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
  /** Active user/UI locale ('zh-Hant' | 'en' | 'ja') for localized UI labels & receipts. */
  locale?: Locale;
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
    description:
      '列出目前使用者個人的「單據簽核／退回系統通知」（僅限個人表單簽核動態，非公司公告；若要查詢或整理「公司公告」請呼叫 list_company_announcements）。',
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
    description:
      '讀取單一指定草稿（draft_id）的目前版本、已填資料、明細 row_id、尚缺必填與欄位規格，並立即在畫面右側面板開啟／切換至該張草稿，同時於對話中僅顯示該張草稿的單一卡片。當使用者要求「切換至某張草稿」、「編輯另一張草稿」、「幫我開啟這張草稿」或檢視特定一張草稿時，請務必優先呼叫此工具（切勿呼叫 list_my_budget_tasks_and_history 等總覽清單工具，以免把其他無關單據一起列出來）。',
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
  {
    name: 'search_my_assets',
    description:
      '依權限查詢財產（我的保管／部門／全公司）。範圍在資料庫端套用，不會載入全公司後再過濾。回傳名稱、種類、地點、狀態與財產編號；不可用來執行移轉或報廢。',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: '財產編號、名稱、種類或地點關鍵字' },
        scope: {
          type: 'STRING',
          description: 'mine（預設）／department／company（需權限）',
          enum: ['mine', 'department', 'company'],
        },
      },
      required: [],
    },
  },
  {
    name: 'approve_submission',
    description:
      '以目前登入使用者身分核准一張待其簽核的自訂表單（custom）。使用者明確說要簽核／核准時使用。僅能處理佇列中屬於此人的關卡。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_id: { type: 'STRING', description: '單據 UUID（list_my_approval_queue 的 id）' },
      },
      required: ['form_id'],
    },
  },
  {
    name: 'return_submission',
    description:
      '以目前登入使用者身分退回一張待其簽核的自訂表單。必須提供退回原因（可短句）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_id: { type: 'STRING', description: '單據 UUID' },
        reason: { type: 'STRING', description: '退回原因' },
      },
      required: ['form_id', 'reason'],
    },
  },
  {
    name: 'approve_all_pending',
    description:
      '一次核准目前登入使用者待簽核佇列中的自訂表單（預設最多 20 張）。使用者說「全部簽核」時使用。',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'NUMBER', description: '最多核准幾張，預設 20、上限 30' },
      },
      required: [],
    },
  },
  {
    name: 'list_draft_attachments',
    description: '列出指定草稿目前已夾帶的附件（檔名、大小、檔案 ID）。刪除／替換前先用此工具確認。',
    parameters: {
      type: 'OBJECT',
      properties: { draft_id: { type: 'STRING' } },
      required: ['draft_id'],
    },
  },
  {
    name: 'remove_draft_attachments',
    description:
      '從草稿移除附件關聯（只刪此草稿副本，不銷毀聊天原檔或其他單據共用檔）。可指定 file_ids，或 remove_all=true 一次移除該草稿全部附件。目標草稿不明且有多張時不可擅自全操作。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING' },
        expected_version: { type: 'NUMBER' },
        file_ids: { type: 'ARRAY', items: { type: 'STRING' }, description: '要移除的附件 UUID（以 ID 為準，不用檔名）' },
        remove_all: { type: 'BOOLEAN', description: 'true＝移除該草稿全部附件' },
      },
      required: ['draft_id', 'expected_version'],
    },
  },
  {
    name: 'search_trip_companion_candidates',
    description:
      '依目標草稿的出差日期／地點／專案，搜尋使用者有權看到的同行候選（完全重疊、部分重疊、鄰近日期）。不可用「本人原申請沒有同行者」推論沒有其他人。回傳姓名、工號、日期差異與候選原因；不捏造機率。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING', description: '目標出差／報支草稿' },
        query: { type: 'STRING', description: '姓名、工號、地點或專案關鍵字' },
        near_days: { type: 'NUMBER', description: '鄰近天數，預設 3' },
      },
      required: ['draft_id'],
    },
  },
  {
    name: 'duplicate_application_draft',
    description: '複製一張草稿為新草稿（只複製欄位資料，不複製附件）。回傳新 draft_id。',
    parameters: {
      type: 'OBJECT',
      properties: { draft_id: { type: 'STRING' } },
      required: ['draft_id'],
    },
  },
  {
    name: 'rename_application_draft',
    description: '更改草稿標題（需 expected_version）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING' },
        title: { type: 'STRING' },
        expected_version: { type: 'NUMBER' },
      },
      required: ['draft_id', 'title', 'expected_version'],
    },
  },
  {
    name: 'search_company_regulations',
    description:
      '查詢台灣智慧駕駛（Turing Drive）之公司規章、管理辦法與內控規範（例如：採購管理辦法、詢比議價門檻、員工出差管理辦法、私車公用里程補助、住宿與日用費上限、出勤與請假/特休/加班規定、薪資與考核晉升、員工獎懲、教育訓練、跨部門借調、退職留停、員工社團補助、印鑑用印、資產異動、專利與 NDA/MOU 審閱等）。當員工詢問公司規定、報支標準、申請時限或需要引用規章條文時，優先呼叫此工具。',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: '查詢關鍵字（如「出差住宿上限」、「採購比價」、「特休」、「私車里程補助」、「用印」），留空則列出核心規章目錄',
        },
        category: {
          type: 'STRING',
          description:
            '選填分類過濾：hr_attendance(出勤與差旅) / hr_compensation(薪酬考核獎懲) / hr_talent(招募訓練調動) / hr_welfare_safety(福利與職場安全) / finance_procurement(採購費用資產) / admin_legal(印鑑法務智財)',
        },
        limit: {
          type: 'NUMBER',
          description: '回傳筆數上限，預設 5',
        },
      },
    },
  },
  {
    name: 'list_company_announcements',
    description:
      '查詢目前發布中的「公司公告」（對應「公司資訊 > 公司公告」/announcements），回傳每則公告的標題、分類、重要度（一般／重要／緊急）、是否置頂、發布日期、本人閱讀狀態（未讀／已讀／已確認）、完整內文與附件清單。注意：此工具專門查詢全公司或部門正式公告，不包含個人簽核單據通知。',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: '選填關鍵字（搜尋標題、分類或內文），留空則列出所有可見的公司公告',
        },
        unread_only: {
          type: 'BOOLEAN',
          description: 'true＝僅列出本人尚未閱讀的公司公告；預設 false（列出全部可見公告）',
        },
        limit: {
          type: 'NUMBER',
          description: '回傳筆數上限，預設 15',
        },
      },
    },
  },
  {
    name: 'list_company_surveys',
    description:
      '查詢目前開放中或近期的「公司問卷調查」（對應「公司資訊 > 問卷調查」/surveys），回傳問卷標題、說明、狀態、截止時間與本人是否已填寫。',
    parameters: {
      type: 'OBJECT',
      properties: {
        pending_only: {
          type: 'BOOLEAN',
          description: 'true＝僅列出本人尚未填寫的開放中問卷；預設 false',
        },
      },
    },
  },
  {
    name: 'list_inventory_handover_forms',
    description:
      '查詢目前登入使用者可見的「財產清點／點交確認系統表單」（/assets/inventory-forms），回傳每張清點單的單號、財產擁有者、清點人、指定點交時間、總條數、雙方已確認條數與各條財產明細（現在位置、是否同意或需更改異動、存在事實、雙方確認狀態）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        status: {
          type: 'STRING',
          description: '選填：open（點交確認中）／locked（已結案）／all（全部，預設）',
          enum: ['open', 'locked', 'all'],
        },
      },
    },
  },
  {
    name: 'dispatch_inventory_handover_form',
    description:
      '清點人（財會、總務或系統管理員）於指定時間發給財產擁有者「財產清點／點交確認系統表單」。支援傳入保管人姓名、工號或 UUID（如 "阮振瑋" 或 "0017"），系統會自動撈取該員工名下所有在列財產建立點交單並發送通知。',
    parameters: {
      type: 'OBJECT',
      properties: {
        custodian: {
          type: 'STRING',
          description: '財產擁有者（保管人）之姓名、工號或 UUID（例如 "阮振瑋" 或 "0017"）',
        },
        scheduled_at: {
          type: 'STRING',
          description: '指定清點／點交時間（YYYY-MM-DDTHH:mm，若未指定則預設為今日 14:00）',
        },
        meeting_location: {
          type: 'STRING',
          description: '選填：點交地點（如 "台北辦公室 3F 自動駕駛系統部"）',
        },
        instructions: {
          type: 'STRING',
          description: '選填：點交說明事項',
        },
      },
      required: ['custodian'],
    },
  },
  {
    name: 'confirm_inventory_handover_items',
    description:
      '財產擁有者（custodian）或清點人（inspector）於「財產清點／點交確認系統表單」上對財產進行點交確認：可點選「同意現在位置（agree_current）」或「需要更改異動（change_needed，並填 confirmed_location 新位置）」，確認此物品之存在事實（exists 正常存在／exists_damaged 損壞／missing 未尋獲）及其他說明（note）。當雙方每一條都確認後，若設 complete_if_ready=true 可一併完成結案並回寫財產保管清冊。',
    parameters: {
      type: 'OBJECT',
      properties: {
        batch_id: {
          type: 'STRING',
          description: '選填：清點單 batch UUID（若未填則可填 form_number 或自動取本人最新一張進行中的清點單）',
        },
        form_number: {
          type: 'STRING',
          description: '選填：清點單號（如 INV-20261113-0017-123）',
        },
        asset_tag: {
          type: 'STRING',
          description: '選填：指定要確認的財產編號（如 TD-IT-0054-01）；若省略則確認該單全部明細',
        },
        party: {
          type: 'STRING',
          description: '確認方身分：custodian（財產擁有者）／inspector（清點人）。若省略則依當前登入者身分自動判斷',
          enum: ['custodian', 'inspector'],
        },
        location_action: {
          type: 'STRING',
          description: 'agree_current（同意現在位置無誤，預設）或 change_needed（需要更改位置或提出異動）',
          enum: ['agree_current', 'change_needed'],
        },
        confirmed_location: {
          type: 'STRING',
          description: '當 location_action="change_needed" 時必填：更改後的新位置',
        },
        existence_fact: {
          type: 'STRING',
          description: '物品存在事實：exists（物品存在正常，預設）／exists_damaged（存在但損壞）／missing（未尋獲）',
          enum: ['exists', 'exists_damaged', 'missing'],
        },
        note: {
          type: 'STRING',
          description: '選填：其他說明（會依確認方寫入財產人說明或清點人說明）',
        },
        complete_if_ready: {
          type: 'BOOLEAN',
          description: 'true＝若確認後雙方每一條明細都已確認完畢，立即將這張清點單結束結案並同步回寫財產清冊',
        },
      },
    },
  },
  {
    name: 'get_my_pending_tasks_overview',
    description:
      '查詢目前登入使用者在左側「我的待辦」導覽列各子項目的待處理事項數量與明細摘要：包含「簽核與單據追蹤（待我簽核＋被退回補件）」、「年度預算表填報（財會派發待填單）」、「我的資產管理（收到待確認之【財產清點單 INV-...】）」與「我的專屬問卷（待填問卷）」。',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'list_my_budget_tasks_and_history',
    description:
      '查詢目前登入使用者在「我的待辦 → 年度預算表填報（/my-tasks/budget）」的完整總覽清單：包含（1）待填年度預算編列單與草稿進度、（2）歷年已填報並核准之歷史預算紀錄。注意：僅當使用者詢問「我有哪些預算任務／預算單總覽／歷年預算紀錄」時才呼叫此工具；若使用者是指定切換、開啟或編輯某一張特定預算草稿（例如指定某專案 NSC 或某部門草稿），請改呼叫 describe_application_draft(draft_id)，切勿呼叫此總覽工具以免把其他無關草稿與歷史單據一併列出。',
    parameters: {
      type: 'OBJECT',
      properties: {
        fiscal_year: {
          type: 'STRING',
          description: '選填：篩選特定歷年年度（例如 "115" 或 "114"），留空則回傳全部年度紀錄',
        },
        open_draft: {
          type: 'BOOLEAN',
          description: '選填：設為 true 時，若本人有填寫中的年度預算表草稿，自動在畫面右側彈出該張預算表草稿供繼續填寫',
        },
      },
    },
  },
  {
    name: 'dispatch_budget_compilation_notice',
    description:
      '財會人員或系統管理員派發「年度預算編列填寫單（budget_dispatch）」給指定員工或部門主管（對應 /budget-codes 預算發送人系統）。收到通知的員工即可在「我的待辦 → 年度預算表填報（/my-tasks/budget）」看到待辦並線上填寫 1～12 月預算表與差異分析。',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipient: {
          type: 'STRING',
          description: '接收預算填寫單之員工姓名、工號（如 "阮振瑋"、"0017"），或填 "self" 發給當前登入帳號自己測試',
        },
        fiscal_year: {
          type: 'STRING',
          description: '預算編列年度（民國年，預設 "116" 即 2027 年度）',
        },
        scope: {
          type: 'STRING',
          description: '派發預算表類型：department（部門年度預算表）／project（專案年度預算表）／both（兩者皆發，預設）',
          enum: ['department', 'project', 'both'],
        },
        deadline_date: {
          type: 'STRING',
          description: '填報截止日期（YYYY-MM-DD，預設 "2026-12-15"）',
        },
        custom_note: {
          type: 'STRING',
          description: '選填：財會派發備註說明',
        },
      },
    },
  },
  {
    name: 'get_budget_analytics_summary',
    description:
      '針對財會與管理人員提供「單一年度」具實質決策意義的預算管理指標（對應 /budget-codes 頂部 4 張財務治理卡片，避免跨年度混算）：回傳指定年度（預設最新年度如 115 年度）之核定預算總額、與前一年度（如 114 年度）之 YoY 增減金額與成長率、部門營運預算規模與部門編列涵蓋率、專案預算規模與專案編列涵蓋率，以及預算動支單據引用次數、0 元待補額度科目數、未指派負責人科目數等財會治理檢核指標。',
    parameters: {
      type: 'OBJECT',
      properties: {
        fiscal_year: {
          type: 'STRING',
          description: '選填：要分析的預算年度（如 "115"、"114"、"116"）；若未指定則自動以系統最新年度為基準計算並與前一年度對照',
        },
      },
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

export function toolUiLabel(name: string, locale?: Locale): string {
  const raw = TOOL_LABELS[name as AiChatToolName] ?? name;
  return locale ? translatePhrase(raw, locale) : raw;
}

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
  propose_draft_changes: '修改確認',
  propose_nudge: '催簽確認',
  search_my_submissions: '查詢我的單據',
  start_resubmission: '開補件草稿',
  propose_approved_document_picker: '選擇核准單據',
  attach_approved_document_pdf: '附加核准 PDF',
  attach_staged_files_to_draft: '附加聊天附件到草稿',
  list_draft_attachments: '列出草稿附件',
  remove_draft_attachments: '移除草稿附件',
  duplicate_application_draft: '複製草稿',
  rename_application_draft: '草稿改名',
  search_trip_companion_candidates: '搜尋同行候選',
  search_my_assets: '查詢資產',
  list_inventory_handover_forms: '查詢財產清點單',
  dispatch_inventory_handover_form: '派發財產清點單',
  confirm_inventory_handover_items: '確認財產點交明細',
  get_my_pending_tasks_overview: '查詢我的待辦總覽',
  list_my_budget_tasks_and_history: '查詢年度預算任務與歷年紀錄',
  dispatch_budget_compilation_notice: '派發年度預算編列單',
  get_budget_analytics_summary: '年度預算財務與治理指標分析',
  search_company_regulations: '查詢公司規章',
  list_company_announcements: '查詢公司公告',
  list_company_surveys: '查詢公司問卷',
  approve_submission: '代為簽核',
  return_submission: '代為退回',
  approve_all_pending: '批次簽核',
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
  const label = toolUiLabel(tool, ctx?.locale);
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

  const { getSystemFeatureFlags } = await import('@/lib/feature-flags/service');
  const { getFeatureDefinition, resolveFeatureFlagForFormKey } = await import(
    '@/lib/feature-flags/definitions'
  );
  const featureFlags = await getSystemFeatureFlags();

  const TOOL_MODULE_FLAG: Partial<
    Record<string, import('@/lib/feature-flags/definitions').FeatureFlagKey>
  > = {
    search_budget_codes: 'budget_management_platform',
    list_my_budget_tasks_and_history: 'budget_management_platform',
    dispatch_budget_compilation_notice: 'budget_management_platform',
    get_budget_analytics_summary: 'budget_management_platform',
    search_my_assets: 'asset_management_module',
    list_inventory_handover_forms: 'asset_management_module',
    dispatch_inventory_handover_form: 'asset_management_module',
    confirm_inventory_handover_items: 'asset_management_module',
    search_company_regulations: 'company_info_hub',
    list_company_announcements: 'company_info_hub',
    list_company_surveys: 'company_info_hub',
    list_my_purchase_requests: 'procurement_module',
    list_my_purchase_orders: 'procurement_module',
    get_purchase_request_detail: 'procurement_module',
    get_case_overview: 'procurement_module',
    list_my_expense_claims: 'expense_claim_module',
    search_trip_companion_candidates: 'expense_claim_module',
  };

  let requiredToolFlag = TOOL_MODULE_FLAG[tool] ?? null;
  if (
    !requiredToolFlag &&
    (tool === 'create_application_draft' || tool === 'get_form_spec')
  ) {
    const rawFormKey =
      typeof args?.form_key === 'string'
        ? args.form_key
        : typeof args?.formKey === 'string'
          ? args.formKey
          : '';
    if (rawFormKey) {
      requiredToolFlag = resolveFeatureFlagForFormKey(rawFormKey);
    }
  }

  if (requiredToolFlag && !featureFlags[requiredToolFlag]) {
    const def = getFeatureDefinition(requiredToolFlag);
    return {
      ok: false,
      name: tool,
      label,
      response: {
        error: 'module_unlicensed_or_disabled',
        message: `「${def?.title ?? requiredToolFlag}」目前於全公司系統授權中為未開放／已關閉狀態，全體人員（含系統管理員）皆無法使用此功能模組。`,
      },
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
          response: { count: matched.length, budgetCodes: clip(matched, 25), href: '/budget-codes' },
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
        const blocks = cardsFromPendingApprovals(inbox.pendingApprovals);
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
              formKey: i.formKey,
            })),
            message: inbox.pendingTotal
              ? `共 ${inbox.pendingTotal} 張待簽核；畫面已顯示大綱卡。使用者若要求代簽／全部簽核，請呼叫 approve_submission 或 approve_all_pending。回覆請簡短，勿複寫卡片內容。`
              : '目前沒有待簽核單據。',
          },
          blocks: blocks.length ? blocks : undefined,
        };
      }

      case 'list_my_purchase_requests': {
        const rows = await getMyRequests();
        const topRows = clip(rows, 25);
        const cardRows = await Promise.all(
          topRows.slice(0, 10).map(async (r) => {
            const snap = await getFormApprovalSnapshot('purchase_request', r.id);
            return {
              formType: 'purchase_request',
              formId: r.id,
              formKey: 'purchase_request',
              formName: '請購單',
              formNumber: r.caseNumber,
              status: r.status,
              summary: `申請日期 ${r.requestDate}`,
              approvedAt: null,
              version: snap?.version ?? 1,
              href: `/requests/${r.id}`,
              totalAmount: Number(r.totalAmount ?? 0),
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            };
          })
        );
        const blocks = cardsFromMySubmissions(cardRows);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            requests: topRows.map((r) => ({
              id: r.id,
              caseNumber: r.caseNumber,
              status: r.status,
              totalAmount: r.totalAmount,
              requestDate: r.requestDate,
              href: `/requests/${r.id}`,
            })),
          },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'list_my_purchase_orders': {
        const rows = await getMyPurchaseOrders();
        const topRows = clip(rows, 25);
        const cardRows = await Promise.all(
          topRows.slice(0, 10).map(async (o) => {
            const snap = await getFormApprovalSnapshot('purchase_order', o.id);
            return {
              formType: 'purchase_order',
              formId: o.id,
              formKey: 'purchase_order',
              formName: '採購單',
              formNumber: o.caseNumber,
              status: o.status,
              summary: '採購單',
              approvedAt: null,
              version: snap?.version ?? 1,
              href: `/purchase-orders/${o.id}`,
              totalAmount: Number(o.totalAmount ?? 0),
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            };
          })
        );
        const blocks = cardsFromMySubmissions(cardRows);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            orders: topRows.map((o) => ({
              id: o.id,
              caseNumber: o.caseNumber,
              status: o.status,
              totalAmount: o.totalAmount,
              href: `/purchase-orders/${o.id}`,
            })),
          },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'list_my_expense_claims': {
        const rows = await getMyExpenseClaims();
        const topRows = clip(rows, 25);
        const cardRows = await Promise.all(
          topRows.slice(0, 10).map(async (c) => {
            const ft = `${c.edition}_expense` as FormType;
            const snap = await getFormApprovalSnapshot(ft, c.id);
            return {
              formType: ft,
              formId: c.id,
              formKey: ft,
              formName: FORM_LABELS[ft] ?? '費用報支單',
              formNumber: c.caseNumber,
              status: c.status,
              summary: `${c.departmentName} · ${c.applicationDate}`,
              approvedAt: null,
              version: snap?.version ?? 1,
              href: `/expense-claims/${c.edition}/${c.id}`,
              totalAmount: Number(c.totalAmount ?? 0),
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            };
          })
        );
        const blocks = cardsFromMySubmissions(cardRows);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: rows.length,
            claims: topRows.map((c) => ({
              id: c.id,
              edition: c.edition,
              caseNumber: c.caseNumber,
              status: c.status,
              totalAmount: c.totalAmount,
              departmentName: c.departmentName,
              applicationDate: c.applicationDate,
              createdAt: c.createdAt.toISOString(),
              href: `/expense-claims/${c.edition}/${c.id}`,
            })),
          },
          ...(blocks.length ? { blocks } : {}),
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
        const snap = await getFormApprovalSnapshot('purchase_request', detail.id);
        const blocks = cardsFromMySubmissions([
          {
            formType: 'purchase_request',
            formId: detail.id,
            formKey: 'purchase_request',
            formName: '請購單',
            formNumber: detail.caseNumber,
            status: detail.status,
            summary: `${detail.departmentName} · 共 ${detail.items.length} 項`,
            approvedAt: null,
            version: snap?.version ?? 1,
            href: `/requests/${detail.id}`,
            totalAmount: Number(detail.totalAmount ?? 0),
            currentNodeLabel: snap?.currentNodeLabel ?? null,
            pendingApproverNames: snap?.pendingApproverNames ?? [],
            snapshot: snap,
            canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            applicantName: detail.applicantName,
          },
        ]);
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
          blocks,
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
          // Also check if caseNumber matches a custom form_submissions.form_number directly
          const { formDefinitions: fdTable, employees: empTable } = await import('@/lib/db/schema');
          const [customSub] = await getDb()
            .select({
              id: formSubmissions.id,
              formNumber: formSubmissions.formNumber,
              status: formSubmissions.status,
              totalAmount: formSubmissions.totalAmount,
              key: fdTable.key,
              name: fdTable.name,
              applicantName: empTable.name,
            })
            .from(formSubmissions)
            .innerJoin(fdTable, eq(fdTable.id, formSubmissions.definitionId))
            .innerJoin(empTable, eq(empTable.id, formSubmissions.applicantEmployeeId))
            .where(eq(formSubmissions.formNumber, caseNumber.value))
            .limit(1);
          if (!customSub) {
            return {
              ok: false,
              name: tool,
              label,
              response: { error: 'not_found_or_forbidden', message: '找不到案件，或你不是參與者。' },
            };
          }
          const [snap, factsMap] = await Promise.all([
            getFormApprovalSnapshot('custom', customSub.id),
            loadFormFacts([{ formType: 'custom', formId: customSub.id }]),
          ]);
          const f = factsFor(factsMap, { formType: 'custom', formId: customSub.id });
          const richSummary =
            (f ? [f.what, f.where, f.when].filter(Boolean).join(' · ') : '') ||
            customSub.name;
          const totalAmt =
            customSub.totalAmount != null
              ? Number(customSub.totalAmount)
              : (f?.amount ?? null);
          const blocks = cardsFromMySubmissions([
            {
              formType: 'custom',
              formId: customSub.id,
              formKey: customSub.key,
              formName: customSub.name,
              formNumber: customSub.formNumber,
              status: customSub.status,
              summary: richSummary,
              approvedAt: null,
              version: snap?.version ?? 1,
              href: `/f/${customSub.key}/${customSub.id}`,
              totalAmount: totalAmt,
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
              applicantName: customSub.applicantName,
            },
          ]);
          return {
            ok: true,
            name: tool,
            label,
            response: {
              caseNumber: customSub.formNumber,
              forms: [
                {
                  formType: 'custom',
                  formKey: customSub.key,
                  label: customSub.name,
                  id: customSub.id,
                  status: customSub.status,
                  href: `/f/${customSub.key}/${customSub.id}`,
                },
              ],
            },
            blocks,
          };
        }
        const readableForms = overview.forms.filter((f) => f.exists && !f.restricted && f.id);
        const cardRows = await Promise.all(
          readableForms.map(async (f) => {
            const isCustomHref = Boolean(f.href?.startsWith('/f/'));
            const resolvedType: FormType = isCustomHref ? 'custom' : f.formType;
            const snap = await getFormApprovalSnapshot(resolvedType, f.id!);
            return {
              formType: resolvedType,
              formId: f.id!,
              formKey: isCustomHref ? (f.href?.split('/')[2] || 'custom') : f.formType,
              formName: f.label,
              formNumber: overview.caseNumber,
              status: f.status ?? snap?.status ?? 'pending_approval',
              summary: `${f.itemCode} · ${f.label}`,
              approvedAt: null,
              version: snap?.version ?? 1,
              href: f.href ?? `${FORM_ROUTE_PREFIX[f.formType]}/${f.id}`,
              totalAmount: null,
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            };
          })
        );
        const blocks = cardsFromMySubmissions(cardRows);
        return {
          ok: true,
          name: tool,
          label,
          response: { overview, href: '/case-tracking' },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'get_form_approval_status': {
        const formType = requireString(args, 'form_type', { min: 3, max: 40 });
        const formId = requireUuid(args, 'form_id');
        if (!formType.ok) return { ok: false, name: tool, label, response: { error: formType.error } };
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        const ft = formType.value as FormType;
        const [snap, factsMap] = await Promise.all([
          getFormApprovalSnapshot(ft, formId.value),
          loadFormFacts([{ formType: ft, formId: formId.value }]),
        ]);
        if (!snap) {
          return { ok: false, name: tool, label, response: { error: 'not_found', message: '找不到單據。' } };
        }
        const f = factsFor(factsMap, { formType: ft, formId: formId.value });
        let resolvedFormKey: string = ft;
        let resolvedFormName: string = FORM_LABELS[ft] ?? '單據';
        let resolvedApplicantName: string | undefined;
        let resolvedAmount: number | null = f?.amount ?? null;
        if (ft === 'custom') {
          const { formDefinitions: fdTable, employees: empTable } = await import('@/lib/db/schema');
          const [customSub] = await getDb()
            .select({
              key: fdTable.key,
              name: fdTable.name,
              applicantName: empTable.name,
              totalAmount: formSubmissions.totalAmount,
            })
            .from(formSubmissions)
            .innerJoin(fdTable, eq(fdTable.id, formSubmissions.definitionId))
            .innerJoin(empTable, eq(empTable.id, formSubmissions.applicantEmployeeId))
            .where(eq(formSubmissions.id, formId.value))
            .limit(1);
          if (customSub) {
            resolvedFormKey = customSub.key;
            resolvedFormName = customSub.name;
            resolvedApplicantName = customSub.applicantName;
            if (customSub.totalAmount != null) {
              resolvedAmount = Number(customSub.totalAmount);
            }
          }
        }
        const richSummary =
          (f ? [f.what, f.where, f.when].filter(Boolean).join(' · ') : '') ||
          resolvedFormName;
        const href =
          ft === 'custom' && resolvedFormKey !== 'custom'
            ? `/f/${resolvedFormKey}/${formId.value}`
            : `${FORM_ROUTE_PREFIX[ft] ?? '/f/_'}/${formId.value}`;
        const blocks = cardsFromMySubmissions([
          {
            formType: ft,
            formId: formId.value,
            formKey: resolvedFormKey,
            formName: resolvedFormName,
            formNumber: snap.caseNumber ?? formId.value.slice(0, 8),
            status: snap.status,
            summary: richSummary,
            approvedAt: null,
            version: snap.version ?? 1,
            href,
            totalAmount: resolvedAmount,
            currentNodeLabel: snap.currentNodeLabel,
            pendingApproverNames: snap.pendingApproverNames,
            snapshot: snap,
            canApprove: snap.pendingApproverIds.includes(employee.id),
            applicantName: resolvedApplicantName,
          },
        ]);
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
            href,
          },
          blocks,
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
        const cardTitle = draftCtx.draft.title || draftCtx.name;
        const open = draftOpenResource({
          draftId: draftCtx.draft.id,
          title: cardTitle,
          version: draftCtx.draft.version,
          operation: 'opened',
          formKey: draftCtx.formKey,
          status: draftCtx.draft.status,
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: draftCtx.draft.id,
            formKey: draftCtx.formKey,
            formName: cardTitle,
            version: draftCtx.draft.version,
            status: draftCtx.draft.status,
            data: draftCtx.draft.data,
            missing: status.missing,
            invalid: status.invalid,
            fields: formSpec(draftCtx.schema, draftCtx.options),
            versionMismatch: draftCtx.versionMismatch,
          },
          blocks: [
            {
              kind: 'draft_reference',
              id: `draft_${draftCtx.draft.id}`,
              draftId: draftCtx.draft.id,
              formKey: draftCtx.formKey,
              formName: cardTitle,
              version: draftCtx.draft.version,
              status: draftCtx.draft.status,
            },
          ],
          openResources: [open],
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

        const { getMyApplicationsAll } = await import('@/lib/applications/my-applications');
        const allMyItems = await getMyApplicationsAll();

        const statusCounts = {
          pending_approval: allMyItems.filter((i) => i.status === 'pending_approval').length,
          returned: allMyItems.filter((i) => i.status === 'returned').length,
          approved: allMyItems.filter((i) => i.status === 'approved').length,
          total: allMyItems.length,
        };

        const filtered = allMyItems.filter((item) => {
          if (formKey) {
            const fk = formKey.toLowerCase();
            const matchKey =
              item.formKey?.toLowerCase() === fk ||
              item.formType.toLowerCase() === fk ||
              item.formLabel.toLowerCase().includes(fk);
            if (!matchKey) return false;
          }
          if (approvedOnly) {
            if (item.status !== 'approved') return false;
          } else if (status && status !== 'all') {
            if (item.status !== status) return false;
          }
          if (query) {
            const q = query.toLowerCase();
            const haystack = [
              item.caseNumber,
              item.formLabel,
              item.categoryLabel,
              item.summary,
              item.currentNodeLabel ?? '',
              ...item.pendingApproverNames,
              item.returnReason ?? '',
            ]
              .join(' ')
              .toLowerCase();
            if (!haystack.includes(q)) return false;
          }
          return true;
        });

        const pageItems = filtered.slice(0, 30);
        const mappedHits = pageItems.map((i) => ({
          formType: i.formType,
          formId: i.id,
          formKey: i.formKey ?? '',
          formName: i.formLabel,
          formNumber: i.caseNumber,
          status: i.status,
          summary: i.summary || i.formLabel,
          approvedAt: i.status === 'approved' ? i.dateLabel : null,
          version: 1,
          href: i.href,
          totalAmount: i.totalAmount,
          currentNodeLabel: i.currentNodeLabel,
          pendingApproverNames: i.pendingApproverNames,
          returnReason: i.returnReason,
          returnedByName: i.returnedByName,
          applicantName: employee.name,
          waitingFor: i.waitingFor,
          canApprove: i.status === 'pending_approval' && i.pendingApproverNames.includes(employee.name),
          snapshot: i.progress
            ? {
                formType: i.formType,
                formId: i.id,
                caseNumber: i.caseNumber,
                status: i.status,
                currentStepOrder: null,
                currentNodeLabel: i.currentNodeLabel,
                pendingApproverIds: [],
                pendingApproverNames: i.pendingApproverNames,
                waitingSinceIso: null,
                version: null,
                progress: i.progress,
              }
            : null,
        }));

        const blocks = cardsFromMySubmissions(mappedHits);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            statusCounts,
            matchedCount: filtered.length,
            items: mappedHits.map(({ snapshot: _s, ...rest }) => rest),
            hasMore: filtered.length > 30,
            message: filtered.length
              ? `本人全部送出單據統計：簽核中 ${statusCounts.pending_approval} 筆、已退回 ${statusCounts.returned} 筆、已核准 ${statusCounts.approved} 筆（總計 ${statusCounts.total} 筆）。本次查詢符合條件共 ${filtered.length} 筆；畫面已顯示大綱卡（可開詳情）。請務必依據上述統計數字回覆，勿遺漏筆數或長篇複寫卡片內容。`
              : `沒有符合條件的單據（本人總計：簽核中 ${statusCounts.pending_approval} 筆、已退回 ${statusCounts.returned} 筆、已核准 ${statusCounts.approved} 筆）。`,
          },
          blocks: blocks.length ? blocks : undefined,
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
        // Business reminders (統編等) do not block attach — record acknowledgement and continue.
        const {
          analyzeStagedAttachment,
          confirmStagedInvoiceReminder,
          hasStagedInvoiceConfirmation,
          invoiceStatusNeedsConfirm,
        } = await import('./staged-invoice');
        const { aiChatStagedAttachments } = await import('@/lib/db/schema');
        const { getDb } = await import('@/lib/db');
        const { and, eq, isNull } = await import('drizzle-orm');
        const reminders: Array<{ stagedId: string; fileName: string; summary: string }> = [];
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
              await confirmStagedInvoiceReminder({
                actorId: employee.id,
                stagedId: sid,
                draftId: draftId.value,
                userNote: '對話加入附件（提醒不阻擋）',
              });
              reminders.push({
                stagedId: sid,
                fileName: row.fileName,
                summary: analysis.summary ?? analysis.overallStatus,
              });
            }
          }
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

      case 'search_my_assets': {
        const q = typeof args?.query === 'string' ? args.query.trim() : '';
        const rawScope = typeof args?.scope === 'string' ? args.scope : 'mine';
        const scope =
          rawScope === 'department' || rawScope === 'company' || rawScope === 'mine' ? rawScope : 'mine';
        const { searchAssetsForAi } = await import('@/lib/assets/scope-queries');
        const rows = await searchAssetsForAi({
          employeeId: employee.id,
          role: employee.role,
          q: q || undefined,
          scope,
          limit: 30,
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            scope,
            count: rows.length,
            href: '/assets/mine',
            assets: rows.map((r) => ({
              tag: r.tag,
              name: r.name,
              itemKind: r.itemKind,
              location: r.location,
              status: r.status,
              custodianName: r.custodianName,
            })),
            message:
              rows.length === 0
                ? '在你可查看的範圍內沒有符合的資產。'
                : `找到 ${rows.length} 筆（範圍 ${scope}）。回答請用名稱、種類、地點與狀態；財產編號僅作識別。`,
          },
        };
      }

      case 'list_draft_attachments': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const owned = await getDraftForOwner(draftId.value, employee.id);
        if (!owned || !(await isDraftInConversation(owned.id, ctx.conversationId, employee.id))) {
          return { ok: false, name: tool, label, response: { error: 'draft_forbidden', message: '找不到草稿或無權查看。' } };
        }
        const { listDraftFiles } = await import('./attach-staged');
        const files = await listDraftFiles(owned.id, employee.id);
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: owned.id,
            draftVersion: owned.version,
            count: files.length,
            files: files.map((f) => ({
              id: f.id,
              fileName: f.fileName,
              mimeType: f.mimeType,
              fileSizeBytes: f.fileSizeBytes,
            })),
            message:
              files.length === 0
                ? '這張草稿目前沒有附件。'
                : `這張草稿有 ${files.length} 個附件。移除時請用 file id，不要只用檔名。`,
          },
        };
      }

      case 'remove_draft_attachments': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const expectedVersion = Number(args?.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, name: tool, label, response: { error: 'expected_version_invalid' } };
        }
        const removeAll = args?.remove_all === true;
        const rawIds = Array.isArray(args?.file_ids) ? args.file_ids : [];
        const fileIds = rawIds.filter((x): x is string => typeof x === 'string');
        if (!removeAll && fileIds.length === 0) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'file_ids_required',
              message: '請指定 file_ids，或明確設 remove_all=true。不可在目標不明時操作所有草稿。',
            },
          };
        }
        const { removeDraftFiles } = await import('./attach-staged');
        const removed = await removeDraftFiles({
          actor: { id: employee.id, role: employee.role },
          conversationId: ctx.conversationId,
          draftId: draftId.value,
          expectedVersion,
          fileIds,
          removeAll,
        });
        if ('conflict' in removed && removed.conflict) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'version_conflict',
              version: removed.conflict.draft.version,
              message: '草稿版本衝突，請重新讀取草稿後再移除。',
            },
          };
        }
        if (!removed.ok) {
          if ('error' in removed) {
            return {
              ok: false,
              name: tool,
              label,
              response: { error: removed.error, message: removed.message },
            };
          }
          return { ok: false, name: tool, label, response: { error: 'remove_failed' } };
        }
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: removed.draft.id,
            draftVersion: removed.draft.version,
            removedCount: removed.removedCount,
            removed: removed.removed.map((f) => ({ id: f.id, fileName: f.fileName })),
            message:
              removed.removedCount === 0
                ? '沒有可移除的附件（可能已移除或 ID 不符）。'
                : `已移除這張草稿的 ${removed.removedCount} 個附件。此操作只解除本草稿關聯，不銷毀其他單據或聊天原檔。`,
          },
          openResources: [
            draftOpenResource({
              draftId: removed.draft.id,
              title: removed.draft.title || removed.draft.formDefinitionKey,
              version: removed.draft.version,
              operation: 'updated',
              formKey: removed.draft.formDefinitionKey,
              status: removed.draft.status,
            }),
          ],
        };
      }

      case 'duplicate_application_draft': {
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const { duplicateApplicationDraft } = await import('./drafts');
        const row = await duplicateApplicationDraft({ draftId: draftId.value, ownerEmployeeId: employee.id });
        if (!row) {
          return { ok: false, name: tool, label, response: { error: 'duplicate_failed', message: '無法複製草稿。' } };
        }
        return {
          ok: true,
          name: tool,
          label,
          response: {
            draftId: row.id,
            title: row.title,
            version: row.version,
            message: `已複製為新草稿「${row.title}」（未複製附件）。`,
          },
          openResources: [
            draftOpenResource({
              draftId: row.id,
              title: row.title,
              version: row.version,
              operation: 'opened',
              formKey: row.formDefinitionKey,
              status: row.status,
            }),
          ],
        };
      }

      case 'rename_application_draft': {
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const title = requireString(args, 'title', { min: 1, max: 160 });
        if (!title.ok) return { ok: false, name: tool, label, response: { error: title.error } };
        const expectedVersion = Number(args?.expected_version);
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
          return { ok: false, name: tool, label, response: { error: 'expected_version_invalid' } };
        }
        const { renameApplicationDraft } = await import('./drafts');
        const row = await renameApplicationDraft({
          draftId: draftId.value,
          ownerEmployeeId: employee.id,
          title: title.value,
          expectedVersion,
        });
        if (!row) {
          return { ok: false, name: tool, label, response: { error: 'rename_failed', message: '無法改名（草稿不存在或已非草稿）。' } };
        }
        if ('conflict' in row) {
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: 'version_conflict',
              version: row.conflict.version,
              message: '草稿版本衝突，請重新讀取後再改名。',
            },
          };
        }
        return {
          ok: true,
          name: tool,
          label,
          response: { draftId: row.id, title: row.title, version: row.version, message: `已將草稿改名為「${row.title}」。` },
          openResources: [
            draftOpenResource({
              draftId: row.id,
              title: row.title,
              version: row.version,
              operation: 'updated',
              formKey: row.formDefinitionKey,
              status: row.status,
            }),
          ],
        };
      }

      case 'search_trip_companion_candidates': {
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const owned = await getDraftForOwner(draftId.value, employee.id);
        if (!owned) {
          return { ok: false, name: tool, label, response: { error: 'draft_forbidden', message: '找不到草稿。' } };
        }
        const nearDays = Number(args?.near_days);
        const q = typeof args?.query === 'string' ? args.query.trim() : '';
        const { searchTripCompanionCandidates } = await import('./companion-candidates');
        const result = await searchTripCompanionCandidates({
          actorEmployeeId: employee.id,
          draft: owned,
          query: q || undefined,
          nearDays: Number.isFinite(nearDays) && nearDays > 0 ? Math.min(nearDays, 30) : 3,
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            ...result,
            message:
              result.candidates.length === 0
                ? `在搜尋範圍內（目標行程前後 ${result.nearDays} 天、地點／專案比對；僅你有權查看的候選）找不到可能同行人員。不會因此把草稿同行者欄位改成「無」。可擴大 near_days 或改關鍵字。`
                : `以下是可能同行的人員，日期不完全相同，請依實際行程選擇。共 ${result.candidates.length} 位（鄰近範圍 ±${result.nearDays} 天）。不要捏造機率；同名請用工號辨識。`,
          },
        };
      }

      case 'approve_submission': {
        const formId = requireUuid(args, 'form_id');
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        const outcome = await approveOneForActor(employee, formId.value, ctx?.conversationId ?? null);
        return {
          ok: outcome.ok,
          name: tool,
          label,
          response: outcome,
        };
      }

      case 'return_submission': {
        const formId = requireUuid(args, 'form_id');
        const reason = requireString(args, 'reason', { min: 1, max: 1000 });
        if (!formId.ok) return { ok: false, name: tool, label, response: { error: formId.error } };
        if (!reason.ok) return { ok: false, name: tool, label, response: { error: reason.error, message: '請提供退回原因。' } };
        const outcome = await returnOneForActor(employee, formId.value, reason.value, ctx?.conversationId ?? null);
        return {
          ok: outcome.ok,
          name: tool,
          label,
          response: outcome,
        };
      }

      case 'approve_all_pending': {
        const rawLimit = Number(args?.limit);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.floor(rawLimit)), 30) : 20;
        const inbox = await loadAssistantInbox(limit);
        if (inbox.loadError) {
          return { ok: false, name: tool, label, response: { error: 'inbox_unavailable', message: '待簽核清單暫時無法載入。' } };
        }
        const pendingItems = inbox.pendingApprovals;
        if (pendingItems.length === 0) {
          return {
            ok: true,
            name: tool,
            label,
            response: { approved: 0, failed: 0, message: '目前沒有可代簽的待簽核單據。', results: [] },
          };
        }
        const results: Array<Record<string, unknown>> = [];
        let approved = 0;
        let failed = 0;
        for (const item of pendingItems.slice(0, limit)) {
          const outcome = await approveOneForActor(employee, item.id, ctx?.conversationId ?? null);
          results.push({
            formId: item.id,
            formNumber: item.caseNumber,
            formName: item.label,
            ...outcome,
          });
          if (outcome.ok) approved += 1;
          else failed += 1;
        }
        return {
          ok: failed === 0,
          name: tool,
          label,
          response: {
            approved,
            failed,
            totalAttempted: results.length,
            results,
            message: `已處理 ${results.length} 張：成功 ${approved}、失敗 ${failed}。`,
          },
        };
      }

      case 'search_company_regulations': {
        const query = typeof args?.query === 'string' ? args.query.trim() : '';
        const category = typeof args?.category === 'string' ? args.category.trim() : undefined;
        const limitRaw = Number(args?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 10) : 5;
        const { searchRegulationsForAi } = await import('@/lib/regulations/service');
        const items = await searchRegulationsForAi({
          query: query || undefined,
          category: category || undefined,
          limit,
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            query: query || '（全部核心規章）',
            count: items.length,
            regulations: items,
            hint: '回答時請明確引用規章名稱與條文規定（不需提及規章編號），並可引導使用者前往「公司資訊 > 公司規章」（/regulations）閱覽完整條文或直接協助建立對應表單草稿。',
          },
        };
      }

      case 'list_company_announcements': {
        const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
        const unreadOnly = args?.unread_only === true;
        const limitRaw = Number(args?.limit);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 25) : 15;
        const { activateDueScheduled, listVisibleAnnouncements } = await import('@/lib/announcements/service');
        const { listAnnouncementAttachments } = await import('@/lib/announcements/attachments');
        const { companyAnnouncementReads } = await import('@/lib/db/schema');
        await activateDueScheduled().catch(() => {});
        const [visible, readRows] = await Promise.all([
          listVisibleAnnouncements({
            employeeId: employee.id,
            departmentId: employee.departmentId,
            manage: false,
          }),
          getDb()
            .select()
            .from(companyAnnouncementReads)
            .where(eq(companyAnnouncementReads.employeeId, employee.id)),
        ]);
        const readMap = new Map(readRows.map((r) => [r.announcementId, r]));
        const published = visible.filter((a) => a.status === 'published');
        const filtered = published.filter((a) => {
          const rd = readMap.get(a.id);
          if (unreadOnly && rd?.readAt) return false;
          if (!query) return true;
          return (
            a.title.toLowerCase().includes(query) ||
            (a.category || '').toLowerCase().includes(query) ||
            a.body.toLowerCase().includes(query)
          );
        });
        const items = await Promise.all(
          filtered.slice(0, limit).map(async (a) => {
            const rd = readMap.get(a.id);
            const files = await listAnnouncementAttachments(a.id).catch(() => []);
            const dateSource = a.publishedAt ?? a.publishAt ?? a.createdAt;
            return {
              id: a.id,
              title: a.title,
              category: a.category || '一般',
              priority: a.priority === 'urgent' ? '緊急' : a.priority === 'important' ? '重要' : '一般',
              pinned: Boolean(a.pinned),
              publishedAt: dateSource ? dateSource.toISOString().slice(0, 10) : null,
              isRead: Boolean(rd?.readAt),
              isAcknowledged: Boolean(rd?.acknowledgedAt),
              body: a.body,
              attachments: files.map((f) => f.fileName),
              href: `/announcements?open=${a.id}`,
            };
          })
        );
        return {
          ok: true,
          name: tool,
          label,
          response: {
            totalPublishedCount: published.length,
            unreadCount: published.filter((a) => !readMap.get(a.id)?.readAt).length,
            returnedCount: items.length,
            announcements: items,
            hint: '請針對上述真實公司公告（置頂、重要度、分類、未讀狀態與內容重點）進行條理化整理；切勿混入個人的單據簽核或退回通知。',
          },
        };
      }

      case 'list_company_surveys': {
        const pendingOnly = args?.pending_only === true;
        const { activateDueSurveys, listSurveysForViewer, listQuestions } = await import('@/lib/surveys/service');
        const { companySurveyResponses } = await import('@/lib/db/schema');
        await activateDueSurveys().catch(() => {});
        const [surveys, respRows] = await Promise.all([
          listSurveysForViewer({
            employeeId: employee.id,
            departmentId: employee.departmentId,
            manage: false,
          }),
          getDb()
            .select()
            .from(companySurveyResponses)
            .where(eq(companySurveyResponses.employeeId, employee.id)),
        ]);
        const respMap = new Map(respRows.map((r) => [r.surveyId, r]));
        const filtered = surveys.filter((s) => {
          if (pendingOnly) {
            return s.status === 'open' && respMap.get(s.id)?.status !== 'submitted';
          }
          return true;
        });
        const items = await Promise.all(
          filtered.slice(0, 15).map(async (s) => {
            const resp = respMap.get(s.id);
            const qs = await listQuestions(s.id).catch(() => []);
            return {
              id: s.id,
              title: s.title,
              description: s.description,
              status: s.status === 'open' ? '開放填寫中' : '已截止',
              closesAt: s.closesAt ? s.closesAt.toISOString().slice(0, 10) : null,
              myResponseStatus:
                resp?.status === 'submitted' ? '已填寫送出' : resp?.status === 'draft' ? '草稿暫存中' : '尚未填寫',
              questionCount: qs.length,
              href: `/surveys/${s.id}`,
            };
          })
        );
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: items.length,
            surveys: items,
          },
        };
      }

      case 'list_inventory_handover_forms': {
        const statusFilter =
          typeof args?.status === 'string' && ['open', 'locked', 'all'].includes(args.status)
            ? (args.status as 'open' | 'locked' | 'all')
            : 'all';
        const { listInventoryHandoverForms, getInventoryHandoverFormDetail } = await import(
          '@/lib/assets/inventory-forms'
        );
        const actor = { id: employee.id, role: employee.role };
        const summaries = await listInventoryHandoverForms(actor);
        const filtered =
          statusFilter === 'all' ? summaries : summaries.filter((s) => s.status === statusFilter);
        const details = await Promise.all(
          filtered.slice(0, 10).map(async (s) => {
            const d = await getInventoryHandoverFormDetail(actor, s.id);
            return {
              batchId: s.id,
              formNumber: s.formNumber,
              status: s.status,
              custodianName: s.custodianName,
              custodianEmployeeCode: s.custodianEmployeeCode,
              custodianDepartmentName: s.custodianDepartmentName,
              inspectorName: s.inspectorName,
              scheduledAt: s.scheduledAt,
              meetingLocation: s.meetingLocation,
              totalLines: s.totalLines,
              custodianConfirmedLines: s.custodianConfirmedLines,
              inspectorConfirmedLines: s.inspectorConfirmedLines,
              bothConfirmedLines: s.bothConfirmedLines,
              allLinesConfirmedByBoth: s.allLinesConfirmedByBoth,
              href: `/assets/inventory-forms/${s.id}`,
              lines:
                d?.lines.map((l) => ({
                  lineId: l.id,
                  assetTag: l.assetTag,
                  assetName: l.state.assetName,
                  originalLocation: l.state.originalLocation,
                  locationAction: l.state.locationAction,
                  confirmedLocation: l.state.confirmedLocation,
                  existenceFact: l.state.existenceFact,
                  custodianNote: l.state.custodianNote,
                  inspectorNote: l.state.inspectorNote,
                  custodianConfirmed: l.state.custodianConfirmed,
                  inspectorConfirmed: l.state.inspectorConfirmed,
                })) ?? [],
            };
          })
        );
        const blocks: AiMessageBlock[] = details.map((d) => {
          const custDone = d.totalLines > 0 && d.custodianConfirmedLines >= d.totalLines;
          const isLocked = d.status === 'locked';
          const done = isLocked ? 2 : custDone ? 1 : 0;
          const canApprove =
            !isLocked && (d.custodianName === employee.name || d.inspectorName === employee.name);
          return {
            kind: 'submission_card' as const,
            id: `sc_inv_${d.batchId}`,
            formType: 'inventory_handover',
            formId: d.batchId,
            formKey: 'inventory_handover',
            formNumber: d.formNumber,
            formName: '財產清點單',
            mode: canApprove ? ('approve' as const) : ('mine' as const),
            status: isLocked ? 'approved' : 'pending_approval',
            summary: `保管人：${d.custodianName} · 清點人：${d.inspectorName} · 已雙方確認 ${d.bothConfirmedLines}/${d.totalLines} 筆`,
            lines: [
              { label: '申請人', value: d.custodianName },
              {
                label: '摘要',
                value: `清點人：${d.inspectorName} · 已雙方確認 ${d.bothConfirmedLines}/${d.totalLines} 筆`,
              },
            ],
            applicantName: d.custodianName,
            canApprove,
            href: d.href,
            progress: {
              done,
              total: 2,
              remaining: 2 - done,
              percent: Math.round((done / 2) * 100),
              currentLabel: isLocked ? undefined : custDone ? '清點人複核封存' : '保管人清點確認',
              waitingNames: isLocked ? undefined : [custDone ? d.inspectorName : d.custodianName],
              steps: [
                {
                  key: '1',
                  label: '保管人清點確認',
                  name: d.custodianName,
                  state: custDone ? ('done' as const) : ('current' as const),
                },
                {
                  key: '2',
                  label: '清點人複核封存',
                  name: d.inspectorName,
                  state: isLocked
                    ? ('done' as const)
                    : custDone
                      ? ('current' as const)
                      : ('waiting' as const),
                },
              ],
            },
          };
        });
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: filtered.length,
            forms: details,
            message:
              filtered.length === 0
                ? '目前沒有符合條件的財產清點／點交系統表單。'
                : `共找到 ${filtered.length} 張財產清點單。畫面已顯示單據大綱卡（含清點進度、詳情與快速簽核／確認按鈕），回覆請簡潔，勿重複抄寫卡片內容。`,
          },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'dispatch_inventory_handover_form': {
        const custQuery = requireString(args, 'custodian', { min: 1, max: 80 });
        if (!custQuery.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: custQuery.error, message: '請指定要發送清點單的財產擁有者（保管人姓名或工號）。' },
          };
        }
        const rawCust = custQuery.value.replace(/^[@＠]+/, '').trim();
        const { employees: empTable } = await import('@/lib/db/schema');
        const allEmps = await getDb()
          .select({ id: empTable.id, code: empTable.employeeCode, name: empTable.name })
          .from(empTable)
          .where(eq(empTable.accessEnabled, true));
        const matchedEmp = allEmps.find(
          (e) =>
            e.id.toLowerCase() === rawCust.toLowerCase() ||
            e.code.toLowerCase() === rawCust.toLowerCase() ||
            e.name === rawCust ||
            e.name.includes(rawCust)
        );
        if (!matchedEmp) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'custodian_not_found', message: `找不到保管人「${rawCust}」。` },
          };
        }
        const todayStr = new Date().toISOString().slice(0, 10);
        const scheduledAt =
          typeof args?.scheduled_at === 'string' && args.scheduled_at.trim()
            ? args.scheduled_at.trim()
            : `${todayStr}T14:00`;
        const meetingLocation =
          typeof args?.meeting_location === 'string' ? args.meeting_location.trim() : '';
        const instructions =
          typeof args?.instructions === 'string' ? args.instructions.trim() : '';

        const { createInventoryHandoverForms } = await import('@/lib/assets/inventory-forms');
        const created = await createInventoryHandoverForms(
          { id: employee.id, role: employee.role },
          {
            custodianEmployeeIds: [matchedEmp.id],
            scheduledAt,
            meetingLocation,
            instructions,
          }
        );
        if (!created.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: created.code, message: created.error },
          };
        }
        const first = created.createdForms[0];
        const blocks: AiMessageBlock[] = created.createdForms.map((f) => ({
          kind: 'submission_card' as const,
          id: `sc_inv_created_${f.batchId}`,
          formType: 'inventory_handover',
          formId: f.batchId,
          formKey: 'inventory_handover',
          formNumber: f.formNumber,
          formName: '財產清點單',
          mode: 'approve' as const,
          status: 'pending_approval',
          summary: `保管人：${f.custodianName}（共 ${f.rowCount} 筆財產 · 點交時間 ${scheduledAt.replace('T', ' ')}）`,
          lines: [
            { label: '申請人', value: f.custodianName },
            { label: '摘要', value: `共 ${f.rowCount} 筆財產 · 點交時間 ${scheduledAt.replace('T', ' ')}` },
          ],
          applicantName: f.custodianName,
          canApprove: true,
          href: `/assets/inventory-forms/${f.batchId}`,
          progress: {
            done: 0,
            total: 2,
            remaining: 2,
            percent: 0,
            currentLabel: '保管人清點確認',
            waitingNames: [f.custodianName],
            steps: [
              {
                key: '1',
                label: '保管人清點確認',
                name: f.custodianName,
                state: 'current' as const,
              },
              {
                key: '2',
                label: '清點人複核封存',
                name: employee.name,
                state: 'waiting' as const,
              },
            ],
          },
        }));
        return {
          ok: true,
          name: tool,
          label,
          response: {
            createdForms: created.createdForms.map((f) => ({
              ...f,
              href: `/assets/inventory-forms/${f.batchId}`,
            })),
            message: first
              ? `已成功發送財產清點單「${first.formNumber}」給 ${first.custodianName}（共 ${first.rowCount} 筆財產）。畫面已附上單據卡（可按「詳情」在右側面板檢視）。`
              : '已建立財產清點單。',
          },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'confirm_inventory_handover_items': {
        const {
          listInventoryHandoverForms,
          getInventoryHandoverFormDetail,
          updateAndConfirmHandoverLines,
          completeInventoryHandoverForm,
        } = await import('@/lib/assets/inventory-forms');
        const actor = { id: employee.id, role: employee.role };
        let batchId =
          typeof args?.batch_id === 'string' && UUID_RE.test(args.batch_id.trim())
            ? args.batch_id.trim()
            : '';
        const formNumberArg =
          typeof args?.form_number === 'string' ? args.form_number.trim() : '';

        if (!batchId) {
          const allForms = await listInventoryHandoverForms(actor);
          const openForms = allForms.filter((f) => f.status === 'open');
          const found = formNumberArg
            ? allForms.find((f) => f.formNumber.toLowerCase() === formNumberArg.toLowerCase())
            : openForms[0] ?? allForms[0];
          if (!found) {
            return {
              ok: false,
              name: tool,
              label,
              response: { error: 'form_not_found', message: '找不到進行中的財產清點／點交系統表單。' },
            };
          }
          batchId = found.id;
        }

        const detail = await getInventoryHandoverFormDetail(actor, batchId);
        if (!detail) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden', message: '找不到該張財產清點單或無權限操作。' },
          };
        }

        const assetTagFilter =
          typeof args?.asset_tag === 'string' ? args.asset_tag.trim().toLowerCase() : '';
        const targetLines = assetTagFilter
          ? detail.lines.filter(
              (l) =>
                l.assetTag.toLowerCase() === assetTagFilter ||
                l.state.assetName.toLowerCase().includes(assetTagFilter)
            )
          : detail.lines;

        if (targetLines.length === 0) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'lines_not_found', message: `在此清點單中找不到財產「${assetTagFilter}」。` },
          };
        }

        const partyArg = args?.party;
        const party: 'custodian' | 'inspector' =
          partyArg === 'custodian' || partyArg === 'inspector'
            ? partyArg
            : detail.custodianEmployeeId === employee.id
              ? 'custodian'
              : 'inspector';

        const locationAction =
          args?.location_action === 'change_needed' ? 'change_needed' : 'agree_current';
        const confirmedLocation =
          typeof args?.confirmed_location === 'string' ? args.confirmed_location.trim() : undefined;
        const existenceFact =
          args?.existence_fact === 'exists_damaged' || args?.existence_fact === 'missing'
            ? args.existence_fact
            : 'exists';
        const note = typeof args?.note === 'string' ? args.note.trim() : undefined;

        const updated = await updateAndConfirmHandoverLines(actor, {
          batchId: detail.id,
          lineIds: targetLines.map((l) => l.id),
          party,
          confirm: true,
          locationAction,
          confirmedLocation,
          existenceFact,
          ...(party === 'custodian' && note !== undefined ? { custodianNote: note } : {}),
          ...(party === 'inspector' && note !== undefined ? { inspectorNote: note } : {}),
        });

        if (!updated.ok) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: updated.code, message: updated.error },
          };
        }

        let completedResult: { ok: boolean; message?: string; updatedAssetCount?: number } | null = null;
        if (args?.complete_if_ready === true) {
          const closed = await completeInventoryHandoverForm(actor, detail.id);
          if (closed.ok) {
            completedResult = {
              ok: true,
              updatedAssetCount: closed.updatedAssetCount,
              message: `且雙方每一條皆已確認完畢，已正式結束結案並同步更新 ${closed.updatedAssetCount} 筆財產清冊！`,
            };
          } else {
            completedResult = {
              ok: false,
              message: `（尚未結案：${closed.error}）`,
            };
          }
        }

        const refreshed = await getInventoryHandoverFormDetail(actor, detail.id);
        const confirmMsg = `已完成「${detail.formNumber}」之${party === 'custodian' ? '財產擁有者' : '清點人'}確認（共 ${updated.updatedCount} 條明細，位置：${locationAction === 'change_needed' ? `更改為 ${confirmedLocation}` : '同意現在位置'}，存在事實：${existenceFact}）。${completedResult?.message ?? ''}`;
        const refLines = refreshed?.lines ?? detail.lines;
        const custDone = refLines.length > 0 && refLines.every((l) => l.state.custodianConfirmed);
        const isLocked = (refreshed?.status ?? detail.status) === 'locked';
        const done = isLocked ? 2 : custDone ? 1 : 0;
        return {
          ok: true,
          name: tool,
          label,
          response: {
            batchId: detail.id,
            formNumber: detail.formNumber,
            party,
            confirmedLineCount: updated.updatedCount,
            confirmedAt: updated.confirmedAt,
            allLinesConfirmedByBoth: refreshed?.allLinesConfirmedByBoth ?? false,
            status: refreshed?.status ?? detail.status,
            completedResult,
            href: `/assets/inventory-forms/${detail.id}`,
            message: confirmMsg,
          },
          blocks: [
            {
              kind: 'submission_card' as const,
              id: `sc_inv_confirmed_${detail.id}`,
              formType: 'inventory_handover',
              formId: detail.id,
              formKey: 'inventory_handover',
              formNumber: detail.formNumber,
              formName: '財產清點單',
              mode: 'mine' as const,
              status: isLocked ? 'approved' : 'pending_approval',
              summary: confirmMsg,
              lines: [
                { label: '申請人', value: detail.custodianName },
                { label: '摘要', value: confirmMsg },
              ],
              applicantName: detail.custodianName,
              canApprove: !isLocked,
              href: `/assets/inventory-forms/${detail.id}`,
              progress: {
                done,
                total: 2,
                remaining: 2 - done,
                percent: Math.round((done / 2) * 100),
                currentLabel: isLocked ? undefined : custDone ? '清點人複核封存' : '保管人清點確認',
                waitingNames: isLocked ? undefined : [custDone ? detail.inspectorName : detail.custodianName],
                steps: [
                  {
                    key: '1',
                    label: '保管人清點確認',
                    name: detail.custodianName,
                    state: custDone ? ('done' as const) : ('current' as const),
                  },
                  {
                    key: '2',
                    label: '清點人複核封存',
                    name: detail.inspectorName,
                    state: isLocked
                      ? ('done' as const)
                      : custDone
                        ? ('current' as const)
                        : ('waiting' as const),
                  },
                ],
              },
            },
          ],
        };
      }

      case 'get_my_pending_tasks_overview': {
        const { getMyTaskCounts } = await import('@/lib/approvals/pending-count');
        const { listInventoryHandoverForms } = await import('@/lib/assets/inventory-forms');
        const { BUDGET_REQUEST_KEY } = await import('@/lib/custom-forms/migrated/budget');
        const { formDrafts: draftTable } = await import('@/lib/db/schema');
        const { createApplicationDraft } = await import('./drafts');
        const { and, desc } = await import('drizzle-orm');

        const [counts, inbox, openInvForms, budgetDraftRows] = await Promise.all([
          getMyTaskCounts(),
          loadAssistantInbox(15).catch(() => null),
          listInventoryHandoverForms({ id: employee.id, role: employee.role }).catch(() => []),
          getDb()
            .select()
            .from(draftTable)
            .where(
              and(
                eq(draftTable.ownerEmployeeId, employee.id),
                eq(draftTable.formKey, BUDGET_REQUEST_KEY)
              )
            )
            .orderBy(desc(draftTable.updatedAt))
            .limit(3)
            .catch(() => []),
        ]);
        const items = [
          {
            key: 'approvalsAndReturned',
            title: '簽核與單據追蹤',
            href: '/applications',
            count: counts.approvalsAndReturned,
            description: '待我簽核單據與被退回需補件單據',
          },
          ...(featureFlags.budget_management_platform
            ? [
                {
                  key: 'budgetTasks',
                  title: '年度預算表填報',
                  href: '/my-tasks/budget',
                  count: counts.budgetTasks,
                  description:
                    '財會人員派發給本人帳號之待填年度預算編列單（含即時自動儲存草稿與歷年紀錄）',
                },
              ]
            : []),
          ...(featureFlags.asset_management_module
            ? [
                {
                  key: 'assetHandovers',
                  title: '我的資產管理',
                  href: '/assets/mine',
                  count: counts.assetHandovers,
                  description:
                    '保管人收到待逐筆點選確認／修改之【財產清點單】與複選資產轉移',
                },
              ]
            : []),
          ...(featureFlags.company_info_hub
            ? [
                {
                  key: 'pendingSurveys',
                  title: '我的專屬問卷',
                  href: '/surveys',
                  count: counts.pendingSurveys,
                  description: '待填寫之公司開放問卷',
                },
              ]
            : []),
        ];

        const approvalCards =
          inbox && !inbox.loadError && inbox.pendingApprovals.length > 0
            ? cardsFromPendingApprovals(inbox.pendingApprovals.slice(0, 10))
            : [];

        const returnedItems =
          inbox && !inbox.loadError
            ? inbox.myInProgress.filter((item) => item.status === 'returned')
            : [];
        const returnedCards =
          returnedItems.length > 0
            ? cardsFromMySubmissions(
                returnedItems.slice(0, 5).map((r) => ({
                  formType: r.formType,
                  formId: r.id,
                  formKey: r.formKey ?? r.formType,
                  formName: r.label,
                  formNumber: r.caseNumber,
                  status: 'returned',
                  summary: r.summary || r.label,
                  approvedAt: null,
                  version: 1,
                  href: r.href,
                  totalAmount: r.totalAmount,
                  currentNodeLabel: r.currentNodeLabel ?? null,
                  pendingApproverNames: [],
                  snapshot: r.snapshot,
                }))
              )
            : [];

        const budgetDraftCards: AiMessageBlock[] = [];
        if (ctx && budgetDraftRows.length > 0) {
          for (const d of budgetDraftRows.slice(0, 2)) {
            const synced = await createApplicationDraft({
              conversationId: ctx.conversationId,
              ownerEmployeeId: employee.id,
              formDefinitionKey: BUDGET_REQUEST_KEY,
              data: (d.data ?? {}) as Record<string, unknown>,
              title: d.title || '116 年度預算表草稿',
              createIdempotencyKey: `budget_draft_open_${d.id}`,
            }).catch(() => null);
            if (synced) {
              budgetDraftCards.push({
                kind: 'draft_reference',
                id: `draft_${synced.draft.id}`,
                draftId: synced.draft.id,
                formKey: BUDGET_REQUEST_KEY,
                formName: synced.draft.title || '預算申請單',
                version: synced.draft.version,
                status: 'draft',
              });
            }
          }
        }

        const invCards: AiMessageBlock[] = openInvForms
          .filter((s) => s.status === 'open')
          .slice(0, 5)
          .map((d) => {
            const custDone = d.totalLines > 0 && d.custodianConfirmedLines >= d.totalLines;
            const done = custDone ? 1 : 0;
            const canApprove =
              d.custodianName === employee.name || d.inspectorName === employee.name;
            return {
              kind: 'submission_card' as const,
              id: `sc_inv_todo_${d.id}`,
              formType: 'inventory_handover',
              formId: d.id,
              formKey: 'inventory_handover',
              formNumber: d.formNumber,
              formName: '財產清點單',
              mode: canApprove ? ('approve' as const) : ('mine' as const),
              status: 'pending_approval',
              summary: `保管人：${d.custodianName} · 清點人：${d.inspectorName} · 已雙方確認 ${d.bothConfirmedLines}/${d.totalLines} 筆`,
              lines: [
                { label: '申請人', value: d.custodianName },
                {
                  label: '摘要',
                  value: `清點人：${d.inspectorName} · 已雙方確認 ${d.bothConfirmedLines}/${d.totalLines} 筆`,
                },
              ],
              applicantName: d.custodianName,
              canApprove,
              href: `/assets/inventory-forms/${d.id}`,
              progress: {
                done,
                total: 2,
                remaining: 2 - done,
                percent: Math.round((done / 2) * 100),
                currentLabel: custDone ? '清點人複核封存' : '保管人清點確認',
                waitingNames: [custDone ? d.inspectorName : d.custodianName],
                steps: [
                  {
                    key: '1',
                    label: '保管人清點確認',
                    name: d.custodianName,
                    state: custDone ? ('done' as const) : ('current' as const),
                  },
                  {
                    key: '2',
                    label: '清點人複核封存',
                    name: d.inspectorName,
                    state: custDone ? ('current' as const) : ('waiting' as const),
                  },
                ],
              },
            };
          });

        const blocks: AiMessageBlock[] = [
          ...approvalCards,
          ...returnedCards,
          ...budgetDraftCards,
          ...invCards,
        ];
        return {
          ok: true,
          name: tool,
          label,
          response: {
            totalPendingTasks: counts.total,
            items,
            pendingApprovals:
              inbox && !inbox.loadError
                ? inbox.pendingApprovals.slice(0, 10).map((i) => ({
                    formType: i.formType,
                    label: i.label,
                    id: i.id,
                    caseNumber: i.caseNumber,
                    applicantName: i.applicantName,
                    summary: i.summary,
                    totalAmount: i.totalAmount,
                    href: i.href,
                    formKey: i.formKey,
                  }))
                : [],
            message: `「我的待辦」目前共有 ${counts.total} 項待處理事項：簽核與單據追蹤 ${counts.approvalsAndReturned} 項、年度預算表填報 ${counts.budgetTasks} 項、我的資產管理（財產清點單）${counts.assetHandovers} 項、我的專屬問卷 ${counts.pendingSurveys} 項。畫面已顯示各單據與草稿卡片（點「詳情」即可在右側面板查看或編輯，自己待簽核的單據可直接點「✓ 快速簽核」），回覆請簡潔指引，勿重複抄寫卡片內容。`,
          },
          ...(blocks.length ? { blocks } : {}),
        };
      }

      case 'list_my_budget_tasks_and_history': {
        const { and, desc } = await import('drizzle-orm');
        const {
          departments: deptTable,
          formDefinitions: defTable,
          formDrafts: draftTable,
          notifications: notifTable,
          procurementCases: pcTable,
          projects: projTable,
        } = await import('@/lib/db/schema');
        const { ensureEmployeeBudgetTasksAndHistory } = await import(
          '@/lib/budget-codes/seed-budget-demo'
        );
        const { BUDGET_REQUEST_KEY } = await import('@/lib/custom-forms/migrated/budget');
        const { createApplicationDraft } = await import('./drafts');

        await ensureEmployeeBudgetTasksAndHistory(employee);

        const db = getDb();
        const filterYear =
          typeof args?.fiscal_year === 'string' && args.fiscal_year.trim()
            ? args.fiscal_year.trim()
            : '';
        const shouldOpenDraft = args?.open_draft === true;

        const [notices, drafts, depts, projs, budgetDefs] = await Promise.all([
          db
            .select()
            .from(notifTable)
            .where(
              and(
                eq(notifTable.recipientEmployeeId, employee.id),
                eq(notifTable.formType, 'budget_dispatch')
              )
            )
            .orderBy(desc(notifTable.createdAt))
            .limit(20),
          db
            .select()
            .from(draftTable)
            .where(
              and(
                eq(draftTable.ownerEmployeeId, employee.id),
                eq(draftTable.formKey, BUDGET_REQUEST_KEY)
              )
            )
            .orderBy(desc(draftTable.updatedAt)),
          db.select().from(deptTable),
          db.select().from(projTable),
          db
            .select({ id: defTable.id })
            .from(defTable)
            .where(eq(defTable.key, BUDGET_REQUEST_KEY))
            .limit(1),
        ]);

        const deptMap = new Map(depts.map((d) => [d.id, `${d.code}｜${d.name}`]));
        const projMap = new Map(projs.map((p) => [p.id, `${p.code}｜${p.name}`]));

        const budgetDefId = budgetDefs[0]?.id;
        const submissions = budgetDefId
          ? await db
              .select({
                id: formSubmissions.id,
                formNumber: formSubmissions.formNumber,
                status: formSubmissions.status,
                data: formSubmissions.data,
                totalAmount: formSubmissions.totalAmount,
                submittedAt: formSubmissions.submittedAt,
                caseNumber: pcTable.caseNumber,
              })
              .from(formSubmissions)
              .innerJoin(pcTable, eq(pcTable.id, formSubmissions.procurementCaseId))
              .where(
                and(
                  eq(formSubmissions.definitionId, budgetDefId),
                  eq(formSubmissions.applicantEmployeeId, employee.id)
                )
              )
              .orderBy(desc(formSubmissions.submittedAt))
          : [];

        const parseMoney = (v: unknown): number => {
          if (typeof v === 'number' && Number.isFinite(v)) return v;
          if (typeof v === 'string') {
            const n = Number(v.replace(/,/g, '').trim());
            return Number.isFinite(n) ? n : 0;
          }
          return 0;
        };

        const historicalRecords = submissions
          .map((sub) => {
            const data = (sub.data ?? {}) as Record<string, unknown>;
            const fy = String(data.fiscalYear ?? '115').trim();
            const scope = data.budgetScope === 'project' ? '專案年度預算表' : '部門年度預算表';
            const unitLabel =
              data.budgetScope === 'project'
                ? projMap.get(String(data.targetProjectId ?? '')) ?? '專案預算'
                : deptMap.get(String(data.targetDepartmentId ?? '')) ?? '部門預算';
            const itemsObj = (data.items ?? {}) as { rows?: Record<string, unknown>[] };
            const rows = Array.isArray(itemsObj.rows) ? itemsObj.rows : [];
            const lines = rows.map((r) => {
              const prevApp = parseMoney(r.prevApprovedBudget);
              const prevAct = parseMoney(r.prevActualAmount);
              const annual = parseMoney(r.annualBudgetAmount);
              return {
                code: String(r.code ?? ''),
                category: String(r.category ?? ''),
                accountNumber: String(r.accountNumber ?? ''),
                prevApprovedBudget: prevApp,
                prevActualAmount: prevAct,
                annualBudgetAmount: annual,
                diffVsPrevApproved: annual - prevApp,
                description: String(r.description ?? ''),
              };
            });
            const totalPrevApproved = lines.reduce((s, l) => s + l.prevApprovedBudget, 0);
            const totalPrevActual = lines.reduce((s, l) => s + l.prevActualAmount, 0);
            const totalAnnualBudget =
              lines.reduce((s, l) => s + l.annualBudgetAmount, 0) || parseMoney(sub.totalAmount);

            return {
              id: sub.id,
              formNumber: sub.formNumber,
              fiscalYear: fy,
              scope,
              unitLabel,
              status: sub.status,
              reason: String(data.reason ?? ''),
              totalPrevApproved,
              totalPrevActual,
              totalAnnualBudget,
              diffAmount: totalAnnualBudget - totalPrevApproved,
              lineCount: lines.length,
              lines,
              href: `/f/${BUDGET_REQUEST_KEY}/${sub.id}`,
            };
          })
          .filter((r) => !filterYear || r.fiscalYear === filterYear)
          .sort((a, b) => Number(b.fiscalYear) - Number(a.fiscalYear));

        const dispatchedTasks = notices.map((n) => {
          const fyMatch = n.caseNumber.match(/BUDGET-(\d+)/);
          const fy = fyMatch ? fyMatch[1]! : '116';
          const isProj = n.caseNumber.includes('PROJ') || n.message.includes('專案預算');
          return {
            caseNumber: n.caseNumber,
            fiscalYear: fy,
            scope: isProj ? '專案年度預算表' : '部門年度預算表',
            message: n.message,
            isRead: n.isRead,
            dispatchedAt: n.createdAt,
          };
        });

        const openResources: OpenResourceEvent[] = [];
        const blocks: AiMessageBlock[] = [];

        // 1. Budget drafts (synced to ai_application_drafts so clicking「詳情」opens in right-side DraftPanel and AI can edit/write directly)
        const autoSavedDrafts: Array<{
          draftId: string;
          formDraftId: string;
          title: string;
          fiscalYear: string;
          scope: string;
          rowCount: number;
          totalAmount: number;
          updatedAt: Date;
        }> = [];

        for (let idx = 0; idx < drafts.length; idx++) {
          const d = drafts[idx]!;
          const dData = (d.data ?? {}) as Record<string, unknown>;
          const itemsObj = (dData.items ?? {}) as { rows?: Record<string, unknown>[]; total?: number };
          const rows = Array.isArray(itemsObj.rows) ? itemsObj.rows : [];
          let aiDraftId = d.id;
          let aiDraftVersion = 1;
          let aiDraftTitle = d.title || '116 年度預算表草稿';

          if (ctx) {
            const opened = await createApplicationDraft({
              conversationId: ctx.conversationId,
              ownerEmployeeId: employee.id,
              formDefinitionKey: BUDGET_REQUEST_KEY,
              data: dData,
              title: aiDraftTitle,
              createIdempotencyKey: `budget_draft_open_${d.id}`,
            }).catch(() => null);
            if (opened) {
              aiDraftId = opened.draft.id;
              aiDraftVersion = opened.draft.version;
              aiDraftTitle = opened.draft.title || aiDraftTitle;
              blocks.push({
                kind: 'draft_reference',
                id: `draft_${opened.draft.id}`,
                draftId: opened.draft.id,
                formKey: BUDGET_REQUEST_KEY,
                formName: aiDraftTitle,
                version: aiDraftVersion,
                status: 'draft',
              });
              if (shouldOpenDraft && idx === 0) {
                openResources.push(
                  draftOpenResource({
                    draftId: opened.draft.id,
                    title: aiDraftTitle,
                    version: aiDraftVersion,
                    operation: 'opened',
                    formKey: BUDGET_REQUEST_KEY,
                    status: opened.draft.status,
                  })
                );
              }
            }
          }

          autoSavedDrafts.push({
            draftId: aiDraftId,
            formDraftId: d.id,
            title: aiDraftTitle,
            fiscalYear: String(dData.fiscalYear ?? '116'),
            scope: dData.budgetScope === 'project' ? '專案年度預算表' : '部門年度預算表',
            rowCount: rows.length,
            totalAmount: parseMoney(itemsObj.total),
            updatedAt: d.updatedAt,
          });
        }

        // 2. Submitted / historical budget applications as submission_card (with approval progress stepper, quick approve if approver, and「詳情」opening right-side SubmissionPanel)
        const historyToRender = historicalRecords.slice(0, 6);
        const historyCardRows = await Promise.all(
          historyToRender.map(async (r) => {
            const snap = await getFormApprovalSnapshot('custom', r.id);
            return {
              formType: 'custom' as const,
              formId: r.id,
              formKey: BUDGET_REQUEST_KEY,
              formName: `${r.fiscalYear} 年度${r.scope}`,
              formNumber: r.formNumber,
              status: r.status,
              summary: `${r.unitLabel} · 共 ${r.lineCount} 項預算科目`,
              approvedAt: null,
              version: snap?.version ?? 1,
              href: r.href,
              totalAmount: r.totalAnnualBudget,
              currentNodeLabel: snap?.currentNodeLabel ?? null,
              pendingApproverNames: snap?.pendingApproverNames ?? [],
              snapshot: snap,
              canApprove: Boolean(snap?.pendingApproverIds.includes(employee.id)),
            };
          })
        );
        if (historyCardRows.length > 0) {
          blocks.push(...cardsFromMySubmissions(historyCardRows));
        }

        return {
          ok: true,
          name: tool,
          label,
          response: {
            designNote:
              '畫面下方已直接顯示預算草稿卡片與單據卡片（每張卡片皆有「詳情」按鈕可在右側面板開啟檢視或編輯）。請勿在回覆文字中附加任何網址或 Markdown 連結，也請勿呼叫 present_choices 重複列出相同的草稿選項；僅需給出簡潔基本的說明，並提醒使用者可點卡片上的「詳情」在右側面板查看或編輯，或直接告訴你要如何撰寫／修改哪一欄資料。',
            dispatchedTaskCount: dispatchedTasks.length,
            dispatchedTasks,
            autoSavedDraftCount: autoSavedDrafts.length,
            autoSavedDrafts,
            historicalRecordCount: historicalRecords.length,
            historicalRecords: historicalRecords.map(({ href: _href, ...rest }) => rest),
          },
          ...(blocks.length > 0 ? { blocks } : {}),
          ...(openResources.length > 0 ? { openResources } : {}),
        };
      }

      case 'dispatch_budget_compilation_notice': {
        const { employees: empTable, notifications: notifTable } = await import('@/lib/db/schema');
        const fy =
          typeof args?.fiscal_year === 'string' && args.fiscal_year.trim()
            ? args.fiscal_year.trim()
            : '116';
        const deadline =
          typeof args?.deadline_date === 'string' && args.deadline_date.trim()
            ? args.deadline_date.trim()
            : '2026-12-15';
        const scopeArg =
          typeof args?.scope === 'string' && ['department', 'project', 'both'].includes(args.scope)
            ? (args.scope as 'department' | 'project' | 'both')
            : 'both';
        const rawRecipient =
          typeof args?.recipient === 'string' && args.recipient.trim()
            ? args.recipient.replace(/^[@＠]+/, '').trim()
            : 'self';

        const db = getDb();
        let targetEmp = {
          id: employee.id,
          code: employee.employeeCode,
          name: employee.name,
        };

        if (rawRecipient.toLowerCase() !== 'self' && rawRecipient !== '我' && rawRecipient !== '自己') {
          const allEmps = await db
            .select({ id: empTable.id, code: empTable.employeeCode, name: empTable.name })
            .from(empTable)
            .where(eq(empTable.accessEnabled, true));
          const found = allEmps.find(
            (e) =>
              e.id.toLowerCase() === rawRecipient.toLowerCase() ||
              e.code.toLowerCase() === rawRecipient.toLowerCase() ||
              e.name === rawRecipient ||
              e.name.includes(rawRecipient)
          );
          if (!found) {
            return {
              ok: false,
              name: tool,
              label,
              response: {
                error: 'recipient_not_found',
                message: `找不到員工「${rawRecipient}」。`,
              },
            };
          }
          targetEmp = found;
        }

        const noteSuffix =
          typeof args?.custom_note === 'string' && args.custom_note.trim()
            ? `｜財會備註：${args.custom_note.trim()}`
            : '';

        const scopesToSend: Array<'department' | 'project'> =
          scopeArg === 'both' ? ['department', 'project'] : [scopeArg];

        const createdCases: string[] = [];
        for (const sc of scopesToSend) {
          const caseNumber = sc === 'project' ? `BUDGET-${fy}-PROJ` : `BUDGET-${fy}-DEPT`;
          const labelText =
            sc === 'project'
              ? `${fy} 年度營收／產品專案預算表暨差異分析表`
              : `${fy} 年度部門預算表暨差異分析表`;
          const msg = `【${labelText}】由財會／管理員 ${employee.name} 派發予 ${targetEmp.name}：請於 ${deadline} 前至「我的待辦 → 年度預算表填報（/my-tasks/budget）」完成線上填寫（支援 1～12 月分月試算與即時自動儲存）${noteSuffix}。`;

          await db.insert(notifTable).values({
            recipientEmployeeId: targetEmp.id,
            type: 'approval_requested',
            formType: 'budget_dispatch',
            formId: employee.id,
            caseNumber,
            message: msg,
            isRead: false,
          });
          createdCases.push(`${caseNumber}（${labelText}）`);
        }

        const dispatchMsg = `已成功派發 ${createdCases.length} 張預算編列填寫單（${createdCases.join('、')}）給 ${targetEmp.name}（${targetEmp.code}），截止日 ${deadline}。`;
        return {
          ok: true,
          name: tool,
          label,
          response: {
            recipientName: targetEmp.name,
            recipientCode: targetEmp.code,
            fiscalYear: fy,
            deadlineDate: deadline,
            dispatchedCases: createdCases,
            message: dispatchMsg,
          },
        };
      }

      case 'get_budget_analytics_summary': {
        const { departments: deptTable, projects: projTable } = await import('@/lib/db/schema');
        const db = getDb();
        const [allCodes, depts, projs] = await Promise.all([
          getBudgetCodeList({ includeInactive: true, includeUsage: true }),
          db.select({ id: deptTable.id, code: deptTable.code }).from(deptTable).where(eq(deptTable.active, true)),
          db.select({ id: projTable.id, code: projTable.code }).from(projTable),
        ]);

        const distinctYears = [...new Set(allCodes.map((b) => b.fiscalYear))].sort(
          (a, b) => Number(b) - Number(a)
        );
        const requestedYear =
          typeof args?.fiscal_year === 'string' && args.fiscal_year.trim()
            ? args.fiscal_year.trim()
            : '';
        const focusYear =
          requestedYear && distinctYears.includes(requestedYear)
            ? requestedYear
            : distinctYears[0] ?? '115';
        const prevYear = String(Number(focusYear) - 1);

        const activeYearCodes = allCodes.filter(
          (b) => b.fiscalYear === focusYear && b.active !== false
        );
        const prevActiveCodes = allCodes.filter(
          (b) => b.fiscalYear === prevYear && b.active !== false
        );

        const deptCodes = activeYearCodes.filter((b) => Boolean(b.departmentCode || b.departmentName));
        const projCodes = activeYearCodes.filter((b) => Boolean(b.projectCode || b.projectName));

        const deptBudgetSum = Math.round(
          deptCodes.reduce((s, b) => s + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0), 0)
        );
        const projBudgetSum = Math.round(
          projCodes.reduce((s, b) => s + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0), 0)
        );
        const totalYearBudget = deptBudgetSum + projBudgetSum;

        const prevTotalBudget = Math.round(
          prevActiveCodes.reduce(
            (s, b) => s + (b.annualBudgetAmount && b.annualBudgetAmount > 0 ? b.annualBudgetAmount : 0),
            0
          )
        );

        const yoyDiff = prevTotalBudget > 0 ? totalYearBudget - prevTotalBudget : null;
        const yoyGrowthPct =
          prevTotalBudget > 0
            ? Number((((totalYearBudget - prevTotalBudget) / prevTotalBudget) * 100).toFixed(1))
            : null;

        const coveredDeptCount = new Set(deptCodes.map((b) => b.departmentCode).filter(Boolean)).size;
        const coveredProjCount = new Set(projCodes.map((b) => b.projectCode).filter(Boolean)).size;

        const zeroAmountCount = activeYearCodes.filter(
          (b) => !b.annualBudgetAmount || b.annualBudgetAmount <= 0
        ).length;
        const unassignedOwnerCount = activeYearCodes.filter((b) => !b.ownerEmployeeCode).length;
        const utilizedCodeCount = activeYearCodes.filter((b) => (b.usageCount ?? 0) > 0).length;
        const totalUsageRefs = activeYearCodes.reduce((s, b) => s + (b.usageCount ?? 0), 0);

        const deptRatioPct =
          totalYearBudget > 0 ? Math.round((deptBudgetSum / totalYearBudget) * 100) : 0;
        const projRatioPct = totalYearBudget > 0 ? 100 - deptRatioPct : 0;

        return {
          ok: true,
          name: tool,
          label,
          response: {
            focusYear,
            prevYear,
            availableYears: distinctYears,
            card1_YearTotalAndYoY: {
              title: `${focusYear} 年度核定預算總額`,
              totalYearBudget,
              activeSubjectCount: activeYearCodes.length,
              prevYearTotalBudget: prevTotalBudget,
              yoyDiffAmount: yoyDiff,
              yoyGrowthPct,
            },
            card2_DepartmentBudgetAndCoverage: {
              title: `${focusYear} 年度部門營運預算`,
              deptBudgetSum,
              deptRatioPct,
              deptSubjectCount: deptCodes.length,
              coveredDeptCount,
              totalActiveDepartments: depts.length,
            },
            card3_ProjectBudgetAndCoverage: {
              title: `${focusYear} 年度專案預算規模`,
              projBudgetSum,
              projRatioPct,
              projSubjectCount: projCodes.length,
              coveredProjCount,
              totalProjects: projs.length,
            },
            card4_UtilizationAndGovernanceCheck: {
              title: `${focusYear} 年度動支與治理檢核`,
              utilizedCodeCount,
              totalLinkedFormReferences: totalUsageRefs,
              zeroAmountSubjectCount: zeroAmountCount,
              unassignedOwnerSubjectCount: unassignedOwnerCount,
            },
          },
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
