import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  DEFAULT_EMAIL_TEMPLATES,
  type EmailTemplateDefinition,
} from '@/lib/email/templates';

export const HARD_LOCKED_TEST_RECIPIENT =
  process.env.TEST_ALLOWED_RECIPIENT_EMAIL?.trim().toLowerCase() ||
  'test-recipient@turing-drive.com';
export const DEFAULT_DELEGATED_SENDER = 'turing-drive_mis@turing-drive.com';
export const DEFAULT_DISPLAY_From_EMAIL = 'no-reply@turing-drive.com';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const DEFAULT_SA_KEY_PATH = join(
  process.cwd(),
  'deploy/secrets/gmail-service-account.json'
);
const LOCAL_CONFIG_FALLBACK_PATH = join(
  process.cwd(),
  'deploy/secrets/email-system-config.json'
);

function getStorageSecretsDir(): string | null {
  const storagePath = process.env.STORAGE_LOCAL_PATH?.trim();
  if (!storagePath) return null;
  return storagePath.startsWith('/')
    ? join(storagePath, '.email-secrets')
    : join(process.cwd(), storagePath, '.email-secrets');
}

export type ServiceAccountKeyInfo = {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
};

export type EmailDeliveryLogEntry = {
  id: string;
  timestamp: string;
  originalRecipient: string;
  finalRecipient: string;
  delegatedUser: string;
  displayFromEmail: string;
  subject: string;
  templateId?: string;
  status: 'sent' | 'blocked_by_test_guard' | 'failed';
  gmailMessageId?: string;
  note?: string;
};

export type EmailSystemConfig = {
  /** 是否啟用 Gmail API 發信 */
  enabled: boolean;
  /** 發信模式：目前強制為 google_service_account */
  provider: 'google_service_account' | 'smtp';
  /** Google Workspace 網域內實際存在、供 Service Account 偽裝 (with_subject) 的授權帳號 */
  delegatedUser: string;
  /** 信件標頭顯示的寄件者地址（例如 no-reply@turing-drive.com 或與 delegatedUser 相同） */
  displayFromEmail: string;
  /** 信件標頭顯示的寄件者名稱 */
  displayFromName: string;
  /** 嚴格測試模式鎖：開啟時只允許寄給 allowedTestRecipients 內的信箱，其他人一律攔截不發送 */
  testModeOnly: boolean;
  /** 測試模式唯一允許收信的信箱清單 */
  allowedTestRecipients: string[];
  /** 當非白名單收件人觸發信件時的處理策略：block = 直接攔截不寄出（預設且最安全） */
  nonAllowedRecipientAction: 'block';
  /** Service Account JSON 原文（僅儲存於伺服器端） */
  serviceAccountJson: string | null;
  /** 各功能分類的信件模板設定 */
  templates: EmailTemplateDefinition[];
  /** 最近發信與攔截紀錄（最多保留 50 筆供管理員檢視） */
  recentLogs: EmailDeliveryLogEntry[];
  updatedAt: string;
  updatedByEmail?: string;
};

export type PublicEmailSystemConfig = Omit<
  EmailSystemConfig,
  'serviceAccountJson'
> & {
  hasServiceAccountKey: boolean;
  serviceAccountSummary: {
    projectId: string;
    clientEmail: string;
    clientId: string;
    privateKeyId: string;
    scope: string;
  } | null;
};

let tableEnsured = false;

