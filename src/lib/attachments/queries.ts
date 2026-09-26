import { desc, and, eq } from 'drizzle-orm';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { canReadForm } from '@/lib/authz/forms';
import { getDb } from '@/lib/db';
import { attachments, employees } from '@/lib/db/schema';

export type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByName: string;
  createdAt: string;
  scanStatus: string;
};

export async function getAttachments(formType: string, formId: string): Promise<AttachmentRow[]> {
  if (!(await canReadForm(await getCurrentEmployee(), formType, formId))) return [];
  const rows = await getDb()
    .select({
      id: attachments.id,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      fileSizeBytes: attachments.fileSizeBytes,
      uploadedByName: employees.name,
      createdAt: attachments.createdAt,
      scanStatus: attachments.scanStatus,
    })
    .from(attachments)
    .innerJoin(employees, eq(employees.id, attachments.uploadedByEmployeeId))
    .where(and(eq(attachments.formType, formType), eq(attachments.formId, formId)))
    .orderBy(desc(attachments.createdAt));
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}
