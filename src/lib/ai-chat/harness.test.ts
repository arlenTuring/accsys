import { describe, expect, it } from 'vitest';
import {
  boundToolOutput,
  canonicalizeJson,
  classifyToolEffect,
  compactConversationHistory,
  computeBackoffDelayMs,
  computeToolCallSignature,
  estimateTokensFromText,
  evaluateToolPolicy,
  formatActionableToolError,
  isReadOnlyTool,
  isRetryableHttpStatus,
  RepeatActionDetector,
} from './harness';
import { AI_CHAT_ALLOWED_TOOLS } from './tools';

const ALLOWED_SET = new Set<string>(AI_CHAT_ALLOWED_TOOLS);

describe('Harness Design Core Primitives (M1–M9)', () => {
  it('classifies tool side effects into read_only, workspace_write, and external_impact', () => {
    expect(classifyToolEffect('get_my_profile')).toBe('read_only');
    expect(classifyToolEffect('search_company_regulations')).toBe('read_only');
    expect(isReadOnlyTool('list_company_announcements')).toBe(true);

    expect(classifyToolEffect('create_application_draft')).toBe('workspace_write');
    expect(classifyToolEffect('update_application_draft')).toBe('workspace_write');
    expect(isReadOnlyTool('update_application_draft')).toBe(false);

    expect(classifyToolEffect('approve_submission')).toBe('external_impact');
    expect(classifyToolEffect('return_submission')).toBe('external_impact');
  });

  it('produces deterministic JSON canonicalization regardless of key order (KV Cache & Hash stability)', () => {
    const a = { b: 2, a: 1, nested: { z: 'yes', y: [3, 2, 1] } };
    const b = { nested: { y: [3, 2, 1], z: 'yes' }, a: 1, b: 2 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(computeToolCallSignature('search_projects', a)).toBe(
      computeToolCallSignature('search_projects', b)
    );
  });

  it('detects repeated identical tool calls across rounds (Loop Control M4)', () => {
    const detector = new RepeatActionDetector(2);
    const args = { query: 'T3 自駕巴士' };

    expect(detector.recordAndCheck('search_projects', args).repeated).toBe(false);
    expect(detector.recordAndCheck('search_projects', args).repeated).toBe(false);
    const third = detector.recordAndCheck('search_projects', args);
    expect(third.repeated).toBe(true);
    expect(third.count).toBe(3);
  });

  it('enforces deny > ask > allow in Policy Engine (Security M7 & M8)', () => {
    // Unknown tool -> deny
    const unknown = evaluateToolPolicy('execute_shell', { cmd: 'ls' }, ALLOWED_SET);
    expect(unknown.decision).toBe('deny');

    // SQL/Command injection payload -> deny
    const injected = evaluateToolPolicy(
      'search_projects',
      { query: 'test; DROP TABLE employees' },
      ALLOWED_SET
    );
    expect(injected.decision).toBe('deny');

    // return_submission without reason -> deny
    const emptyReturn = evaluateToolPolicy(
      'return_submission',
      { submission_id: '123', reason: '   ' },
      ALLOWED_SET
    );
    expect(emptyReturn.decision).toBe('deny');

    // Valid read-only tool -> allow
    const valid = evaluateToolPolicy('search_projects', { query: '桃園機場' }, ALLOWED_SET);
    expect(valid.decision).toBe('allow');
    expect(valid.category).toBe('read_only');
  });

  it('formats 4-part actionable tool errors for model self-recovery (ACI M3)', () => {
    const formatted = formatActionableToolError({
      toolName: 'update_application_draft',
      errorCode: 'version_conflict',
      reason: '目前版本為 4，但傳入 expected_version=3',
      stateChanged: false,
    });

    expect(formatted.ok).toBe(false);
    expect(formatted.stateChanged).toBe(false);
    expect(typeof formatted.message).toBe('string');
    const recovery = formatted.recovery as Record<string, string>;
    expect(recovery.whatHappened).toContain('未寫入任何變更');
    expect(recovery.why).toContain('expected_version=3');
    expect(recovery.currentState).toBeTruthy();
    expect(recovery.nextStep).toContain('expected_version');
  });

  it('offloads oversized tool outputs to scratch file with Head 20% + Tail 80% preview (Context M5)', async () => {
    const largeItems = Array.from({ length: 300 }, (_, i) => ({
      id: `item-${i}`,
      description: `這是第 ${i} 筆測試資料，包含完整的專案描述與規範細節文字列。`.repeat(3),
    }));
    const rawResp = { ok: true, count: largeItems.length, items: largeItems };

    const bounded = await boundToolOutput('search_projects', rawResp, 2000);
    expect(bounded.truncated).toBe(true);
    expect(bounded.originalChars).toBeGreaterThan(2000);
    expect(bounded.response._truncated).toBe(true);
    expect(typeof bounded.response.headPreview).toBe('string');
    expect(typeof bounded.response.tailPreview).toBe('string');
    expect(bounded.scratchFilePath).toBeTruthy();
  });

  it('compacts long conversation history at 70% budget while preserving first user goal and turn boundaries (Context M6)', () => {
    const longHistory = Array.from({ length: 16 }, (_, idx) => ({
      role: (idx % 2 === 0 ? 'user' : 'model') as 'user' | 'model',
      text:
        idx === 0
          ? '請幫我建立一張桃園機場第三航廈的公出差旅申請單，並核對相關高鐵票收據。'
          : `第 ${idx} 回合的詳細討論內容：${'這是關於專案預算、出差日期與同行人員的對話紀錄。'.repeat(20)}`,
    }));

    const result = compactConversationHistory(longHistory, {
      maxContextTokens: 4000,
      compactionThresholdRatio: 0.7,
      systemPromptTokens: 1000,
      currentTurnTokens: 500,
    });

    expect(result.didCompact).toBe(true);
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
    // First turn (original user goal) preserved verbatim
    expect(result.compacted[0]?.text).toBe(longHistory[0]!.text);
    // Second turn is the structured <state_snapshot>
    expect(result.compacted[1]?.text).toContain('<state_snapshot>');
    expect(result.compacted[1]?.text).toContain('原始任務起點');
  });

  it('distinguishes retryable vs non-retryable HTTP statuses and computes jittered backoff (Reliability M4)', () => {
    expect(isRetryableHttpStatus(429, 'Rate limit exceeded')).toBe(true);
    expect(isRetryableHttpStatus(503, 'Service unavailable')).toBe(true);
    expect(isRetryableHttpStatus(429, 'Quota exceeded per day')).toBe(false);
    expect(isRetryableHttpStatus(400, 'Invalid argument')).toBe(false);
    expect(isRetryableHttpStatus(401, 'Unauthorized')).toBe(false);

    const d0 = computeBackoffDelayMs(0, 500, 6000);
    const d1 = computeBackoffDelayMs(1, 500, 6000);
    expect(d0).toBeGreaterThanOrEqual(400);
    expect(d1).toBeGreaterThan(d0);
  });

  it('estimates CJK and ASCII token counts accurately', () => {
    const tokens = estimateTokensFromText('請幫我查詢 T3-2026 專案預算');
    expect(tokens).toBeGreaterThan(10);
  });
});
