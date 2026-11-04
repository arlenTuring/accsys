'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { actorHas } from '@/lib/authz/access';
import {
  createAssetField,
  hideAssetField,
  listAssetFieldDefinitions,
  restoreAssetField,
  updateAssetField,
  countFilledAssetValues,
} from './service';
import type { CreateAssetFieldInput, UpdateAssetFieldInput } from './types';
import { seedAssetFieldDefinitionsFromCatalog } from '@/lib/assets/seed-field-definitions';

async function requireFieldAdmin() {
  const employee = await getCurrentEmployee();
  if (!employee) return { ok: false as const, error: '請先登入' };
  const allowed =
    (await actorHas(employee, 'finance.assets_fields')) || (await actorHas(employee, 'finance.assets'));
  if (!allowed) return { ok: false as const, error: '沒有資產欄位管理權限' };
  return { ok: true as const, employee };
}

export async function listAssetFieldsAction(opts?: { includeHidden?: boolean }) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const fields = await listAssetFieldDefinitions({
    includeHidden: opts?.includeHidden ?? true,
    includeDeleted: false,
  });
  const withCounts = await Promise.all(
    fields.map(async (f) =>
      f.status === 'hidden' ? { ...f, filledCount: await countFilledAssetValues(f.id) } : f
    )
  );
  return { ok: true as const, fields: withCounts };
}

export async function createAssetFieldAction(input: CreateAssetFieldInput) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const res = await createAssetField({ id: gate.employee.id }, input);
  if (res.ok) revalidatePath('/assets/fields');
  return res;
}

export async function updateAssetFieldAction(input: UpdateAssetFieldInput) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const res = await updateAssetField({ id: gate.employee.id }, input);
  if (res.ok) revalidatePath('/assets/fields');
  return res;
}

export async function hideAssetFieldAction(input: { id: string; expectedVersion: number }) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const res = await hideAssetField({ id: gate.employee.id }, input);
  if (res.ok) revalidatePath('/assets/fields');
  return res;
}

export async function restoreAssetFieldAction(input: { id: string; expectedVersion: number }) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const res = await restoreAssetField({ id: gate.employee.id }, input);
  if (res.ok) revalidatePath('/assets/fields');
  return res;
}

export async function seedCatalogFieldsAction() {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const res = await seedAssetFieldDefinitionsFromCatalog();
  revalidatePath('/assets/fields');
  return { ok: true as const, ...res };
}

export async function previewFieldPurgeAction(fieldId: string) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const allowed = await actorHas(gate.employee, 'finance.assets_fields_purge');
  if (!allowed && gate.employee.role !== 'admin') {
    return { ok: false as const, error: '沒有永久刪除資產欄位的權限' };
  }
  const { previewFieldPurge } = await import('./purge');
  const impact = await previewFieldPurge(fieldId);
  if (!impact) return { ok: false as const, error: '找不到欄位' };
  return { ok: true as const, impact };
}

export async function purgeAssetFieldAction(input: {
  fieldId: string;
  expectedVersion: number;
  confirmLabel: string;
  idempotencyKey: string;
}) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const allowed = await actorHas(gate.employee, 'finance.assets_fields_purge');
  if (!allowed && gate.employee.role !== 'admin') {
    return { ok: false as const, error: '沒有永久刪除資產欄位的權限' };
  }
  const { purgeAssetField } = await import('./purge');
  const res = await purgeAssetField({
    actorId: gate.employee.id,
    fieldId: input.fieldId,
    expectedVersion: input.expectedVersion,
    confirmLabel: input.confirmLabel,
    idempotencyKey: input.idempotencyKey,
  });
  if (res.ok) revalidatePath('/assets/fields');
  return res;
}

/** Preview download of values that would be wiped (before confirming purge). */
export async function downloadFieldPurgeBackupPreviewAction(fieldId: string) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  const allowed = await actorHas(gate.employee, 'finance.assets_fields_purge');
  if (!allowed && gate.employee.role !== 'admin') {
    return { ok: false as const, error: '沒有永久刪除資產欄位的權限' };
  }
  const { buildFieldPurgeBackup } = await import('./purge-backup');
  const doc = await buildFieldPurgeBackup(fieldId);
  if (!doc) return { ok: false as const, error: '找不到欄位' };
  const fileName = `asset-field-purge-preview-${fieldId.slice(0, 8)}.json`;
  return {
    ok: true as const,
    fileName,
    json: JSON.stringify(doc, null, 2),
  };
}

export async function recognizeFieldPurgeBackupAction(jsonText: string) {
  const gate = await requireFieldAdmin();
  if (!gate.ok) return gate;
  try {
    const raw = JSON.parse(jsonText) as unknown;
    const { recognizePurgeFromBackup } = await import('./purge-backup');
    return { ok: true as const, ...recognizePurgeFromBackup(raw) };
  } catch {
    return { ok: false as const, error: 'JSON 無法解析' };
  }
}
