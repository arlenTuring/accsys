import type { ApproverBlock, FlowDef } from '@/lib/approval/flow/types';
import {
  ASSET_REGISTER_LINK,
  ASSET_TRANSFER_TYPE_LABELS,
  ASSET_TRANSFER_TYPES,
  MAX_ASSET_TRANSFER_LINES,
  MAX_LOCATION_LENGTH,
} from '@/lib/asset-transfers/constants';
import type { MigratedForm } from './types';

// Batch 4: 資產異動申請單. Field ids follow the hard-coded form's input; the
// register link does what its service did (lock and check the assets, one
// pending form per asset, custodian coverage, write the register on approval).
// Flow: custodians, then their unit managers (manager of each custodian's
// department); when every unit manager is the applicant, 總經理 (or 董事長
// when the applicant is the 總經理) signs as well.

const INSTRUCTIONS = `一、異動類型說明：
1. 保管人異動：人員離職、職務交接、資產領用至專案等需移轉保管人之情形。
2. 借出：借給外部單位，將於資產清冊註記「出借中」。需請外部單位出具相關證明。
3. 合併：非列帳資產(低於8萬以下資產,例如：超音波雷達、IMU…等)安裝於車輛且未來不再拆下，即可併入車輛中，不列入年度盤點範圍。
4. 出售：資產經核准後出售給客戶或第三方，將於資產清冊註記「已出售」不列入年度盤點範圍。
5. 報廢：設備損壞需報廢處理。填單後請保留資產，由管理部統一處理。
6. 其他：非上述情境之異動，請於備註欄位補充說明原因。

二、填表流程與注意事項：
1. 填表前請核對設備上的「財產編號」標籤，確保編號與品名正確無誤。
2. 時效性：請於異動發生後7個工作日內，完成填表送交管理部，以維持清冊即時性。

三、資產盤點清冊：
${ASSET_REGISTER_LINK.label}
${ASSET_REGISTER_LINK.url}

四、備註：若財產標籤損毀、脫落，保管人應主動通知總務補發並重新張貼，嚴禁擅自塗改或撕除。`;

const typeOptions = ASSET_TRANSFER_TYPES.map((t) => ({ value: t, label: ASSET_TRANSFER_TYPE_LABELS[t] }));
const MANAGERS = ['original_manager', 'new_manager', 'other_manager'];
const otherFilled = { field: 'otherCustodianEmployeeId', op: 'filled' as const };

const approver = (id: string, label: string, source: ApproverBlock['source'], extra: Partial<ApproverBlock> = {}): ApproverBlock => ({
  id,
  type: 'approver',
  label,
  source,
  onUnresolved: 'block',
  ...extra,
});
const custodian = (id: string, label: string, fieldId: string) => approver(id, label, { kind: 'form_party', party: 'field_employee', fieldId });
const unitManager = (id: string, label: string, fieldId: string) => approver(id, label, { kind: 'department_manager', of: 'field', fieldId, levelsUp: 0 });
const onlyWithOther = (id: string, label: string, block: ApproverBlock): FlowDef['blocks'][number] => ({
  id,
  type: 'condition',
  label,
  branches: [{ id: `${id}_yes`, label: '有填其他保管人', when: otherFilled, blocks: [block] }],
  otherwise: { label: '沒有其他保管人', blocks: [] },
});

export const ASSET_TRANSFER_FLOW: FlowDef = {
  version: 1,
  options: { skipApplicant: true, skipFiler: true, collapseDuplicates: true, whenEmpty: 'block' },
  blocks: [
    custodian('original_custodian', '原保管人', 'originalCustodianEmployeeId'),
    custodian('new_custodian', '新保管人', 'newCustodianEmployeeId'),
    onlyWithOther('has_other_custodian', '其他保管人', custodian('other_custodian', '其他保管人', 'otherCustodianEmployeeId')),
    unitManager('original_manager', '原保管單位主管', 'originalCustodianEmployeeId'),
    unitManager('new_manager', '新保管單位主管', 'newCustodianEmployeeId'),
    onlyWithOther('has_other_manager', '其他保管單位主管', unitManager('other_manager', '其他保管單位主管', 'otherCustodianEmployeeId')),
    approver('general_manager', '總經理', { kind: 'job_role', jobRole: 'general_manager', scope: 'company' }, { onUnresolved: 'skip', fallbackFor: MANAGERS }),
    approver('chairman', '董事長', { kind: 'job_role', jobRole: 'chairman', scope: 'company' }, { fallbackFor: [...MANAGERS, 'general_manager'] }),
  ],
};