async function ensureSettingsTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await getDb().execute(sql`
      CREATE TABLE IF NOT EXISTS system_email_settings (
        code text PRIMARY KEY DEFAULT 'default',
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    tableEnsured = true;
  } catch {
    // Fallback to local file if DB is unreachable in unit tests
  }
}

export function parseServiceAccountKey(
  rawJson: string | null | undefined
): ServiceAccountKeyInfo | null {
  if (!rawJson || typeof rawJson !== 'string') return null;
  try {
    const parsed = JSON.parse(rawJson.trim()) as Record<string, unknown>;
    if (
      parsed.type === 'service_account' &&
      typeof parsed.client_email === 'string' &&
      typeof parsed.private_key === 'string' &&
      typeof parsed.project_id === 'string'
    ) {
      return {
        type: 'service_account',
        project_id: parsed.project_id,
        private_key_id: String(parsed.private_key_id ?? ''),
        private_key: parsed.private_key,
        client_email: parsed.client_email,
        client_id: String(parsed.client_id ?? ''),
        token_uri:
          typeof parsed.token_uri === 'string'
            ? parsed.token_uri
            : 'https://oauth2.googleapis.com/token',
      };
    }
    return null;
  } catch {
    return null;
  }
}

let cachedDefaultSaJson: string | null | undefined = undefined;

function loadDefaultServiceAccountJsonFromEnvOrDisk(): string | null {
  if (process.env.GMAIL_SERVICE_ACCOUNT_JSON?.trim()) {
    const valid = parseServiceAccountKey(process.env.GMAIL_SERVICE_ACCOUNT_JSON);
    if (valid) return JSON.stringify(valid, null, 2);
  }
  if (cachedDefaultSaJson !== undefined) {
    return cachedDefaultSaJson;
  }
  const envPath = process.env.GMAIL_SERVICE_ACCOUNT_KEY_PATH?.trim();
  const candidatePath = envPath
    ? envPath.startsWith('/')
      ? envPath
      : join(process.cwd(), envPath)
    : DEFAULT_SA_KEY_PATH;

  const storageDir = getStorageSecretsDir();
  const candidatePaths = [
    candidatePath,
    ...(storageDir ? [join(storageDir, 'gmail-service-account.json')] : []),
  ];

  for (const p of candidatePaths) {
    try {
      if (existsSync(p)) {
        const content = readFileSync(p, 'utf8');
        if (parseServiceAccountKey(content)) {
          cachedDefaultSaJson = content;
          return content;
        }
      }
    } catch {
      // ignore
    }
  }
  cachedDefaultSaJson = null;
  return null;
}

function mergeTemplatesWithDefaults(
  saved: EmailTemplateDefinition[] | undefined
): EmailTemplateDefinition[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return DEFAULT_EMAIL_TEMPLATES;
  }
  const savedById = new Map(saved.map((t) => [t.id, t]));
  return DEFAULT_EMAIL_TEMPLATES.map((def) => {
    const custom = savedById.get(def.id);
    if (!custom) return def;
    // Upgrade legacy saved templates that lack {{documentDetailsHtml}}, still use narrow 680px container, or contain obsolete footer/lock text
    const isLegacyHtml =
      !custom.bodyHtmlTemplate ||
      !custom.bodyHtmlTemplate.includes('{{documentDetailsHtml}}') ||
      !custom.bodyHtmlTemplate.includes('max-width: 1080px') ||
      !custom.bodyHtmlTemplate.includes('border-radius: 10px') ||
      custom.bodyHtmlTemplate.includes('前往 ACCSYS 系統查看完整單據') ||
      custom.bodyHtmlTemplate.includes('border-left: 4px solid');
    const isLegacyText =
      !custom.bodyTextTemplate ||
      !custom.bodyTextTemplate.includes('{{documentDetailsText}}');

    return {
      ...def,
      enabled: typeof custom.enabled === 'boolean' ? custom.enabled : def.enabled,
      subjectTemplate: custom.subjectTemplate?.trim() || def.subjectTemplate,
      bodyTextTemplate: isLegacyText
        ? def.bodyTextTemplate
        : custom.bodyTextTemplate.trim(),
      bodyHtmlTemplate: isLegacyHtml
        ? def.bodyHtmlTemplate
        : custom.bodyHtmlTemplate.trim(),
    };
  });
}

function buildDefaultConfig(): EmailSystemConfig {
  const defaultSaJson = loadDefaultServiceAccountJsonFromEnvOrDisk();
  const envDelegated =
    process.env.GMAIL_DELEGATED_USER?.trim().toLowerCase() ||
    DEFAULT_DELEGATED_SENDER;
  const envAllowed =
    process.env.GMAIL_TEST_ALLOWED_RECIPIENT?.trim().toLowerCase() ||
    HARD_LOCKED_TEST_RECIPIENT;

  return {
    enabled: true,
    provider: 'google_service_account',
    delegatedUser: envDelegated,
    displayFromEmail: DEFAULT_DISPLAY_From_EMAIL,
    displayFromName:
      process.env.GMAIL_DISPLAY_NAME?.trim() || 'TURING DRIVE ACCSYS 系統通知',
    testModeOnly: true,
    allowedTestRecipients: [envAllowed],
    nonAllowedRecipientAction: 'block',
    serviceAccountJson: defaultSaJson,
    templates: DEFAULT_EMAIL_TEMPLATES,
    recentLogs: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function getEmailSystemConfig(): Promise<EmailSystemConfig> {
  const defaults = buildDefaultConfig();
  const forceDisabled =
    process.env.DISABLE_EMAIL_DELIVERY === '1' ||
    process.env.DISABLE_EMAIL_DELIVERY === 'true';

  // Try database first
  try {
    await ensureSettingsTable();
    const rows = await getDb().execute<{ config: Partial<EmailSystemConfig> }>(
      sql`SELECT config FROM system_email_settings WHERE code = 'default' LIMIT 1`
    );
    const saved = rows[0]?.config;
    if (saved && typeof saved === 'object') {
      const saJson =
        saved.serviceAccountJson && parseServiceAccountKey(saved.serviceAccountJson)
          ? saved.serviceAccountJson
          : defaults.serviceAccountJson;

      const mergedTemplates = mergeTemplatesWithDefaults(saved.templates);
      const savedDelegated = saved.delegatedUser?.trim().toLowerCase();
      const normalizedDelegated =
        !savedDelegated ||
        savedDelegated === 'accounting-system@turing-drive.com' ||
        savedDelegated === 'no-reply@turing-drive.com'
          ? DEFAULT_DELEGATED_SENDER
          : savedDelegated;
      const savedDisplayFrom = saved.displayFromEmail?.trim().toLowerCase();
      const normalizedDisplayFrom =
        !savedDisplayFrom ||
        savedDisplayFrom === 'accounting-system@turing-drive.com' ||
        savedDisplayFrom === 'turing-drive_mis@turing-drive.com'
          ? DEFAULT_DISPLAY_From_EMAIL
          : savedDisplayFrom;

      const resultConfig: EmailSystemConfig = {
        enabled: forceDisabled
          ? false
          : typeof saved.enabled === 'boolean'
            ? saved.enabled
            : defaults.enabled,
        provider: saved.provider ?? 'google_service_account',
        delegatedUser: normalizedDelegated,
        displayFromEmail: normalizedDisplayFrom,
        displayFromName:
          saved.displayFromName?.trim() || defaults.displayFromName,
        // 安全防線：測試期間預設強制開啟 testModeOnly，且僅允許白名單收件人
        testModeOnly:
          typeof saved.testModeOnly === 'boolean' ? saved.testModeOnly : true,
        allowedTestRecipients:
          Array.isArray(saved.allowedTestRecipients) &&
          saved.allowedTestRecipients.length > 0
            ? saved.allowedTestRecipients.map((e) => e.trim().toLowerCase()).filter(Boolean)
            : [HARD_LOCKED_TEST_RECIPIENT],
        nonAllowedRecipientAction: 'block',
        serviceAccountJson: saJson,
        templates: mergedTemplates,
        recentLogs: Array.isArray(saved.recentLogs)
          ? saved.recentLogs.slice(0, 50)
          : [],
        updatedAt: saved.updatedAt || defaults.updatedAt,
        updatedByEmail: saved.updatedByEmail,
      };

      if (
        !Array.isArray(saved.templates) ||
        saved.templates.length !== DEFAULT_EMAIL_TEMPLATES.length ||
        saved.templates.some(
          (t) =>
            !t.bodyHtmlTemplate?.includes('{{documentDetailsHtml}}') ||
            !t.bodyHtmlTemplate?.includes('max-width: 1080px') ||
            !t.bodyHtmlTemplate?.includes('border-radius: 10px')
        )
      ) {
        void saveEmailSystemConfig(resultConfig);
      }

      return resultConfig;
    }
  } catch {
    // Fallback to local file
  }

  const storageDir = getStorageSecretsDir();
  const fallbackConfigPaths = [
    LOCAL_CONFIG_FALLBACK_PATH,
    ...(storageDir ? [join(storageDir, 'email-system-config.json')] : []),
  ];
  for (const cfgPath of fallbackConfigPaths) {
    try {
      if (existsSync(cfgPath)) {
        const saved = JSON.parse(
          readFileSync(cfgPath, 'utf8')
        ) as Partial<EmailSystemConfig>;
        return {
          ...defaults,
          ...saved,
          serviceAccountJson:
            saved.serviceAccountJson || defaults.serviceAccountJson,
          templates: mergeTemplatesWithDefaults(saved.templates),
        };
      }
    } catch {
      // ignore
    }
  }

  return defaults;
}

export async function saveEmailSystemConfig(
  nextConfig: EmailSystemConfig
): Promise<void> {
  const storageDir = getStorageSecretsDir();
  // Always persist serviceAccountJson to deploy/secrets/gmail-service-account.json and writable storage dir if valid
  if (
    nextConfig.serviceAccountJson &&
    parseServiceAccountKey(nextConfig.serviceAccountJson)
  ) {
    cachedDefaultSaJson = nextConfig.serviceAccountJson;
    const formattedSa = JSON.stringify(
      JSON.parse(nextConfig.serviceAccountJson),
      null,
      2
    );
    for (const saPath of [
      DEFAULT_SA_KEY_PATH,
      ...(storageDir ? [join(storageDir, 'gmail-service-account.json')] : []),
    ]) {
      try {
        mkdirSync(dirname(saPath), { recursive: true });
        writeFileSync(saPath, formattedSa, 'utf8');
      } catch {
        // ignore read-only fs errors
      }
    }
  }

  for (const cfgPath of [
    LOCAL_CONFIG_FALLBACK_PATH,
    ...(storageDir ? [join(storageDir, 'email-system-config.json')] : []),
  ]) {
    try {
      mkdirSync(dirname(cfgPath), { recursive: true });
      writeFileSync(cfgPath, JSON.stringify(nextConfig, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }

  try {
    await ensureSettingsTable();
    const payload = JSON.stringify(nextConfig);
    await getDb().execute(sql`
      INSERT INTO system_email_settings (code, config, updated_at)
      VALUES ('default', ${payload}::jsonb, now())
      ON CONFLICT (code) DO UPDATE
      SET config = EXCLUDED.config,
          updated_at = now()
    `);
  } catch {
    // ignore DB error if running in pure unit test environment
  }
}

export async function appendEmailDeliveryLog(
  entry: EmailDeliveryLogEntry
): Promise<void> {
  try {
    const current = await getEmailSystemConfig();
    const recentLogs = [entry, ...(current.recentLogs ?? [])].slice(0, 50);
    const nextConfig: EmailSystemConfig = {
      ...current,
      recentLogs,
    };
    await ensureSettingsTable();
    const payload = JSON.stringify(nextConfig);
    await getDb().execute(sql`
      INSERT INTO system_email_settings (code, config, updated_at)
      VALUES ('default', ${payload}::jsonb, now())
      ON CONFLICT (code) DO UPDATE
      SET config = EXCLUDED.config,
          updated_at = now()
    `);
  } catch {
    // Non-blocking log
  }
}

export function toPublicEmailConfig(
  config: EmailSystemConfig
): PublicEmailSystemConfig {
  const keyInfo = parseServiceAccountKey(config.serviceAccountJson);
  const { serviceAccountJson: _omitted, ...rest } = config;
  void _omitted;
  return {
    ...rest,
    hasServiceAccountKey: Boolean(keyInfo),
    serviceAccountSummary: keyInfo
      ? {
          projectId: keyInfo.project_id,
          clientEmail: keyInfo.client_email,
          clientId: keyInfo.client_id,
          privateKeyId: keyInfo.private_key_id
            ? `${keyInfo.private_key_id.slice(0, 8)}...${keyInfo.private_key_id.slice(-6)}`
            : 'N/A',
          scope: GMAIL_SEND_SCOPE,
        }
      : null,
  };
}
