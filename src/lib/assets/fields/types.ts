export const ASSET_FIELD_TYPES = [
  'text',
  'textarea',
  'integer',
  'decimal',
  'date',
  'select',
  'multiselect',
  'tristate',
  'employee',
  'department',
  'project',
] as const;
export type AssetFieldType = (typeof ASSET_FIELD_TYPES)[number];

export const ASSET_FIELD_SECTIONS = [
  'basic',
  'accounting',
  'custody',
  'status_qty',
  'notes',
  'inventory',
  'custom',
] as const;
export type AssetFieldSection = (typeof ASSET_FIELD_SECTIONS)[number];

export type FieldOption = { id: string; label: string; active?: boolean };

export type AssetFieldDefinitionDto = {
  id: string;
  stableKey: string;
  label: string;
  help: string;
  fieldType: AssetFieldType;
  section: AssetFieldSection;
  sortOrder: number;
  required: boolean;
  showInList: boolean;
  searchable: boolean;
  filterable: boolean;
  exportable: boolean;
  status: 'active' | 'hidden' | 'deleted';
  options: FieldOption[];
  viewPermission: string | null;
  editPermission: string | null;
  systemBinding: string | null;
  storageScope: 'asset' | 'inventory';
  version: number;
  hiddenAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  filledCount?: number;
};

export type CreateAssetFieldInput = {
  label: string;
  help?: string;
  fieldType: AssetFieldType;
  section: AssetFieldSection;
  sortOrder?: number;
  required?: boolean;
  showInList?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  exportable?: boolean;
  options?: FieldOption[];
  storageScope?: 'asset' | 'inventory';
  stableKey?: string;
};

export type UpdateAssetFieldInput = {
  id: string;
  expectedVersion: number;
  label?: string;
  help?: string;
  fieldType?: AssetFieldType;
  section?: AssetFieldSection;
  sortOrder?: number;
  required?: boolean;
  showInList?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  exportable?: boolean;
  options?: FieldOption[];
};

export type PurgeImpact = {
  fieldId: string;
  label: string;
  fieldType: string;
  version: number;
  status: string;
  systemBinding: string | null;
  assetFilledCount: number;
  inventoryFilledCount: number;
  dependencies: string[];
  willDelete: string[];
  willNotDelete: string[];
};

/** Client-facing notice after purge: download server-side backup via job id. */
export type PurgeResult = {
  jobId: string;
  backupPath: string;
  impact: PurgeImpact;
};
