import { GoogleAuth, Impersonated, type AuthClient } from 'google-auth-library';
import type { AiChatConfig } from './config';
import { AiChatConfigError } from './config';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

let cachedVertexToken: {
  key: string;
  token: string;
  principalHint: string;
  expiresAt: number;
} | null = null;

/**
 * Vertex credentials via Application Default Credentials.
 * - Local: `gcloud auth application-default login` and optional
 *   AI_CHAT_IMPERSONATE_SA (Impersonated credentials).
 * - GCP: metadata / attached service account (no gcloud binary, no homebrew paths).
 */
export async function getVertexAccessToken(cfg: AiChatConfig): Promise<{
  token: string;
  principalHint: string;
}> {
  const cacheKey = `${cfg.projectId}|${cfg.impersonateServiceAccount || 'adc'}`;
  if (
    cachedVertexToken &&
    cachedVertexToken.key === cacheKey &&
    cachedVertexToken.expiresAt > Date.now() + 60_000
  ) {
    return {
      token: cachedVertexToken.token,
      principalHint: cachedVertexToken.principalHint,
    };
  }

  try {
    const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON?.trim();
    const credentials = inlineJson ? (JSON.parse(inlineJson) as Record<string, unknown>) : undefined;
    const auth = new GoogleAuth({
      scopes: SCOPES,
      projectId: cfg.projectId,
      ...(credentials ? { credentials } : {}),
    });
    const sourceClient = await auth.getClient();

    let client: AuthClient = sourceClient;
    let principalHint = 'adc';

    if (cfg.impersonateServiceAccount) {
      client = new Impersonated({
        sourceClient,
        targetPrincipal: cfg.impersonateServiceAccount,
        lifetime: 3600,
        delegates: [],
        targetScopes: SCOPES,
      });
      principalHint = cfg.impersonateServiceAccount;
    }

    const tokenResponse = await client.getAccessToken();
    const token =
      typeof tokenResponse === 'string'
        ? tokenResponse
        : tokenResponse?.token ?? null;
    if (!token) {
      throw new AiChatConfigError(
        'ADC 未取得 access token。本機請執行 gcloud auth application-default login；GCP 請確認執行身分與 scopes。'
      );
    }
    cachedVertexToken = {
      key: cacheKey,
      token,
      principalHint,
      expiresAt: Date.now() + 50 * 60 * 1000,
    };
    return { token, principalHint };
  } catch (err) {
    if (err instanceof AiChatConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AiChatConfigError(
      `無法取得 Vertex 憑證（ADC／模擬服務帳戶）。${msg.slice(0, 280)}`
    );
  }
}
