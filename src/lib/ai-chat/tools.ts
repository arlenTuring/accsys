import { getCurrentEmployee, type CurrentEmployee } from '@/lib/auth/current-employee';
import { getMyApprovalQueueAll } from '@/lib/approvals/queue';
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
import {
  createApplicationDraft,
  describeDraftFields,
  getDraftForOwner,
  loadDraftFormContext,
  patchApplicationDraft,
} from './drafts';
import { attachApprovedSnapshotToDraft } from './attach-approved';
import { attachStagedFilesToDraft } from './attach-staged';
import { getOrCreateApprovedPdfSnapshot } from './approved-pdf';
import { draftOpenResource, type OpenResourceEvent } from './open-resource';
import { previewNudge } from './nudge';
import { listRecentProjectsForEmployee, searchProjectsPaged } from './projects';
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
  'create_application_draft',
  'describe_application_draft',
  'patch_application_draft',
  'propose_choices',
  'propose_project_picker',
  'propose_nudge',
  'search_my_submissions',
  'propose_approved_document_picker',
  'attach_approved_document_pdf',
  'attach_staged_files_to_draft',
] as const;

export type AiToolContext = {
  conversationId: string;
  ownerEmployeeId: string;
  /** User turn clientMessageId — used for create_application_draft idempotency. */
  turnId?: string | null;
  /** Ready staged attachment IDs from this user turn (for attach_staged_files_to_draft). */
  recentStagedIds?: string[];
};

export type AiChatToolName = (typeof AI_CHAT_ALLOWED_TOOLS)[number];