const PARTY_HINT = '系統將於資產異動時自動發送簽核通知；所屬部門主管會自動加入簽核。';

export const ASSET_TRANSFER_FORM: MigratedForm = {
  key: 'asset-transfer',
  name: '資產異動申請單',
  description: '財產保管人異動、借出、合併、出售或報廢；核准後自動更新財產清冊。',
  categoryKey: 'asset',
  numberPrefix: 'AT',
  sortOrder: 1,
  legacyFormType: 'asset_transfer',
  schema: {
    version: 1,
    assetRegister: {
      table: 'items',
      columns: { asset: 'assetId', reason: 'reason', newCustodian: 'newCustodianEmployeeId', newLocation: 'newLocation' },
      custodians: { original: 'originalCustodianEmployeeId', new: 'newCustodianEmployeeId', other: 'otherCustodianEmployeeId' },
    },
    sections: [
      {
        id: 'guide',
        title: '',
        description: '',
        fields: [{ id: 'instructions', type: 'notice', label: '資產異動單填表說明', width: 4, text: INSTRUCTIONS }],
      },
      {
        id: 'usage',
        title: '使用單位',
        description: '',
        fields: [
          { id: 'useDepartmentId', type: 'department', label: '使用部門', required: true, width: 2, showInHeader: true },
          { id: 'useBudgetCodeId', type: 'budget_code', label: '使用專案/客戶名稱', required: true, width: 2 },
          {
            id: 'transferTypes',
            type: 'checkboxes',
            label: '異動說明 (可複選)',
            required: true,
            width: 2,
            showInHeader: true,
            options: typeOptions.map((o) => (o.value === 'other' ? { ...o, label: '其他：請於備註欄補充說明' } : o)),
            minSelected: 1,
            maxSelected: null,
          },
          {
            id: 'remark',
            type: 'textarea',
            label: '備註',
            help: '勾選「其他」時，請於備註欄補充說明異動原因。',
            width: 2,
            maxLength: 1000,
            rows: 4,
            requiredWhen: { field: 'transferTypes', op: 'contains', value: 'other' },
          },
        ],
      },
      {
        id: 'assets',
        title: '申請資料',
        description: '請確認財產編號是否正確；選擇財產後會帶入原保管人與原地點。',
        fields: [
          {
            id: 'items',
            type: 'table',
            label: '財產明細',
            required: true,
            width: 4,
            minRows: 1,
            maxRows: MAX_ASSET_TRANSFER_LINES,
            totalColumn: null,
            columns: [
              { id: 'assetId', label: '財產編號', type: 'asset', required: true, unique: true },
              { id: 'reason', label: '異動原因', type: 'select', required: true, options: typeOptions, pickFrom: { field: 'transferTypes', coverAll: true } },
              { id: 'newCustodianEmployeeId', label: '新保管人員', type: 'employee', required: true },
              { id: 'newLocation', label: '新保管地點', type: 'text', required: true, maxLength: MAX_LOCATION_LENGTH },
            ],
          },
        ],
      },
      {
        id: 'parties',
        title: '保管人',
        description: '每一列的目前保管人需為原保管人或其他保管人，新保管人員需為新保管人或其他保管人。',
        fields: [
          { id: 'originalCustodianEmployeeId', type: 'employee', label: '原保管人', help: PARTY_HINT, required: true, width: 1 },
          {
            id: 'newCustodianEmployeeId',
            type: 'employee',
            label: '新保管人',
            help: `${PARTY_HINT}若沒有異動保管人，請填入「原保管人」即可。`,
            required: true,
            width: 1,
          },
          { id: 'otherCustodianEmployeeId', type: 'employee', label: '其他保管人', help: `如有其他保管人，請務必填寫。${PARTY_HINT}`, width: 2 },
        ],
      },
      {
        id: 'files',
        title: '資產照片與附件',
        description: '',
        fields: [
          {
            id: 'attachments',
            type: 'attachments',
            label: '資產照片與其他附件',
            help: '資產照片需拍到「財產編號」及「完整資產外觀」，建議拍1~3張；如借給外部單位，請一併上傳外部單位出具的證明。',
            required: true,
            width: 4,
          },
        ],
      },
    ],
  },
  flow: ASSET_TRANSFER_FLOW,
};
