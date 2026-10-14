export const ASSET_STATUSES = ['in_custody', 'lent', 'merged', 'sold', 'scrapped'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_custody: '保管中',
  lent: '出借中',
  merged: '已併入',
  sold: '已出售',
  scrapped: '已報廢',
};

/** Statuses still in the register (can be transferred, counted at inventory). */
export const ACTIVE_ASSET_STATUSES: readonly AssetStatus[] = ['in_custody', 'lent'];

export const ASSET_TRANSFER_TYPES = ['custodian_change', 'lend', 'merge', 'sell', 'scrap', 'other'] as const;
export type AssetTransferType = (typeof ASSET_TRANSFER_TYPES)[number];

export const ASSET_TRANSFER_TYPE_LABELS: Record<AssetTransferType, string> = {
  custodian_change: '保管人異動',
  lend: '借出',
  merge: '合併',
  sell: '出售',
  scrap: '報廢',
  other: '其他',
};

/** Register status after an approved row; null keeps the current status. */
export const STATUS_AFTER_TRANSFER: Record<AssetTransferType, AssetStatus | null> = {
  custodian_change: 'in_custody',
  lend: 'lent',
  merge: 'merged',
  sell: 'sold',
  scrap: 'scrapped',
  other: null,
};

/** 資產照片 are stored as ordinary attachments, told apart from 其他附件 by this file-name prefix. */
export const PHOTO_PREFIX = '資產照片-';

export const MAX_ASSET_TRANSFER_LINES = 30;
export const MAX_LOCATION_LENGTH = 30;

/** Shown above the form, as in the paper form's 填表說明. */
export const ASSET_REGISTER_LINK = {
  label: '財產保管清冊-1150630',
  url: 'https://turingdrive01.sharepoint.com/:x:/s/gad/IQAHJFwQBGWkQYqMC_t57-HTAdcG_eWBlejMJAlWTqKtmLE?e=3OMe7n',
};
