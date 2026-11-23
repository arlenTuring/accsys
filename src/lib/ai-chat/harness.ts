import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Core Harness Engineering Primitives (M1–M9)
 * Reference: https://harness-design-dn4zb55ecq-de.a.run.app/
 *
 * Implements:
 * 1. Tool Side-Effect Classification & Parallel Dispatch Grouping (M3, M4)
 * 2. Policy Engine (`deny > ask > allow`) (M7, M8)
 * 3. Pre-Call Token Budget & Cumulative Quadratic Cost Accounting (M2, M4)
 * 4. Repeat-Action Hash Loop Detector (M4)
 * 5. Large Tool Output Offloading (Head 20% + Tail 80% + File Pointer) & 4-Part Error Recovery (M3, M5)
 * 6. Context Window Compaction at 70% Budget into `<state_snapshot>` (M6)
 * 7. Transient HTTP Exponential Backoff with Jitter (M4)
 */

export type ToolEffectCategory = 'read_only' | 'workspace_write' | 'external_impact';

export type PolicyDecision = 'allow' | 'ask' | 'deny';

export interface PolicyEvaluation {
  decision: PolicyDecision;
  category: ToolEffectCategory;
  reason?: string;
}

/**
 * Classifies every AI Chat tool by its side-effect profile (Lecture 3 & 4):
 * - `read_only`: Safe to run concurrently (`Promise.all`) and safe to auto-retry.
 * - `workspace_write`: Mutates application drafts or UI proposals; must run sequentially in call order.
 * - `external_impact`: Approves/returns formal workflow submissions or dispatches forms to other employees.
 */
const READ_ONLY_TOOLS = new Set<string>([
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
  'describe_application_draft',
  'search_my_submissions',
  'list_draft_attachments',
  'search_trip_companion_candidates',
  'search_my_assets',
  'list_inventory_handover_forms',
  'get_my_pending_tasks_overview',
  'list_my_budget_tasks_and_history',
  'get_budget_analytics_summary',
  'search_company_regulations',
  'list_company_announcements',
  'list_company_surveys',
]);

const EXTERNAL_IMPACT_TOOLS = new Set<string>([
  'approve_submission',
  'return_submission',
  'approve_all_pending',
  'dispatch_inventory_handover_form',
  'confirm_inventory_handover_items',
  'dispatch_budget_compilation_notice',
]);

export function classifyToolEffect(toolName: string): ToolEffectCategory {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read_only';
  if (EXTERNAL_IMPACT_TOOLS.has(toolName)) return 'external_impact';
  return 'workspace_write';
}

export function isReadOnlyTool(toolName: string): boolean {
  return classifyToolEffect(toolName) === 'read_only';
}

/**
 * Deterministic key canonicalization for JSON schemas & tool arguments (M2, M4).
 * Protects KV Cache prefix stability and ensures identical tool calls produce identical hashes.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

export function computeToolCallSignature(name: string, args: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`${name}:${canonicalizeJson(args)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Repeat-Action Detector (Lecture 4):
 * Tracks `(toolName, canonicalArgs)` signatures across rounds in a turn to prevent infinite loops.
 */
export class RepeatActionDetector {
  private readonly counts = new Map<string, number>();
  private readonly maxRepeats: number;

  constructor(maxRepeats = 2) {
    this.maxRepeats = maxRepeats;
  }

  recordAndCheck(name: string, args: Record<string, unknown>): {
    repeated: boolean;
    count: number;
    signature: string;
  } {
    const signature = computeToolCallSignature(name, args);
    const next = (this.counts.get(signature) ?? 0) + 1;
    this.counts.set(signature, next);
    return {
      repeated: next > this.maxRepeats,
      count: next,
      signature,
    };
  }
}

/**
 * Two-Layer Policy Engine (`deny > ask > allow`) (Lecture 7 & 8):
 * Evaluates tool intent and arguments before execution.
 */
const DANGEROUS_PAYLOAD_RE =
  /(?:;\s*rm\s+-rf|DROP\s+TABLE|UNION\s+SELECT\s+|<\s*script\b|javascript:|file:\/\/\/etc\/passwd)/i;

export function evaluateToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
  allowedTools: ReadonlySet<string>,
  options?: {
    deniedTools?: ReadonlySet<string>;
    requireAskForExternalImpact?: boolean;
  }
): PolicyEvaluation {
  const category = classifyToolEffect(toolName);

  // Rule 1: Explicit deny list takes highest precedence (`deny > ask > allow`)
  if (!allowedTools.has(toolName) || options?.deniedTools?.has(toolName)) {
    return {
      decision: 'deny',
      category,
      reason: `工具 "${toolName}" 不在允許清單或已被安全策略拒絕執行。`,
    };
  }

  // Rule 2: Inspect arguments for injection / destructive patterns
  const serializedArgs = canonicalizeJson(args);
  if (DANGEROUS_PAYLOAD_RE.test(serializedArgs)) {
    return {
      decision: 'deny',
      category,
      reason: `工具 "${toolName}" 的參數包含疑似危險或越權指令特徵，已被 Policy 引擎攔截。`,
    };
  }

  // Rule 3: External impact validation (e.g., return_submission must have a non-empty reason)
  if (toolName === 'return_submission') {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (!reason) {
      return {
        decision: 'deny',
        category,
        reason: '退回簽核單據時必須提供明確的退回原因（reason 不可為空）。',
      };
    }
  }

  if (category === 'external_impact' && options?.requireAskForExternalImpact) {
    return {
      decision: 'ask',
      category,
      reason: `工具 "${toolName}" 屬於外部簽核或跨人員異動操作，需確認授權。`,
    };
  }

  return { decision: 'allow', category };
}

