import { GoogleAuth, Impersonated, type AuthClient } from 'google-auth-library';
import type { AiChatConfig } from './config';
import { AiChatConfigError } from './config';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

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
  try {
    const auth = new GoogleAuth({ scopes: SCOPES, projectId: cfg.projectId });
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
    return { token, principalHint };
  } catch (err) {
    if (err instanceof AiChatConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AiChatConfigError(
      `無法取得 Vertex 憑證（ADC／模擬服務帳戶）。${msg.slice(0, 280)}`
    );
  }
}
