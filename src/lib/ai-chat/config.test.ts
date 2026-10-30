import { describe, expect, it } from 'vitest';
import { loadAiChatConfig } from './config';

describe('loadAiChatConfig', () => {
  it('enables on localhost when project id is provided via env later path', () => {
    const cfg = loadAiChatConfig({
      APP_ORIGIN: 'http://localhost:3001',
      AI_CHAT_PROJECT_ID: 'demo-project',
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.projectId).toBe('demo-project');
    expect(cfg.impersonateServiceAccount).toBeNull();
  });

  it('does not hardcode cloud project or SA', () => {
    const cfg = loadAiChatConfig({ APP_ORIGIN: 'http://localhost:3001' });
    expect(cfg.projectId).toBe('');
    expect(cfg.impersonateServiceAccount).toBeNull();
  });

  it('stays off for non-local origin unless flagged with project', () => {
    expect(
      loadAiChatConfig({ APP_ORIGIN: 'https://accsys.turing-drive.org' }).enabled
    ).toBe(false);
    expect(
      loadAiChatConfig({
        APP_ORIGIN: 'https://accsys.turing-drive.org',
        AI_CHAT_ENABLED: 'true',
        AI_CHAT_PROJECT_ID: 'demo-project',
      }).enabled
    ).toBe(true);
  });

  it('respects explicit false even on localhost', () => {
    expect(
      loadAiChatConfig({
        APP_ORIGIN: 'http://localhost:3001',
        AI_CHAT_ENABLED: 'false',
        AI_CHAT_PROJECT_ID: 'demo-project',
      }).enabled
    ).toBe(false);
  });

  it('reads impersonation only from env', () => {
    const cfg = loadAiChatConfig({
      APP_ORIGIN: 'http://localhost:3001',
      AI_CHAT_PROJECT_ID: 'demo-project',
      AI_CHAT_IMPERSONATE_SA: 'sa@example.iam.gserviceaccount.com',
    });
    expect(cfg.impersonateServiceAccount).toBe('sa@example.iam.gserviceaccount.com');
  });
});
