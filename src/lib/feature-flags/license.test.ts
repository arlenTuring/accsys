import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FEATURE_FLAGS,
  resolveFeatureFlagForFormKey,
  resolveFeatureFlagForPath,
} from './definitions';
import {
  deriveLicensedFlags,
  generateLicenseKey,
  getDefaultStandardLicense,
  verifyLicenseKey,
} from './license';

describe('Feature Flags & Cryptographic License System', () => {
  it('defaults project_assistant to false and all other 10 features to true', () => {
    expect(DEFAULT_FEATURE_FLAGS.project_assistant).toBe(false);
    expect(DEFAULT_FEATURE_FLAGS.ai_chat).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.budget_management_platform).toBe(true);
    expect(DEFAULT_FEATURE_FLAGS.procurement_module).toBe(true);

    const defaultLic = getDefaultStandardLicense();
    expect(defaultLic.licensedModules).not.toContain('project_assistant');
    expect(defaultLic.licensedModules).toHaveLength(10);
  });

  it('signs and verifies license keys with HMAC-SHA256 and rejects tampered keys', () => {
    const key = generateLicenseKey({
      planName: '測試旗艦版',
      issuedTo: 'Turing Drive',
      licensedModules: ['project_assistant', 'ai_chat'],
      expiresAt: 'PERMANENT',
    });

    const verified = verifyLicenseKey(key);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.flags.project_assistant).toBe(true);
      expect(verified.flags.ai_chat).toBe(true);
      expect(verified.flags.procurement_module).toBe(false);
    }

    // Tamper with 1 character of the signature
    const tampered = key.slice(0, -2) + (key.endsWith('AA') ? 'BB' : 'AA');
    const tamperedRes = verifyLicenseKey(tampered);
    expect(tamperedRes.ok).toBe(false);
  });

  it('strictly prevents unlicensed modules from being enabled via overrides', () => {
    const defaultLic = getDefaultStandardLicense();
    const flags = deriveLicensedFlags(defaultLic, {
      project_assistant: true, // Attempt to force enable an unlicensed module
      ai_chat: false, // Turn off a licensed module
    });
    expect(flags.project_assistant).toBe(false);
    expect(flags.ai_chat).toBe(false);
  });

  it('strictly maps direct URLs and API paths to their controlling feature flag', () => {
    expect(resolveFeatureFlagForPath('/tools/project-assistant')).toBe(
      'project_assistant'
    );
    expect(resolveFeatureFlagForPath('/tools/project-assistant/viewer')).toBe(
      'project_assistant'
    );
    expect(resolveFeatureFlagForPath('/api/projects/live-files')).toBe(
      'project_assistant'
    );
    expect(resolveFeatureFlagForPath('/tools/ai-chat')).toBe('ai_chat');
    expect(resolveFeatureFlagForPath('/tools/pdf-editor')).toBe(
      'tools_workspace'
    );
    expect(resolveFeatureFlagForPath('/budget-codes/projects')).toBe(
      'budget_management_platform'
    );
    expect(resolveFeatureFlagForPath('/requests/new')).toBe(
      'procurement_module'
    );
    expect(resolveFeatureFlagForPath('/f/purchase-request')).toBe(
      'procurement_module'
    );
    expect(resolveFeatureFlagForPath('/expense-claims/project/new')).toBe(
      'expense_claim_module'
    );
    expect(resolveFeatureFlagForPath('/seal-requests/contracts/new')).toBe(
      'seal_request_module'
    );
    expect(resolveFeatureFlagForPath('/assets')).toBe(
      'asset_management_module'
    );
    expect(resolveFeatureFlagForPath('/announcements')).toBe(
      'company_info_hub'
    );
    expect(resolveFeatureFlagForPath('/email-approval')).toBe(
      'email_inline_approval'
    );
    expect(resolveFeatureFlagForPath('/f/expense-claim/new')).toBe(
      'expense_claim_module'
    );
    expect(resolveFeatureFlagForPath('/f/business-trip/new')).toBe(
      'expense_claim_module'
    );
    expect(resolveFeatureFlagForPath('/f/contract-seal/new')).toBe(
      'seal_request_module'
    );
    expect(resolveFeatureFlagForPath('/f/procurement-payment/new')).toBe(
      'procurement_module'
    );
    // Company info admin pages are also gated by company_info_hub even for system admins
    expect(resolveFeatureFlagForPath('/admin/announcements')).toBe(
      'company_info_hub'
    );
    expect(resolveFeatureFlagForPath('/admin/regulations')).toBe(
      'company_info_hub'
    );
    expect(resolveFeatureFlagForPath('/admin/surveys')).toBe(
      'company_info_hub'
    );
    // Core system admin routes are never blocked
    expect(resolveFeatureFlagForPath('/admin/feature-flags')).toBeNull();
    expect(resolveFeatureFlagForPath('/admin/accounts')).toBeNull();

    // Form key mapping
    expect(resolveFeatureFlagForFormKey('purchase-request')).toBe('procurement_module');
    expect(resolveFeatureFlagForFormKey('procurement-payment')).toBe('procurement_module');
    expect(resolveFeatureFlagForFormKey('expense-claim')).toBe('expense_claim_module');
    expect(resolveFeatureFlagForFormKey('business-trip')).toBe('expense_claim_module');
    expect(resolveFeatureFlagForFormKey('contract-seal')).toBe('seal_request_module');
    expect(resolveFeatureFlagForFormKey('budget-request')).toBe('budget_management_platform');
    expect(resolveFeatureFlagForFormKey('asset-transfer')).toBe('asset_management_module');
  });
});
