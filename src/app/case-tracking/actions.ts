'use server';

import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { ADMIN_NAV_PERMISSIONS, hasAnyPermission } from '@/lib/authz/permissions';
import {
  loadEmailApprovalDocumentSummary,
  type EmailApprovalDocumentSummary,
} from '@/lib/email/submission-detail-html';
import type { FormType } from '@/lib/procurement/form-registry';

export async function getTrackingDocumentDetailAction(
  formType: FormType,
  formId: string
): Promise<EmailApprovalDocumentSummary | null> {
  const employee = await getCurrentEmployee();
  if (!employee) return null;
  const canAccess =
    employee.role === 'admin' ||
    employee.role === 'finance' ||
    employee.permissions.includes('finance.cases') ||
    employee.permissions.includes('forms.read_all') ||
    hasAnyPermission(employee.permissions, ADMIN_NAV_PERMISSIONS);
  if (!canAccess) return null;

  return loadEmailApprovalDocumentSummary(formType, formId);
}
