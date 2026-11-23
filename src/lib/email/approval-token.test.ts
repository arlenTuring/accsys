import { describe, expect, it } from 'vitest';
import {
  buildEmailApprovalUrls,
  createEmailApprovalToken,
  verifyEmailApprovalToken,
} from './approval-token';
import {
  renderEmailDocumentAndActions,
  type EmailApprovalDocumentSummary,
} from './submission-detail-html';

describe('email approval HMAC token & anti-misclick rendering', () => {
  const sampleInput = {
    formType: 'custom' as const,
    formId: '11111111-2222-3333-4444-555555555555',
    stepOrder: 2,
    version: 3,
    approverEmployeeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  };

  it('creates and verifies a valid HMAC-SHA256 approval token', () => {
    const now = 1_700_000_000_000;
    const token = createEmailApprovalToken({ ...sampleInput, now, ttlMs: 60_000 });
    const res = verifyEmailApprovalToken(token, now + 30_000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.payload.formType).toBe('custom');
      expect(res.payload.formId).toBe(sampleInput.formId);
      expect(res.payload.stepOrder).toBe(2);
      expect(res.payload.version).toBe(3);
      expect(res.payload.approverEmployeeId).toBe(sampleInput.approverEmployeeId);
    }
  });

  it('rejects expired tokens', () => {
    const now = 1_700_000_000_000;
    const token = createEmailApprovalToken({ ...sampleInput, now, ttlMs: 10_000 });
    const res = verifyEmailApprovalToken(token, now + 10_001);
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tampered tokens', () => {
    const token = createEmailApprovalToken(sampleInput);
    const [payloadPart, sigPart] = token.split('.');
    const tamperedSig = sigPart.slice(0, -2) + (sigPart.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyEmailApprovalToken(`${payloadPart}.${tamperedSig}`)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  it('renders full document details table and <details> anti-misclick collapsible approval buttons', () => {
    const summary: EmailApprovalDocumentSummary = {
      formType: 'custom',
      formId: sampleInput.formId,
      formLabel: '請購單',
      formNumber: 'PR-20261117-0088',
      caseNumber: 'PR-20261117-0088',
      status: 'pending_approval',
      version: 1,
      currentStepOrder: 2,
      currentStepLabel: '高階主管覆核（副總經理）',
      applicantEmployeeId: '99999999-8888-7777-6666-555555555555',
      applicantName: '賴昭宇',
      departmentName: '車輛開發部 (VD)',
      totalAmountText: 'NT$ 42,500',
      submittedAt: new Date('2026-11-17T02:00:00Z'),
      fields: [
        { label: '付款條件', value: '月結30天' },
        { label: '備註說明', value: '自駕小巴多感測器外參校正支架與線束採購' },
      ],
      tables: [
        {
          title: '請購項目',
          headers: [
            { label: '說明', align: 'left' },
            { label: '數量', align: 'right' },
            { label: '單價', align: 'right' },
            { label: '預估金額', align: 'right' },
          ],
          rows: [
            ['3D LiDAR 鋁合金支架組', '2', '14,500', '29,000'],
            ['車規防水航太接頭線束組', '3', '4,500', '13,500'],
          ],
          totalLabel: '合計',
          totalValue: 'NT$ 42,500',
        },
      ],
      steps: [
        {
          stepOrder: 1,
          stepLabel: '申請部門主管簽核',
          approverId: '99999999-8888-7777-6666-555555555555',
          approverName: '賴昭宇',
          status: 'approved',
          isCurrent: false,
          comment: null,
          actedAt: new Date(),
        },
        {
          stepOrder: 2,
          stepLabel: '高階主管覆核（副總經理）',
          approverId: sampleInput.approverEmployeeId,
          approverName: '沈大維',
          status: 'pending',
          isCurrent: true,
          comment: null,
          actedAt: null,
        },
      ],
      detailUrl: 'http://localhost:3001/f/_/11111111-2222-3333-4444-555555555555',
    };

    const rendered = renderEmailDocumentAndActions(summary, {
      appOrigin: 'http://localhost:3001',
      recipientEmployeeId: sampleInput.approverEmployeeId,
      includeApprovalActions: true,
    });

    // Document details HTML contains fields, line items table, and approval steps
    expect(rendered.documentDetailsHtml).toContain('單據欄位明細');
    expect(rendered.documentDetailsHtml).toContain('月結30天');
    expect(rendered.documentDetailsHtml).toContain('3D LiDAR 鋁合金支架組');
    expect(rendered.documentDetailsHtml).toContain('車規防水航太接頭線束組');
    expect(rendered.documentDetailsHtml).toContain('NT$ 42,500');
    expect(rendered.documentDetailsHtml).toContain('簽核流程進度');

    // Direct in-email approval buttons without icons or broken <details> tags
    expect(rendered.approvalActionsHtml).not.toContain('點此展開');
    expect(rendered.approvalActionsHtml).not.toContain('雙重防誤觸保護機制');
    expect(rendered.approvalActionsHtml).not.toContain('onclick=');
    expect(rendered.approvalActionsHtml).not.toContain('<details');
    expect(rendered.approvalActionsHtml).toContain('準許簽核');
    expect(rendered.approvalActionsHtml).toContain('簽核退回');
    expect(rendered.approveUrl).toContain('/email-approval?token=');
    expect(rendered.approveUrl).toContain('&intent=approve');
    expect(rendered.returnUrl).toContain('&intent=return');

    const urls = buildEmailApprovalUrls('http://localhost:3001', sampleInput);
    expect(urls.approveUrl).toContain('intent=approve');
  });
});
