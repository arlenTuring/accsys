import {
  ASSET_TRANSFER_TYPES,
  ASSET_TRANSFER_TYPE_LABELS,
  MAX_ASSET_TRANSFER_LINES,
  MAX_LOCATION_LENGTH,
  type AssetTransferType,
} from '@/lib/asset-transfers/constants';
import { codes, collect, invalid, text, uuidOrBlank } from '@/lib/seal-requests/validate';

// Shared by the form (instant feedback) and the server (authoritative check).
// Whether the referenced assets / employees exist is checked by the server.
// The unit managers are not part of the input: the server takes them from the
// custodians' departments so the applicant cannot pick their own approvers.

export type AssetTransferItemInput = {
  assetId: string;
  reason: string;
  newCustodianEmployeeId: string;
  newLocation: string;
};

export type AssetTransferInput = {
  departmentId: string;
  useDepartmentId: string;
  useBudgetCodeId: string;
  transferTypes: string[];
  remark: string;
  items: AssetTransferItemInput[];
  originalCustodianEmployeeId: string;
  newCustodianEmployeeId: string;
  /** '' when there is none. */
  otherCustodianEmployeeId: string;
};

export type NormalizedAssetTransferItem = {
  assetId: string;
  reason: AssetTransferType;
  newCustodianEmployeeId: string;
  newLocation: string;
};

export type NormalizedAssetTransfer = {
  departmentId: string;
  useDepartmentId: string;
  useBudgetCodeId: string;
  transferTypes: AssetTransferType[];
  remark: string | null;
  items: NormalizedAssetTransferItem[];
  originalCustodianEmployeeId: string;
  newCustodianEmployeeId: string;
  otherCustodianEmployeeId: string | null;
};

export type ParseResult = { ok: true; value: NormalizedAssetTransfer } | { ok: false; error: string };

const required = (value: unknown, message: string) => uuidOrBlank(value) || invalid(message);
const optional = (value: unknown) => uuidOrBlank(value) || null;

export function parseAssetTransferInput(input: AssetTransferInput): ParseResult {
  return collect(() => {
    if (!input || typeof input !== 'object') invalid('表單內容不正確');
    const departmentId = required(input.departmentId, '請選擇申請人部門');
    const useDepartmentId = required(input.useDepartmentId, '請選擇使用部門');
    const useBudgetCodeId = required(input.useBudgetCodeId, '請選擇使用專案/客戶名稱');

    const picked = codes(input.transferTypes, '異動說明');
    if (picked.length === 0) invalid('請至少勾選一項異動說明');
    if (picked.some((t) => !(ASSET_TRANSFER_TYPES as readonly string[]).includes(t))) invalid('異動說明有不正確的選項');
    const transferTypes = ASSET_TRANSFER_TYPES.filter((t) => picked.includes(t));

    if (input.remark !== undefined && input.remark !== null && typeof input.remark !== 'string') invalid('備註格式不正確');
    const remark = (input.remark ?? '').trim();
    if (remark.length > 1000) invalid('備註不可超過 1000 字');
    if (transferTypes.includes('other') && remark === '') invalid('勾選「其他」時，請於備註欄補充說明異動原因');

    if (!Array.isArray(input.items) || input.items.length === 0) invalid('請至少填寫一列申請資料');
    if (input.items.length > MAX_ASSET_TRANSFER_LINES) invalid(`申請資料最多 ${MAX_ASSET_TRANSFER_LINES} 列`);
    const seen = new Set<string>();
    const items = input.items.map((raw, idx): NormalizedAssetTransferItem => {
      const at = `申請資料第 ${idx + 1} 列`;
      if (!raw || typeof raw !== 'object') invalid(`${at}格式不正確`);
      const assetId = uuidOrBlank(raw.assetId) || invalid(`請選擇${at}的財產編號`);
      if (seen.has(assetId)) invalid(`${at}的財產編號重複了`);
      seen.add(assetId);
      const reason = transferTypes.find((t) => t === raw.reason) ?? invalid(`${at}的異動原因需為已勾選的異動說明之一`);
      const newCustodianEmployeeId = uuidOrBlank(raw.newCustodianEmployeeId) || invalid(`請選擇${at}的新保管人員`);
      const newLocation = text(raw.newLocation, `${at}的新保管地點`, MAX_LOCATION_LENGTH);
      return { assetId, reason, newCustodianEmployeeId, newLocation };
    });
    for (const t of transferTypes) {
      if (!items.some((i) => i.reason === t)) {
        invalid(`已勾選「${ASSET_TRANSFER_TYPE_LABELS[t]}」，但申請資料沒有任何一列的異動原因是「${ASSET_TRANSFER_TYPE_LABELS[t]}」`);
      }
    }

    return {
      departmentId,
      useDepartmentId,
      useBudgetCodeId,
      transferTypes,
      remark: remark || null,
      items,
      originalCustodianEmployeeId: required(input.originalCustodianEmployeeId, '請選擇原保管人'),
      newCustodianEmployeeId: required(input.newCustodianEmployeeId, '請選擇新保管人（沒有異動保管人請填原保管人）'),
      otherCustodianEmployeeId: optional(input.otherCustodianEmployeeId),
    };
  });
}

/**
 * Every affected custodian must sign: each row's current custodian is the
 * 原保管人 or 其他保管人, each row's new custodian the 新保管人 or 其他保管人.
 * Conversely every named custodian must appear on a row: their unit manager
 * counts as an independent signer, so an uninvolved person must not be able
 * to stand in for the general-manager escalation.
 * `custodianOf` maps asset id → current custodian (from the register).
 */
export function checkCustodianCoverage(
  form: Pick<
    NormalizedAssetTransfer,
    'items' | 'originalCustodianEmployeeId' | 'newCustodianEmployeeId' | 'otherCustodianEmployeeId'
  >,
  custodianOf: (assetId: string) => string,
  tagOf: (assetId: string) => string
): string | null {
  for (const item of form.items) {
    const current = custodianOf(item.assetId);
    if (current !== form.originalCustodianEmployeeId && current !== form.otherCustodianEmployeeId) {
      return `財產 ${tagOf(item.assetId)} 的目前保管人不是所填的原保管人或其他保管人，請修正後再送出`;
    }
    if (item.newCustodianEmployeeId !== form.newCustodianEmployeeId && item.newCustodianEmployeeId !== form.otherCustodianEmployeeId) {
      return `財產 ${tagOf(item.assetId)} 的新保管人員需為所填的新保管人或其他保管人`;
    }
  }
  if (!form.items.some((i) => custodianOf(i.assetId) === form.originalCustodianEmployeeId)) {
    return '原保管人需為至少一項財產目前的保管人';
  }
  if (!form.items.some((i) => i.newCustodianEmployeeId === form.newCustodianEmployeeId)) {
    return '新保管人需為至少一項財產的新保管人員（沒有異動保管人請填原保管人）';
  }
  const other = form.otherCustodianEmployeeId;
  if (other && !form.items.some((i) => custodianOf(i.assetId) === other || i.newCustodianEmployeeId === other)) {
    return '其他保管人需為至少一項財產目前或新的保管人，沒有請留空';
  }
  return null;
}
