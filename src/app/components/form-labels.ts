export const STATUS_LABELS: Record<string, string> = {
  pending_approval: '簽核中',
  approved: '已核准',
  returned: '已退回（待修改）',
  withdrawn: '已撤回',
};

export const STATUS_BADGE: Record<string, string> = {
  pending_approval: 'badge-pending',
  approved: 'badge-approved',
  returned: 'badge-returned',
  withdrawn: 'badge-withdrawn',
};

export const ROLE_LABELS: Record<string, string> = {
  department_manager: '申請單位主管',
  budget_owner: '預算負責人',
  general_manager: '總經理',
  chairman: '董事長',
  applicant_confirmation: '申請人確認',
  original_custodian: '原保管人',
  new_custodian: '新保管人',
  other_custodian: '其他保管人',
  original_custodian_manager: '原保管單位主管',
  new_custodian_manager: '新保管單位主管',
  other_custodian_manager: '其他保管單位主管',
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  pending: '待簽核',
  approved: '已核准',
  returned: '已退回',
  auto_approved: '由系統代簽',
  skipped: '略過',
};
