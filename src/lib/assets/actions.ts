'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentEmployee } from '@/lib/auth/current-employee';
import { MAX_ASSET_FILE_BYTES, parseAssetWorkbook, type ParsedAssetRow } from '@/lib/assets/parse-asset-workbook';
import * as service from '@/lib/assets/service';
import { fail, type Failure } from '@/lib/workflow/tx';

export async function upsertAsset(input: service.AssetInput): Promise<service.UpsertAssetResult> {
  const result = await service.upsertAsset(await getCurrentEmployee(), input);
  if (result.ok) revalidatePath('/assets');
  return result;
}

export async function importAssetsFromExcel(formData: FormData): Promise<{ ok: true; summary: service.ImportSummary } | Failure> {
  const actor = await getCurrentEmployee();
  if (!service.canMaintainRegister(actor)) return fail('forbidden', '只有財會或管理員可以維護財產清冊');
  const file = formData.get('file');
  if (!(file instanceof File)) return fail('validation', '請選擇檔案');
  if (file.size > MAX_ASSET_FILE_BYTES) return fail('validation', 'Excel 檔案不可超過 5 MB');
  let rows: ParsedAssetRow[];
  try {
    rows = await parseAssetWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch {
    return fail('validation', '無法解析此 Excel 檔案，請確認格式是否正確');
  }

  const errors: { row: number; reason: string }[] = [];
  const valid: service.ImportRow[] = [];
  for (const r of rows) {
    if (r.quantity === null) errors.push({ row: r.rowNumber, reason: '數量需為正整數' });
    else if (r.status === 'invalid') errors.push({ row: r.rowNumber, reason: '狀態需為 保管中／出借中／已併入／已出售／已報廢' });
    else if (r.custodianEmployeeCode === '') errors.push({ row: r.rowNumber, reason: '請填寫保管人工號' });
    else valid.push({ ...r, quantity: r.quantity, status: r.status });
  }
  const result = await service.importAssets(actor, valid);
  if (!result.ok) return result;
  revalidatePath('/assets');
  return {
    ok: true,
    summary: { ...result.summary, errors: [...errors, ...result.summary.errors].sort((a, b) => a.row - b.row) },
  };
}

export async function previewPropertyRegisterImport(formData: FormData) {
  const actor = await getCurrentEmployee();
  if (!service.canMaintainRegister(actor)) return { ok: false as const, error: '只有財會或管理員可以匯入財產清冊' };
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false as const, error: '請選擇檔案' };
  const { MAX_PROPERTY_FILE_BYTES } = await import('@/lib/assets/parse-property-workbook');
  if (file.size > MAX_PROPERTY_FILE_BYTES) return { ok: false as const, error: '檔案過大' };
  try {
    const { buildPropertyImportPreview } = await import('@/lib/assets/property-import');
    const preview = await buildPropertyImportPreview(Buffer.from(await file.arrayBuffer()));
    // Do not send every row to the client — summary + unresolved + sample failures.
    return {
      ok: true as const,
      preview: {
        sheetName: preview.sheetName,
        counts: preview.counts,
        unresolvedCustodians: preview.unresolvedCustodians,
        unresolvedDepartments: preview.unresolvedDepartments,
        issueCount: preview.issues.length,
        sampleIssues: preview.issues.slice(0, 20),
        sampleFails: preview.rows
          .filter((r) => r.action === 'fail' || r.action === 'skip')
          .slice(0, 30)
          .map((r) => ({ row: r.rowNumber, tag: r.tag, action: r.action, reason: r.reason })),
      },
      fileName: file.name,
    };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : '無法解析此 Excel',
    };
  }
}

export async function confirmPropertyRegisterImport(formData: FormData) {
  const actor = await getCurrentEmployee();
  if (!service.canMaintainRegister(actor)) return { ok: false as const, error: '只有財會或管理員可以匯入財產清冊' };
  const file = formData.get('file');
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '');
  if (!(file instanceof File)) return { ok: false as const, error: '請選擇檔案' };
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return { ok: false as const, error: '缺少匯入識別' };
  const { confirmPropertyImport } = await import('@/lib/assets/property-import');
  const res = await confirmPropertyImport({
    actor,
    buffer: Buffer.from(await file.arrayBuffer()),
    idempotencyKey,
    sourceWorkbook: file.name,
  });
  if (!res.ok) return res;
  revalidatePath('/assets');
  revalidatePath('/assets/mine');
  revalidatePath('/assets/import');
  return res;
}
