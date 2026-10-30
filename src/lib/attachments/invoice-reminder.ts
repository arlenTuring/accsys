import type { TaxIdCompareStatus } from '@/lib/company/tax-id';

/** Business statuses that remind + require「仍要夾帶」before draft attach (never a security block). */
const NEEDS_CONFIRM = new Set<TaxIdCompareStatus>([
  'mismatch',
  'not_found',
  'unclear',
  'company_unset',
  'analysis_failed',
  'analysis_pending',
]);

export function invoiceStatusNeedsConfirm(status: TaxIdCompareStatus | string): boolean {
  return NEEDS_CONFIRM.has(status as TaxIdCompareStatus);
}

export function reminderCodeForStatus(status: TaxIdCompareStatus | string): string {
  if (status === 'mismatch') return 'tax_id_mismatch';
  if (status === 'not_found') return 'tax_id_missing';
  if (status === 'unclear') return 'unclear';
  if (status === 'analysis_failed' || status === 'analysis_pending') return 'analysis_failed';
  if (status === 'company_unset') return 'company_unset';
  if (status === 'not_invoice') return 'not_invoice';
  return 'other';
}
