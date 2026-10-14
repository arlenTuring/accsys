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
