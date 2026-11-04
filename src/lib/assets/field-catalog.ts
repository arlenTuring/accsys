import type { AssetFieldSection, AssetFieldType } from '@/lib/assets/fields/types';

/**
 * Canonical mapping of the company Excel sheet「1150630財產保管清冊」
 * (header row 4) into core columns, configurable asset fields, or inventory.
 *
 * Labels preserve Excel wording; display may wrap but definitions stay stable.
 */

export type ExcelColumnBinding =
  | {
      kind: 'core';
      /** assets.* column */
      column:
        | 'tag'
        | 'name'
        | 'quantity'
        | 'status'
        | 'location'
        | 'remark'
        | 'itemKind'
        | 'description'
        | 'unit'
        | 'custodyDepartment'
        | 'custodian';
    }
  | {
      kind: 'asset_field';
      stableKey: string;
      fieldType: AssetFieldType;
      section: AssetFieldSection;
      systemBinding?: string;
    }
  | {
      kind: 'inventory_field';
      stableKey: string;
      fieldType: AssetFieldType;
      /** Special shortcut for physical qty column. */
      mapsToPhysicalQuantity?: boolean;
    };

export type ExcelSourceColumn = {
  /** 1-based Excel column index on sheet 1150630財產保管清冊 */
  excelCol: number;
  excelHeader: string;
  /** Normalized header used for matching (collapse whitespace / newlines). */
  matchKey: string;
  binding: ExcelColumnBinding;
  /** Seed label shown in the field editor (may equal excelHeader). */
  label: string;
  help?: string;
};

