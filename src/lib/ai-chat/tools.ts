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
import { cardsFromMySubmissions, cardsFromPendingApprovals } from './submission-cards';
import { previewNudge } from './nudge';
import { listRecentProjectsForEmployee, searchProjectsPaged } from './projects';
import { startResubmission } from './resubmit';
import { searchMyCustomSubmissions } from './submissions-search';

async function approveOneForActor(
  employee: CurrentEmployee,
  formId: string,
  conversationId: string | null
): Promise<{ ok: boolean; message: string; formNumber?: string; error?: string }> {
  const detail = await getSubmissionDetail(formId);
  if (!detail) return { ok: false, error: 'not_found', message: '找不到單據或無權限閱讀。' };
  if (!detail.isCurrentApprover) {
    return { ok: false, error: 'not_current_approver', message: `您目前不是「${detail.formNumber}」的簽核人。` };
  }
  const result = await approveCustomFormStep(formId, detail.version);
  if (!result.ok) {
    return { ok: false, error: result.code, message: result.error, formNumber: detail.formNumber };
  }
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: 'ai.approve_submission',
    entityType: 'custom',
    entityId: formId,
    requestId: conversationId,
    details: {
      via: 'ai_assistant',
      formNumber: detail.formNumber,
      formName: detail.name,
      conversationId,
    },
  });
  return { ok: true, message: `已核准 ${detail.formNumber}（${detail.name}）。`, formNumber: detail.formNumber };
}

async function returnOneForActor(
  employee: CurrentEmployee,
  formId: string,
  reason: string,
  conversationId: string | null
): Promise<{ ok: boolean; message: string; formNumber?: string; error?: string }> {
  const detail = await getSubmissionDetail(formId);
  if (!detail) return { ok: false, error: 'not_found', message: '找不到單據或無權限閱讀。' };
  if (!detail.isCurrentApprover) {
    return { ok: false, error: 'not_current_approver', message: `您目前不是「${detail.formNumber}」的簽核人。` };
  }
  const result = await returnCustomFormStep(formId, reason, detail.version);
  if (!result.ok) {
    return { ok: false, error: result.code, message: result.error, formNumber: detail.formNumber };
  }
  await recordAudit(getDb(), {
    actorEmployeeId: employee.id,
    action: 'ai.return_submission',
    entityType: 'custom',
    entityId: formId,
    requestId: conversationId,
    details: {
      via: 'ai_assistant',
      formNumber: detail.formNumber,
      formName: detail.name,
      reason: reason.slice(0, 200),
      conversationId,
    },
  });
  return { ok: true, message: `已退回 ${detail.formNumber}（${detail.name}）。`, formNumber: detail.formNumber };
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

export function toolUiLabel(name: string): string {
  return TOOL_LABELS[name as AiChatToolName] ?? name;
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
        const custom = inbox.pendingApprovals.filter((i) => i.formType === 'custom' || Boolean(i.formKey));
        if (custom.length === 0) {
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
        for (const item of custom.slice(0, limit)) {
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
            hint: '回答時請明確引用規章名稱、文號與條文規定，並可引導使用者前往「公司資訊 > 公司規章」（/regulations）閱覽完整條文或直接協助建立對應表單草稿。',
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
            hint: '請針對上述真實公司公告（置頂、重要度、分類、未讀狀態與內容重點）進行條理化整理，並提供 /announcements 連結；切勿混入個人的單據簽核或退回通知。',
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
