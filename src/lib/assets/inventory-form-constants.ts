import type { AssetStatus } from '@/lib/asset-transfers/constants';

export const HANDOVER_WORKBOOK_MARKER = 'handover_form';

export type LocationAction = 'agree_current' | 'change_needed';
export type ChangeRequestType =
  | 'none'
  | 'location_change'
  | 'status_change'
  | 'custodian_transfer'
  | 'scrap_or_idle';
export type ExistenceFact = 'exists' | 'exists_damaged' | 'missing';

export const EXISTENCE_FACT_LABELS: Record<ExistenceFact, string> = {
  exists: '物品存在（實盤正常）',
  exists_damaged: '物品存在（損壞／待修／不堪用）',
  missing: '未尋獲此物品（盤虧／遺失）',
};

export const LOCATION_ACTION_LABELS: Record<LocationAction, string> = {
  agree_current: '同意現在位置與保管狀態無誤',
  change_needed: '需要更改位置或提出異動',
};

export const CHANGE_TYPE_LABELS: Record<ChangeRequestType, string> = {
  none: '無異動（維持現狀）',
  location_change: '更改存放位置',
  status_change: '變更財產狀態（如改為出借中）',
  custodian_transfer: '需移轉保管人（另起或同步異動）',
  scrap_or_idle: '閒置待移轉或不堪使用需報廢',
};

export type HandoverBatchMeta = {
  formNumber: string;
  custodianEmployeeId: string;
  custodianEmployeeCode: string;
  custodianName: string;
  custodianDepartmentName: string;
  inspectorEmployeeId: string;
  inspectorEmployeeCode: string;
  inspectorName: string;
  /** 清點人指定的點交／清點時間 (ISO or YYYY-MM-DDTHH:mm) */
  scheduledAt: string;
  meetingLocation: string;
  instructions: string;
  dispatchedAt: string;
  completedByEmployeeId?: string | null;
  completedByName?: string | null;
};

export type HandoverLineAnswers = {
  assetName: string;
  itemKind: string | null;
  description: string | null;
  bookQuantity: number;
  unit: string | null;
  originalLocation: string;
  originalStatus: AssetStatus;
  originalCustodianId: string;
  originalCustodianName: string;
  /** 位置是否同意或需更改異動 */
  locationAction: LocationAction;
  /** 點交確認後之現在位置（若同意現在位置則等於 originalLocation；若需更改則為新位置） */
  confirmedLocation: string;
  changeType: ChangeRequestType;
  confirmedStatus: AssetStatus;
  /** 物品存在事實 */
  existenceFact: ExistenceFact;
  /** 財產擁有者（保管人）其他說明 */
  custodianNote: string;
  /** 清點人其他說明 */
  inspectorNote: string;
  /** 財產擁有者（保管人）對此條明細之確認 */
  custodianConfirmed: boolean;
  custodianConfirmedAt: string | null;
  custodianConfirmedById: string | null;
  custodianConfirmedByName: string | null;
  /** 清點人對此條明細之確認 */
  inspectorConfirmed: boolean;
  inspectorConfirmedAt: string | null;
  inspectorConfirmedById: string | null;
  inspectorConfirmedByName: string | null;
};

export type HandoverLineItem = {
  id: string;
  batchId: string;
  lineNo: number;
  assetId: string | null;
  assetTag: string;
  physicalQuantity: number;
  state: HandoverLineAnswers;
};

export type HandoverFormSummary = {
  id: string;
  formNumber: string;
  label: string;
  status: 'open' | 'locked';
  custodianEmployeeId: string;
  custodianEmployeeCode: string;
  custodianName: string;
  custodianDepartmentName: string;
  inspectorEmployeeId: string;
  inspectorEmployeeCode: string;
  inspectorName: string;
  scheduledAt: string;
  meetingLocation: string;
  instructions: string;
  dispatchedAt: string;
  lockedAt: Date | null;
  totalLines: number;
  custodianConfirmedLines: number;
  inspectorConfirmedLines: number;
  bothConfirmedLines: number;
  allLinesConfirmedByBoth: boolean;
};

export type HandoverFormDetail = HandoverFormSummary & {
  lines: HandoverLineItem[];
  canActAsCustodian: boolean;
  canActAsInspector: boolean;
};