function normHeader(h: string): string {
  return h
    .replace(/\r\n|\n|\r/g, '')
    .replace(/\s+/g, '')
    .replace(/[／]/g, '/')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

/** The 23 business columns from the source workbook — no blank trailing columns. */
export const PROPERTY_REGISTER_COLUMNS: ExcelSourceColumn[] = [
  {
    excelCol: 1,
    excelHeader: '會計科目',
    matchKey: normHeader('會計科目'),
    label: '會計科目',
    binding: {
      kind: 'asset_field',
      stableKey: 'accounting_subject',
      fieldType: 'text',
      section: 'accounting',
    },
  },
  {
    excelCol: 2,
    excelHeader: '狀態',
    matchKey: normHeader('狀態'),
    label: '狀態',
    binding: { kind: 'core', column: 'status' },
  },
  {
    excelCol: 3,
    excelHeader: '財產編號',
    matchKey: normHeader('財產編號'),
    label: '財產編號',
    binding: { kind: 'core', column: 'tag' },
  },
  {
    excelCol: 4,
    excelHeader: '取得時間',
    matchKey: normHeader('取得時間'),
    label: '取得時間',
    help: '支援民國日期；無法解析時須人工修正，系統不猜測。',
    binding: {
      kind: 'asset_field',
      stableKey: 'acquired_on',
      fieldType: 'date',
      section: 'accounting',
    },
  },
  {
    excelCol: 5,
    excelHeader: '傳票編號',
    matchKey: normHeader('傳票編號'),
    label: '傳票編號',
    help: '以文字保存，保留前導零與連字號。',
    binding: {
      kind: 'asset_field',
      stableKey: 'voucher_no',
      fieldType: 'text',
      section: 'accounting',
    },
  },
  {
    excelCol: 6,
    excelHeader: '項目種類',
    matchKey: normHeader('項目種類'),
    label: '項目種類',
    binding: { kind: 'core', column: 'itemKind' },
  },
  {
    excelCol: 7,
    excelHeader: '設備或生財器具名稱',
    matchKey: normHeader('設備或生財器具名稱'),
    label: '設備或生財器具名稱',
    binding: { kind: 'core', column: 'name' },
  },
  {
    excelCol: 8,
    excelHeader: '說明',
    matchKey: normHeader('說明'),
    label: '說明',
    binding: { kind: 'core', column: 'description' },
  },
  {
    excelCol: 9,
    excelHeader: '帳載數量',
    matchKey: normHeader('帳載數量'),
    label: '帳載數量',
    binding: { kind: 'core', column: 'quantity' },
  },
  {
    excelCol: 10,
    excelHeader: '實盤數量',
    matchKey: normHeader('實盤數量'),
    label: '實盤數量',
    binding: {
      kind: 'inventory_field',
      stableKey: 'physical_quantity',
      fieldType: 'integer',
      mapsToPhysicalQuantity: true,
    },
  },
  {
    excelCol: 11,
    excelHeader: '單位',
    matchKey: normHeader('單位'),
    label: '單位',
    binding: { kind: 'core', column: 'unit' },
  },
  {
    excelCol: 12,
    excelHeader: '保管部門',
    matchKey: normHeader('保管部門'),
    label: '保管部門',
    help: '獨立於保管人現職部門；員工調部門不會自動改寫此欄。',
    binding: { kind: 'core', column: 'custodyDepartment' },
  },
  {
    excelCol: 13,
    excelHeader: '保管人',
    matchKey: normHeader('保管人'),
    label: '保管人',
    binding: { kind: 'core', column: 'custodian' },
  },
  {
    excelCol: 14,
    excelHeader: '保管地點',
    matchKey: normHeader('保管地點'),
    label: '保管地點',
    binding: { kind: 'core', column: 'location' },
  },
  {
    excelCol: 15,
    excelHeader: '專案',
    matchKey: normHeader('專案'),
    label: '專案',
    binding: {
      kind: 'asset_field',
      stableKey: 'project_label',
      fieldType: 'text',
      section: 'custody',
    },
  },
  {
    excelCol: 16,
    excelHeader: '備註',
    matchKey: normHeader('備註'),
    label: '備註',
    binding: { kind: 'core', column: 'remark' },
  },
  {
    excelCol: 17,
    excelHeader: '已貼財編',
    matchKey: normHeader('已貼財編'),
    label: '已貼財編',
    binding: {
      kind: 'asset_field',
      stableKey: 'tag_affixed',
      fieldType: 'tristate',
      section: 'notes',
    },
  },
  {
    excelCol: 18,
    excelHeader: '已處分傳票編號',
    matchKey: normHeader('已處分傳票編號'),
    label: '已處分傳票編號',
    binding: {
      kind: 'asset_field',
      stableKey: 'disposal_voucher_no',
      fieldType: 'text',
      section: 'accounting',
    },
  },
  {
    excelCol: 19,
    excelHeader: '異動需求',
    matchKey: normHeader('異動需求'),
    label: '異動需求',
    binding: {
      kind: 'asset_field',
      stableKey: 'change_request',
      fieldType: 'textarea',
      section: 'notes',
    },
  },
  {
    excelCol: 20,
    excelHeader: '帳務是否與實際財產相符(V/X)',
    matchKey: normHeader('帳務是否與實際財產相符(V/X)'),
    label: '帳務是否與實際財產相符',
    help: '盤點批次欄位；不會覆寫上一期盤點。',
    binding: {
      kind: 'inventory_field',
      stableKey: 'inv_matches_books',
      fieldType: 'tristate',
    },
  },
  {
    excelCol: 21,
    excelHeader: '是否已閒置且已無使用需要可出售或移轉(V/X)',
    matchKey: normHeader('是否已閒置且已無使用需要可出售或移轉(V/X)'),
    label: '是否已閒置且已無使用需要可出售或移轉',
    help: '盤點建議，不等於正式移轉或報廢。',
    binding: {
      kind: 'inventory_field',
      stableKey: 'inv_idle_disposable',
      fieldType: 'tristate',
    },
  },
  {
    excelCol: 22,
    excelHeader: '是否已不堪使用需報廢(V/X)',
    matchKey: normHeader('是否已不堪使用需報廢(V/X)'),
    label: '是否已不堪使用需報廢',
    help: '盤點建議報廢 ≠ 正式報廢流程。',
    binding: {
      kind: 'inventory_field',
      stableKey: 'inv_unusable_scrap',
      fieldType: 'tristate',
    },
  },
  {
    excelCol: 23,
    excelHeader: '請註記如何處理(例如:捐贈、出售等)',
    matchKey: normHeader('請註記如何處理(例如:捐贈、出售等)'),
    label: '請註記如何處理',
    binding: {
      kind: 'inventory_field',
      stableKey: 'inv_disposition_note',
      fieldType: 'textarea',
    },
  },
];

export function normalizeExcelHeader(header: string): string {
  return normHeader(header);
}

export function findColumnByHeader(header: string): ExcelSourceColumn | undefined {
  const key = normHeader(header);
  return PROPERTY_REGISTER_COLUMNS.find(
    (c) => c.matchKey === key || key.startsWith(c.matchKey) || c.matchKey.startsWith(key)
  );
}

export function classifyFieldCounts() {
  const core = PROPERTY_REGISTER_COLUMNS.filter((c) => c.binding.kind === 'core').length;
  const assetField = PROPERTY_REGISTER_COLUMNS.filter((c) => c.binding.kind === 'asset_field').length;
  const inventory = PROPERTY_REGISTER_COLUMNS.filter((c) => c.binding.kind === 'inventory_field').length;
  return { total: PROPERTY_REGISTER_COLUMNS.length, core, assetField, inventory };
}