/**
 * Four-Part Actionable Tool Error Formatter (Lecture 3: "Errors Are Prompts"):
 * Every error returned to the model states:
 * 1. What happened & whether state changed
 * 2. Why it failed
 * 3. Current state
 * 4. Concrete next step for recovery
 */
export function formatActionableToolError(input: {
  toolName: string;
  errorCode: string;
  reason: string;
  stateChanged?: boolean;
  currentState?: string;
  nextStepHint?: string;
}): Record<string, unknown> {
  const stateChanged = Boolean(input.stateChanged);
  const whatHappened = stateChanged
    ? `呼叫 ${input.toolName} 時發生部分錯誤，部分狀態可能已變更。`
    : `呼叫 ${input.toolName} 失敗，資料庫與草稿狀態維持不變（未寫入任何變更）。`;

  const currentState =
    input.currentState ??
    (stateChanged ? '請以最新回傳欄位或工作狀態為準。' : '草稿版本與欄位內容維持原狀。');

  let nextStep = input.nextStepHint;
  if (!nextStep) {
    switch (input.errorCode) {
      case 'version_conflict':
        nextStep =
          '請讀取【系統工作狀態】中的最新 version 與欄位值後，使用新的 expected_version 重新呼叫一次。';
        break;
      case 'not_found_or_forbidden':
      case 'not_found':
        nextStep =
          '請確認目標 ID 是否來自【系統工作狀態】或先呼叫對應的查詢工具取得正確 ID，切勿自行猜測 UUID。';
        break;
      case 'repeated_tool_call':
        nextStep =
          '請勿重複以相同參數呼叫此工具；請直接根據先前已取得的結果回覆使用者，或改用其他參數。';
        break;
      case 'policy_denied':
        nextStep = '此操作被安全策略拒絕，請向使用者說明原因，不要嘗試繞過限制。';
        break;
      default:
        nextStep = '請檢查參數格式是否符合工具 Schema，或向使用者詢問缺少的必要資訊。';
    }
  }

  return {
    ok: false,
    error: input.errorCode,
    stateChanged,
    message: `${whatHappened} 原因：${input.reason} 目前狀態：${currentState} 建議下一步：${nextStep}`,
    recovery: {
      whatHappened,
      why: input.reason,
      currentState,
      nextStep,
    },
  };
}

/**
 * Large Tool Output Offloading (Lecture 3 & Lecture 5):
 * When serialized tool output exceeds `maxChars`, writes the full JSON to a scratch file
 * and keeps Head 20% + Tail 80% + summary stats + scratch file path in the context.
 */
export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 12_000;

export async function boundToolOutput(
  toolName: string,
  response: Record<string, unknown>,
  maxChars: number = DEFAULT_TOOL_OUTPUT_MAX_CHARS
): Promise<{ response: Record<string, unknown>; truncated: boolean; originalChars: number; scratchFilePath?: string }> {
  const serialized = JSON.stringify(response);
  const originalChars = serialized.length;
  if (originalChars <= maxChars) {
    return { response, truncated: false, originalChars };
  }

  let scratchFilePath: string | undefined;
  try {
    const dir = join(tmpdir(), 'accsys-agent-scratch');
    await mkdir(dir, { recursive: true });
    const fileName = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    scratchFilePath = join(dir, fileName);
    await writeFile(scratchFilePath, JSON.stringify(response, null, 2), 'utf8');
  } catch {
    scratchFilePath = undefined;
  }

  const headBudget = Math.max(400, Math.floor(maxChars * 0.2));
  const tailBudget = Math.max(800, Math.floor(maxChars * 0.8) - 350);
  const headSlice = serialized.slice(0, headBudget);
  const tailSlice = serialized.slice(Math.max(headBudget, serialized.length - tailBudget));
  const totalLines = serialized.split('\n').length;

  return {
    truncated: true,
    originalChars,
    scratchFilePath,
    response: {
      ok: response.ok ?? true,
      _truncated: true,
      _truncationMeta: {
        toolName,
        originalChars,
        totalLines,
        keptHeadChars: headSlice.length,
        keptTailChars: tailSlice.length,
        scratchFilePath: scratchFilePath ?? null,
        paginationHint:
          '輸出超過單回合 Context 預算上限，已保留前 20% 與後 80% 摘要。請縮小搜尋關鍵字或指定過濾條件以取得精確項目。',
      },
      headPreview: headSlice,
      tailPreview: tailSlice,
      message: typeof response.message === 'string' ? response.message : undefined,
      count: typeof response.count === 'number' ? response.count : undefined,
    },
  };
}

