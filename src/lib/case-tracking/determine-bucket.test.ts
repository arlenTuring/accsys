import { describe, expect, it } from 'vitest';
import type { FormType } from '@/lib/procurement/form-registry';
import { determineCaseBucket, type CaseFormState } from './determine-bucket';

function approved(formType: FormType): CaseFormState {
  return { formType, exists: true, status: 'approved' };
}
function withStatus(formType: FormType, status: string): CaseFormState {
  return { formType, exists: true, status };
}
function notExists(formType: FormType): CaseFormState {
  return { formType, exists: false, status: null };
}

describe('determineCaseBucket', () => {
  it('returns completed when all four forms exist and are approved', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      approved('purchase_order'),
      approved('acceptance'),
      approved('expense_request'),
    ];
    expect(determineCaseBucket(forms, 'standard')).toBe('completed');
  });

  it('returns in_progress when one form is still pending_approval', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      withStatus('purchase_order', 'pending_approval'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms, 'standard')).toBe('in_progress');
  });

  it('returns in_progress when a form was returned and nothing is pending_approval', () => {
    const forms: CaseFormState[] = [
      withStatus('purchase_request', 'returned'),
      notExists('purchase_order'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms, 'standard')).toBe('in_progress');
  });

  it('returns in_progress when later-stage forms have not been created yet, even if earlier ones are approved', () => {
    const forms: CaseFormState[] = [
      approved('purchase_request'),
      approved('purchase_order'),
      notExists('acceptance'),
      notExists('expense_request'),
    ];
    expect(determineCaseBucket(forms, 'standard')).toBe('in_progress');
  });

  it('returns completed for a standalone_expense case once its sole expense_request is approved, even though the other three forms do not exist', () => {
    const forms: CaseFormState[] = [
      notExists('purchase_request'),
      notExists('purchase_order'),
      notExists('acceptance'),
      approved('expense_request'),
    ];
    expect(determineCaseBucket(forms, 'standalone_expense')).toBe('completed');
  });

  it('returns in_progress for a standalone_expense case when its expense_request is not yet approved', () => {
    const forms: CaseFormState[] = [
      notExists('purchase_request'),
      notExists('purchase_order'),
      notExists('acceptance'),
      withStatus('expense_request', 'pending_approval'),
    ];
    expect(determineCaseBucket(forms, 'standalone_expense')).toBe('in_progress');
  });
});
