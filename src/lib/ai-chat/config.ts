export class AiChatConfigError extends Error {}

export type AiChatConfig = {
  enabled: boolean;
  /** True when APP_ORIGIN is localhost / 127.0.0.1 */
  isLocal: boolean;
  projectId: string;
  location: string;
  model: string;
  /**
   * Optional SA email to impersonate via ADC source credentials.
   * Must be set explicitly via env — never hardcoded as a production default.
   */
  impersonateServiceAccount: string | null;
  maxHistoryTurns: number;
  maxInputChars: number;
  maxToolRounds: number;
  maxToolsPerRound: number;
  /** Overall wall-clock budget for one user turn (ms). */
  taskTimeoutMs: number;
};

type Env = Record<string, string | undefined>;

export function isLocalAppOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Local: enabled when APP_ORIGIN is localhost unless AI_CHAT_ENABLED=false.
 * Non-local: only when AI_CHAT_ENABLED=true AND project id is configured.
 */
export function loadAiChatConfig(env: Env = process.env): AiChatConfig {
  const origin = env.APP_ORIGIN?.trim();
  const isLocal = isLocalAppOrigin(origin);
  const flag = env.AI_CHAT_ENABLED?.trim().toLowerCase();
  const projectId = (env.AI_CHAT_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '').trim();

  let enabled = false;
  if (flag === 'false') enabled = false;
  else if (flag === 'true') enabled = Boolean(projectId) || isLocal;
  else enabled = isLocal;

  const impRaw = env.AI_CHAT_IMPERSONATE_SA;
  const impersonateServiceAccount =
    impRaw === undefined || impRaw.trim() === '' ? null : impRaw.trim();

  return {
    enabled,
    isLocal,
    projectId:
      projectId ||
      (isLocal ? '' : ''), // never invent a cloud project id
    location: (env.AI_CHAT_LOCATION || 'global').trim(),
    model: (env.AI_CHAT_MODEL || 'gemini-3.8-flash').trim(),
    impersonateServiceAccount,
    maxHistoryTurns: 20,
    maxInputChars: 6000,
    maxToolRounds: 8,
    maxToolsPerRound: 5,
    taskTimeoutMs: 120_000,
  };
}

export function requireAiChatConfig(env: Env = process.env): AiChatConfig {
  const cfg = loadAiChatConfig(env);
  if (!cfg.enabled) {
    throw new AiChatConfigError(
      'AI 助手未啟用。本機請使用 localhost 的 APP_ORIGIN，或設定 AI_CHAT_ENABLED=true。'
    );
  }
  if (!cfg.projectId) {
    throw new AiChatConfigError(
      '缺少 AI_CHAT_PROJECT_ID（或 GOOGLE_CLOUD_PROJECT）。正式／本機呼叫 Vertex 都必須明確設定專案。'
    );
  }
  if (!cfg.isLocal && !cfg.impersonateServiceAccount) {
    // Production path: ADC of the runtime SA is fine (impersonation optional).
    // We only require project id; missing ADC fails later with a clear error.
  }
  return cfg;
}