/**
 * Token Estimation & Pre-Call Budget Guard (Lecture 2 & Lecture 4):
 * CJK characters average ~1.5 tokens; ASCII averages ~0.25 tokens per char.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x2e80 && code <= 0x9fff) cjkCount++;
  }
  const otherCount = text.length - cjkCount;
  return Math.ceil(cjkCount * 1.4 + otherCount * 0.3);
}

export function estimateContentsTokens(
  systemInstruction: string,
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>
): number {
  let total = estimateTokensFromText(systemInstruction);
  for (const turn of contents) {
    for (const part of turn.parts) {
      if (typeof part.text === 'string') {
        total += estimateTokensFromText(part.text);
      } else if (part.inlineData) {
        // Vision inline image / PDF fixed tile token estimate (~560 tokens)
        total += 560;
      } else {
        total += estimateTokensFromText(JSON.stringify(part));
      }
    }
  }
  return total;
}

/**
 * Context Compaction at 70% Budget (Lecture 6):
 * Splits strictly between complete user/model turns (never splitting a functionCall from its functionResponse).
 * Preserves the original first user goal verbatim + the most recent 30% turns, compressing the middle
 * into a structured `<state_snapshot>`.
 */
export interface CompactableTurn {
  role: 'user' | 'model';
  text: string;
}

export function compactConversationHistory(
  history: CompactableTurn[],
  options: {
    maxContextTokens?: number;
    compactionThresholdRatio?: number;
    systemPromptTokens?: number;
    currentTurnTokens?: number;
  } = {}
): {
  compacted: CompactableTurn[];
  didCompact: boolean;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
} {
  const maxContextTokens = options.maxContextTokens ?? 32_000;
  const thresholdRatio = options.compactionThresholdRatio ?? 0.7;
  const baseOverhead = (options.systemPromptTokens ?? 2_500) + (options.currentTurnTokens ?? 1_500);

  const historyTokens = history.reduce((sum, t) => sum + estimateTokensFromText(t.text), 0);
  const estimatedTokensBefore = baseOverhead + historyTokens;
  const triggerBudget = Math.floor(maxContextTokens * thresholdRatio);

  if (estimatedTokensBefore <= triggerBudget || history.length <= 4) {
    return {
      compacted: history,
      didCompact: false,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
    };
  }

  // Keep the first user message (original goal) verbatim + recent ~30% of turns (at least 4 messages, paired)
  const firstTurn = history[0]!;
  const recentKeepCount = Math.max(4, Math.floor(history.length * 0.35));
  let splitIndex = history.length - recentKeepCount;
  // Ensure splitIndex lands on a 'user' turn so we never orphan a 'model' response
  while (splitIndex > 1 && history[splitIndex]?.role !== 'user') {
    splitIndex--;
  }

  if (splitIndex <= 1) {
    return {
      compacted: history,
      didCompact: false,
      estimatedTokensBefore,
      estimatedTokensAfter: estimatedTokensBefore,
    };
  }

  const middleTurns = history.slice(1, splitIndex);
  const recentTurns = history.slice(splitIndex);

  const keyFacts: string[] = [];
  for (const m of middleTurns) {
    const clean = m.text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const prefix = m.role === 'user' ? '使用者曾提出' : '助手已處理';
    keyFacts.push(`- ${prefix}：${clean.slice(0, 140)}${clean.length > 140 ? '…' : ''}`);
  }

  const snapshotText = [
    '<state_snapshot>',
    `【長對話歷史摘要（系統自動壓縮 ${middleTurns.length} 則中段訊息以保護 Context 預算）】`,
    `原始任務起點：${firstTurn.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    '中段已確認事項與軌跡：',
    ...keyFacts.slice(-10),
    '（注意：草稿與欄位的最新權威狀態請一律以本回合【系統工作狀態】為準。）',
    '</state_snapshot>',
  ].join('\n');

  const compacted: CompactableTurn[] = [
    firstTurn,
    {
      role: 'model',
      text: snapshotText,
    },
    ...recentTurns,
  ];

  const afterHistoryTokens = compacted.reduce((sum, t) => sum + estimateTokensFromText(t.text), 0);
  return {
    compacted,
    didCompact: true,
    estimatedTokensBefore,
    estimatedTokensAfter: baseOverhead + afterHistoryTokens,
  };
}

/**
 * Transient HTTP Error Classification & Truncated Exponential Backoff with Jitter (Lecture 4):
 * Only retries transient network/server statuses (`408`, `429`, `500`, `502`, `503`, `504`).
 * Never retries `400`, `401`, `403`, `404` or user-aborted requests.
 */
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number, bodyText = ''): boolean {
  if (!RETRYABLE_HTTP_STATUSES.has(status)) return false;
  // Do not retry hard daily quota exhaustion
  if (status === 429 && /quota.*exceeded.*per.*day|billing_not_enabled/i.test(bodyText)) {
    return false;
  }
  return true;
}

export function computeBackoffDelayMs(attempt: number, baseMs = 500, maxMs = 6_000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * (exp * 0.35));
  return Math.min(maxMs, Math.floor(exp * 0.8 + jitter));
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