const ALLOWED = new Set<string>(AI_CHAT_ALLOWED_TOOLS);

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
    name: 'create_application_draft',
    description:
      '建立申請草稿（非正式送件）。使用者明確要建單或確認表單種類後呼叫；右側會開啟可編輯草稿。',
    parameters: {
      type: 'OBJECT',
      properties: {
        form_key: {
          type: 'STRING',
          description: '已發布可填表單 key，例如 travel-expense、department-expense',
        },
        initial_data_json: {
          type: 'STRING',
          description: '可選：已知欄位的 JSON 物件字串（勿填入未確認數字）',
        },
      },
      required: ['form_key'],
    },
  },
  {
    name: 'describe_application_draft',
    description:
      '讀取草稿目前版本、已填資料與可寫欄位 id／型別。更新草稿前必先呼叫，以取得 expected_version 與正確欄位 id。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING', description: '草稿 UUID' },
      },
      required: ['draft_id'],
    },
  },
  {
    name: 'patch_application_draft',
    description:
      '把已知欄位寫入右側草稿（權威狀態）。不可只在對話文字宣稱已更新；必須呼叫此工具。表格欄位值為 {rows:[...], total:null}。金額不清楚時不要填。',
    parameters: {
      type: 'OBJECT',
      properties: {
        draft_id: { type: 'STRING', description: '草稿 UUID' },
        expected_version: {
          type: 'NUMBER',
          description: 'describe_application_draft 回傳的 version；不符會衝突',
        },
        patch_json: {
          type: 'STRING',
          description: '要合併的欄位 JSON，例如 {"tripStartDate":"2026-10-27","reportItems":{"rows":[{...}],"total":null}}',
        },
      },
      required: ['draft_id', 'expected_version', 'patch_json'],
    },
  },
  {
    name: 'propose_choices',
    description: '在對話中顯示可點選的選項（表單種類、澄清問題等）。',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: '問題文字' },
        options_json: {
          type: 'STRING',
          description: 'JSON 陣列：[{id,label,value}]，最多 8 項',
        },
      },
      required: ['prompt', 'options_json'],
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
  create_application_draft: '建立草稿',
  describe_application_draft: '讀取草稿',
  patch_application_draft: '更新草稿',
  propose_choices: '選項',
  propose_project_picker: '專案選取',
  propose_nudge: '催簽確認',
  search_my_submissions: '查詢我的單據',
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
  const employee = await getCurrentEmployee();
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
        const page = await searchProjectsPaged({ query: q.value, limit: 25, offset: 0 });
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
        const items = await getMyApprovalQueueAll();
        return {
          ok: true,
          name: tool,
          label,
          response: {
            count: items.length,
            items: clip(
              items.map((i) => ({
                formType: i.formType,
                label: i.label,
                id: i.id,
                caseNumber: i.caseNumber,
                applicantName: i.applicantName,
                totalAmount: i.totalAmount,
                currency: i.currency ?? 'TWD',
                href: i.href,
              })),
              30
            ),
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

      case 'create_application_draft': {
        if (!ctx) {
          return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        }
        const formKey = requireString(args, 'form_key', { min: 2, max: 40 });
        if (!formKey.ok) return { ok: false, name: tool, label, response: { error: formKey.error } };
        let initial: Record<string, unknown> = {};
        const rawJson = args?.initial_data_json;
        if (typeof rawJson === 'string' && rawJson.trim()) {
          try {
            const parsed = JSON.parse(rawJson) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              initial = parsed as Record<string, unknown>;
            }
          } catch {
            return { ok: false, name: tool, label, response: { error: 'initial_data_json_invalid' } };
          }
        }
        try {
          // Prefer the latest open draft for this conversation+form so the model
          // does not open a blank second tab while the filled draft sits elsewhere.
          const { listConversationDrafts } = await import('./drafts');
          const sameForm = (await listConversationDrafts(ctx.conversationId, employee.id)).filter(
            (d) => d.status === 'draft' && d.formDefinitionKey === formKey.value
          );
          // Prefer a draft that already has field data over a freshly created blank one.
          const prior =
            sameForm.find((d) => Object.keys(d.data ?? {}).length > 0) ?? sameForm[0] ?? null;
          if (prior && Object.keys(initial).length === 0) {
            const ctxDraft = await loadDraftFormContext(prior.id, employee.id);
            const title = ctxDraft?.name ?? prior.title ?? formKey.value;
            const block: AiMessageBlock = {
              kind: 'draft_reference',
              id: `draft_${prior.id}`,
              draftId: prior.id,
              formKey: prior.formDefinitionKey,
              formName: title,
              version: prior.version,
              status: prior.status,
            };
            const open = draftOpenResource({
              draftId: prior.id,
              title,
              version: prior.version,
              operation: 'opened',
              formKey: prior.formDefinitionKey,
              status: prior.status,
            });
            return {
              ok: true,
              name: tool,
              label,
              response: {
                resourceType: 'application_draft',
                resourceId: prior.id,
                draftId: prior.id,
                title,
                formKey: prior.formDefinitionKey,
                version: prior.version,
                created: false,
                reusedExisting: true,
                fields: ctxDraft ? describeDraftFields(ctxDraft.schema) : [],
                data: prior.data,
                message:
                  '已重用本對話既有草稿（未新建空白稿）。請用 patch_application_draft 更新欄位；UI 會開啟此草稿。',
              },
              blocks: [block],
              openResources: [open],
            };
          }

          const idemKey = ctx.turnId ? `${ctx.turnId}:${formKey.value}` : null;
          const { draft, created } = await createApplicationDraft({
            conversationId: ctx.conversationId,
            ownerEmployeeId: employee.id,
            formDefinitionKey: formKey.value,
            data: initial,
            createIdempotencyKey: idemKey,
          });
          const ctxDraft = await loadDraftFormContext(draft.id, employee.id);
          const title = ctxDraft?.name ?? draft.title ?? formKey.value;
          const block: AiMessageBlock = {
            kind: 'draft_reference',
            id: `draft_${draft.id}`,
            draftId: draft.id,
            formKey: draft.formDefinitionKey,
            formName: title,
            version: draft.version,
            status: draft.status,
          };
          const open = draftOpenResource({
            draftId: draft.id,
            title,
            version: draft.version,
            operation: created ? 'created' : 'opened',
            formKey: draft.formDefinitionKey,
            status: draft.status,
          });
          return {
            ok: true,
            name: tool,
            label,
            response: {
              resourceType: 'application_draft',
              resourceId: draft.id,
              draftId: draft.id,
              title,
              formKey: draft.formDefinitionKey,
              version: draft.version,
              created,
              fields: ctxDraft ? describeDraftFields(ctxDraft.schema) : [],
              message: created
                ? '草稿已寫入資料庫。UI 會用 open_resource 開啟文件；請接著 patch 已知欄位，不要只靠文字宣稱右側已更新。'
                : '本草稿已存在（同一次請求重試），已回傳既有 draftId，未再建立新草稿。',
            },
            blocks: [block],
            openResources: [open],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'create_failed';
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: msg,
              message: msg === 'form_not_filable' ? '此表單不可填寫或不存在。' : '建立草稿失敗。',
            },
          };
        }
      }

      case 'describe_application_draft': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const draftId = requireUuid(args, 'draft_id');
        if (!draftId.ok) return { ok: false, name: tool, label, response: { error: draftId.error } };
        const draftCtx = await loadDraftFormContext(draftId.value, employee.id);
        if (!draftCtx || draftCtx.draft.conversationId !== ctx.conversationId) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden', message: '找不到本草稿或無權限。' },
          };
        }
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
            fields: describeDraftFields(draftCtx.schema),
            versionMismatch: draftCtx.versionMismatch,
          },
        };
      }

      case 'patch_application_draft': {
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
        const patchJson = requireString(args, 'patch_json', { min: 2, max: 20000 });
        if (!patchJson.ok) return { ok: false, name: tool, label, response: { error: patchJson.error } };
        let patch: Record<string, unknown>;
        try {
          const parsed = JSON.parse(patchJson.value) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, name: tool, label, response: { error: 'patch_json_invalid' } };
          }
          patch = parsed as Record<string, unknown>;
        } catch {
          return { ok: false, name: tool, label, response: { error: 'patch_json_invalid' } };
        }
        if (Object.keys(patch).length === 0) {
          return { ok: false, name: tool, label, response: { error: 'patch_empty' } };
        }

        const owned = await getDraftForOwner(draftId.value, employee.id);
        if (!owned || owned.conversationId !== ctx.conversationId) {
          return {
            ok: false,
            name: tool,
            label,
            response: { error: 'not_found_or_forbidden' },
          };
        }

        try {
          const result = await patchApplicationDraft({
            draftId: draftId.value,
            ownerEmployeeId: employee.id,
            expectedVersion,
            patch,
          });
          if (!result.ok) {
            return {
              ok: false,
              name: tool,
              label,
              response: {
                error: 'version_conflict',
                message: '草稿版本衝突：使用者可能剛手動改過。請重新 describe 後再 patch。',
                version: result.conflict.draft.version,
                data: result.conflict.draft.data,
              },
            };
          }
          const formName = result.draft.title || result.draft.formDefinitionKey;
          // Stable id per draftId — sanitizeBlocks also dedupes by draftId+latest version.
          const block: AiMessageBlock = {
            kind: 'draft_reference',
            id: `draft_${result.draft.id}`,
            draftId: result.draft.id,
            formKey: result.draft.formDefinitionKey,
            formName,
            version: result.draft.version,
            status: result.draft.status,
          };
          const open = draftOpenResource({
            draftId: result.draft.id,
            title: formName,
            version: result.draft.version,
            operation: 'updated',
            formKey: result.draft.formDefinitionKey,
            status: result.draft.status,
          });
          return {
            ok: true,
            name: tool,
            label,
            response: {
              resourceType: 'application_draft',
              resourceId: result.draft.id,
              draftId: result.draft.id,
              title: formName,
              version: result.draft.version,
              patchedKeys: Object.keys(patch),
              data: result.draft.data,
              message: '草稿欄位已寫入。UI 會以 open_resource 重新整理該文件頁籤。',
            },
            blocks: [block],
            openResources: [open],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'patch_failed';
          return {
            ok: false,
            name: tool,
            label,
            response: {
              error: msg.startsWith('unknown_field:') ? 'unknown_field' : msg,
              message: msg.startsWith('unknown_field:')
                ? `欄位不存在：${msg.slice('unknown_field:'.length)}。請先 describe_application_draft。`
                : '更新草稿失敗。',
            },
          };
        }
      }

      case 'propose_choices': {
        if (!ctx) return { ok: false, name: tool, label, response: { error: 'missing_context' } };
        const prompt = requireString(args, 'prompt', { min: 1, max: 500 });
        const optionsJson = requireString(args, 'options_json', { min: 2, max: 4000 });
        if (!prompt.ok) return { ok: false, name: tool, label, response: { error: prompt.error } };
        if (!optionsJson.ok) return { ok: false, name: tool, label, response: { error: optionsJson.error } };
        let options: Array<{ id: string; label: string; value: string }> = [];
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
        const block: AiMessageBlock = {
          kind: 'project_picker',
          id: `pp_${Date.now().toString(36)}`,
          prompt: prompt.value,
          conversationId: ctx.conversationId,
          draftId,
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
        if (!owned || owned.conversationId !== ctx.conversationId) {
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
            blocks: [card],
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
        if (!owned || owned.conversationId !== ctx.conversationId) {
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
