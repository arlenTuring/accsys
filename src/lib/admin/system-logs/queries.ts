import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { PERMISSIONS, type Permission } from '@/lib/authz/permissions';
import { getDb } from '@/lib/db';
import {
  aiConversations,
  aiMessages,
  auditEvents,
  departments,
  employees,
} from '@/lib/db/schema';

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatLogTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return timeFmt.format(typeof d === 'string' ? new Date(d) : d);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '—';
  if (role === 'admin') return '系統管理員';
  if (role === 'finance') return '財會';
  if (role === 'staff') return '一般員工';
  return role;
}

export function permissionLabel(code: string): string {
  const def = PERMISSIONS[code as Permission];
  return def ? def.label : code;
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    // 權限與帳號異動
    'employee.role_changed': '變更人員權限角色',
    'employee.access_enabled': '啟用帳號存取權限',
    'employee.access_disabled': '停用帳號存取權限',
    'identity.linked': '核准 Google 帳號綁定',
    'identity.auto_linked': '首次登入自動綁定帳號',
    'identity.bootstrap_admin_linked': '系統管理員初始綁定',
    'identity.revoked': '解除 Google 帳號綁定',
    'identity.link_rejected': '拒絕帳號綁定申請',
    'identity.email_changed': 'Google 帳號信箱變更',
    'identity.link_conflict': '帳號綁定信箱衝突',
    'access_role.created': '新增權限角色',
    'access_role.updated': '修改權限角色設定',
    'access_role.activated': '啟用權限角色',
    'access_role.deactivated': '停用權限角色',
    // 系統大型操作紀錄
    'announcement.create': '建立公司公告草稿',
    'announcement.update': '編輯公司公告內容',
    'announcement.publish': '發布公司公告',
    'announcement.withdraw': '撤下公司公告',
    'announcement.delete': '刪除公司公告',
    'announcement.attachment_uploaded': '上傳公告附件',
    'announcement.attachment_removed': '移除公告附件',
    'survey.create': '建立內部問卷',
    'survey.update_basics': '修改問卷標題與說明',
    'survey.save_draft': '儲存問卷題目設定',
    'survey.publish': '發布內部問卷',
    'survey.close': '關閉內部問卷',
    'survey.question_delete': '刪除問卷題目',
    'survey.media_upload': '上傳問卷題目圖片',
    'survey.media_delete': '移除問卷題目圖片',
    'form_definition.created': '建立新表單定義',
    'form_definition.published': '發布表單版本',
    'form_definition.settings_updated': '更新表單基本設定',
    'form_definition.draft_saved': '儲存表單設計草稿',
    'form_definition.draft_discarded': '捨棄表單設計草稿',
    'form_definition.paused': '暫停表單開放申請',
    'form_definition.resumed': '恢復表單開放申請',
    'form_definition.deleted': '刪除表單定義',
    'form_category.created': '新增表單分類',
    'form_category.updated': '更新表單分類',
    'form_category.deleted': '刪除表單分類',
    'company_regulation.create': '新增公司規章',
    'company_regulation.update': '更新公司規章內容',
    'company_regulation.delete': '刪除公司規章',
    'company_regulation.attachment_upload': '上傳規章附件',
    'company_regulation.attachment_delete': '刪除規章附件',
    'org.level.created': '新增組織層級',
    'org.level.updated': '修改組織層級',
    'org.level.deleted': '刪除組織層級',
    'org.department.created': '新增部門',
    'org.department.updated': '修改部門設定',
    'org.department.deleted': '刪除部門',
    'org.job_role.created': '新增職務類別',
    'org.job_role.updated': '修改職務類別',
    'org.job_role.deleted': '刪除職務類別',
    'org.group.created': '新增簽核群組',
    'org.group.updated': '修改簽核群組',
    'org.group.deleted': '刪除簽核群組',
    'org.delegation.created': '新增簽核代理設定',
    'org.delegation.ended': '結束簽核代理設定',
    'org.delegation.deleted': '刪除簽核代理設定',
    'employee.created': '新增員工資料',
    'employee.updated': '修改員工基本資料',
    'employee.directory_updated': '同步 Google Directory 人員資料',
    'company_profile.updated': '更新公司基本資料',
    'company_profile.seal_uploaded': '更新公司印鑑圖檔',
    'budget_code.created': '新增預算編號',
    'budget_code.updated': '更新預算編號',
    'budget_code.deleted': '刪除預算編號',
    'project.created': '新增專案資料',
    'project.updated': '更新專案資料',
    'asset_field.created': '新增資產自訂欄位',
    'asset_field.updated': '更新資產自訂欄位',
    'asset_field.Archived': '封存資產自訂欄位',
    'asset_field.restored': '恢復資產自訂欄位',
    'asset_field.purged': '永久清除資產自訂欄位',
    // 登入登出
    'auth.login_succeeded': '登入成功 (Google OIDC)',
    'auth.dev_login': '登入成功 (開發測試模式)',
    'auth.logout': '登出系統',
    'auth.login_denied': '登入遭拒',
    'identity.link_requested': '首次登入送出綁定申請',
    // AI 與簽核
    'ai.approve_submission': 'AI 代為簽核核准',
    'ai.return_submission': 'AI 代為簽核退回',
    'ai.conversation_created': '建立 AI 助手對話',
    'ai.conversation_deleted': '刪除 AI 助手對話',
  };
  if (map[action]) return map[action];
  if (action.endsWith('.step_approved')) return '簽核核准';
  if (action.endsWith('.step_returned')) return '簽核退回';
  if (action.endsWith('.submitted')) return '送出表單申請';
  if (action.endsWith('.withdrawn')) return '撤回表單申請';
  return action;
}

// ============================================================================
// 1. 權限異動查詢 (Permission & Role Changes)
// ============================================================================

export type PermissionAuditItem = {
  id: number;
  occurredAt: Date;
  action: string;
  actionTitle: string;
  actorId: string | null;
  actorName: string;
  actorCode: string | null;
  actorDepartment: string | null;
  actorEmail: string | null;
  targetType: 'employee' | 'access_role' | 'identity_request';
  targetName: string;
  targetCode: string | null;
  targetDepartment: string | null;
  summary: string;
  details: Record<string, unknown>;
};

const PERMISSION_ACTIONS = [
  'employee.role_changed',
  'employee.access_enabled',
  'employee.access_disabled',
  'identity.linked',
  'identity.auto_linked',
  'identity.bootstrap_admin_linked',
  'identity.revoked',
  'identity.link_rejected',
  'identity.email_changed',
  'identity.link_conflict',
  'access_role.created',
  'access_role.updated',
  'access_role.activated',
  'access_role.deactivated',
] as const;

type RawPermissionAuditRow = {
  id: number;
  occurred_at: Date;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_code: string | null;
  actor_email: string | null;
  actor_dept: string | null;
  target_emp_name: string | null;
  target_emp_code: string | null;
  target_emp_email: string | null;
  target_emp_dept: string | null;
  target_role_code: string | null;
  target_role_name: string | null;
};

function summarizePermissionChange(
  row: RawPermissionAuditRow,
  roleNameByCode: Map<string, string>
): {
  targetType: PermissionAuditItem['targetType'];
  targetName: string;
  targetCode: string | null;
  targetDepartment: string | null;
  summary: string;
} {
  const d = (row.details ?? {}) as Record<string, unknown>;
  const resolveRole = (code: unknown): string => {
    if (typeof code !== 'string' || !code) return '—';
    const customName = roleNameByCode.get(code);
    if (customName) return `${customName} (${code})`;
    return `${roleLabel(code)} (${code})`;
  };

  if (row.action === 'employee.role_changed') {
    const fromRole = resolveRole(d.from);
    const toRole = resolveRole(d.to);
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: `權限角色由「${fromRole}」變更為「${toRole}」`,
    };
  }

  if (row.action === 'employee.access_enabled') {
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: '啟用系統登入與存取權限',
    };
  }

  if (row.action === 'employee.access_disabled') {
    const reason = typeof d.reason === 'string' && d.reason ? `（原因：${d.reason}）` : '';
    const revoked = typeof d.sessionsRevoked === 'number' ? `，已強制登出 ${d.sessionsRevoked} 個連線` : '';
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: `停用系統存取權限${reason}${revoked}`,
    };
  }

  if (
    row.action === 'identity.linked' ||
    row.action === 'identity.auto_linked' ||
    row.action === 'identity.bootstrap_admin_linked'
  ) {
    const email = typeof d.email === 'string' ? d.email : row.target_emp_email ?? '—';
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: `綁定 Google 帳號：${email}`,
    };
  }

  if (row.action === 'identity.revoked') {
    const revoked = typeof d.sessionsRevoked === 'number' ? `（已撤銷 ${d.sessionsRevoked} 個連線）` : '';
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: `解除 Google 帳號綁定${revoked}`,
    };
  }

  if (row.action === 'identity.email_changed') {
    return {
      targetType: 'employee',
      targetName: row.target_emp_name ?? '未知員工',
      targetCode: row.target_emp_code,
      targetDepartment: row.target_emp_dept,
      summary: `Google 信箱由 ${String(d.from ?? '—')} 變更為 ${String(d.to ?? '—')}`,
    };
  }

  if (row.action === 'identity.link_rejected') {
    return {
      targetType: 'identity_request',
      targetName: '待審核綁定申請',
      targetCode: row.entity_id ? row.entity_id.slice(0, 8) : null,
      targetDepartment: null,
      summary: '管理員拒絕了此 Google 帳號綁定申請',
    };
  }

  if (row.action.startsWith('access_role.')) {
    const roleCode =
      (typeof d.code === 'string' ? d.code : null) ?? row.target_role_code ?? '';
    const afterObj =
      d.after && typeof d.after === 'object' ? (d.after as Record<string, unknown>) : null;
    const beforeObj =
      d.before && typeof d.before === 'object' ? (d.before as Record<string, unknown>) : null;
    const roleName =
      (typeof d.name === 'string' ? d.name : null) ??
      (afterObj && typeof afterObj.name === 'string' ? afterObj.name : null) ??
      row.target_role_name ??
      roleLabel(roleCode);

    if (row.action === 'access_role.created') {
      const perms = Array.isArray(d.permissions)
        ? (d.permissions as string[]).map(permissionLabel)
        : [];
      return {
        targetType: 'access_role',
        targetName: `角色：${roleName}`,
        targetCode: roleCode || null,
        targetDepartment: '權限角色定義',
        summary:
          perms.length > 0
            ? `建立角色並授予 ${perms.length} 項權限：${perms.join('、')}`
            : '建立角色（無額外權限）',
      };
    }

    if (row.action === 'access_role.updated') {
      const beforePerms = Array.isArray(beforeObj?.permissions)
        ? (beforeObj.permissions as string[])
        : [];
      const afterPerms = Array.isArray(afterObj?.permissions)
        ? (afterObj.permissions as string[])
        : [];
      const added = afterPerms.filter((p) => !beforePerms.includes(p)).map(permissionLabel);
      const removed = beforePerms.filter((p) => !afterPerms.includes(p)).map(permissionLabel);
      const parts: string[] = [];
      if (added.length > 0) parts.push(`＋新增權限：${added.join('、')}`);
      if (removed.length > 0) parts.push(`－移除權限：${removed.join('、')}`);
      if (parts.length === 0) {
        parts.push(`更新角色名稱或說明（目前共 ${afterPerms.length} 項權限）`);
      }
      return {
        targetType: 'access_role',
        targetName: `角色：${roleName}`,
        targetCode: roleCode || null,
        targetDepartment: '權限角色定義',
        summary: parts.join('；'),
      };
    }

    return {
      targetType: 'access_role',
      targetName: `角色：${roleName}`,
      targetCode: roleCode || null,
      targetDepartment: '權限角色定義',
      summary: row.action === 'access_role.activated' ? '啟用此權限角色' : '停用此權限角色',
    };
  }

  return {
    targetType: 'employee',
    targetName: row.target_emp_name ?? row.entity_type,
    targetCode: row.target_emp_code,
    targetDepartment: row.target_emp_dept,
    summary: actionLabel(row.action),
  };
}

export async function listPermissionAuditLogs(
  opts: { query?: string; actionFilter?: string; limit?: number } = {}
): Promise<PermissionAuditItem[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const q = opts.query?.trim() ?? '';
  const filter = opts.actionFilter?.trim() ?? '';

  const roleRows = await db.execute<{ code: string; name: string }>(
    sql`select code, name from access_roles`
  );
  const roleNameByCode = new Map<string, string>();
  for (const r of roleRows) {
    roleNameByCode.set(r.code, r.name);
  }

  const actionsSql = sql.join(
    PERMISSION_ACTIONS.map((a) => sql`${a}`),
    sql`, `
  );

  const filterCond =
    filter === 'role_change'
      ? sql`and ae.action = 'employee.role_changed'`
      : filter === 'access_toggle'
        ? sql`and ae.action in ('employee.access_enabled', 'employee.access_disabled')`
        : filter === 'identity'
          ? sql`and ae.action like 'identity.%'`
          : filter === 'role_def'
            ? sql`and ae.action like 'access_role.%'`
            : sql``;

  const searchCond = q
    ? sql`and (
        actor.name ilike ${`%${q}%`}
        or actor.employee_code ilike ${`%${q}%`}
        or target_emp.name ilike ${`%${q}%`}
        or target_emp.employee_code ilike ${`%${q}%`}
        or target_role.name ilike ${`%${q}%`}
        or target_role.code ilike ${`%${q}%`}
        or ae.action ilike ${`%${q}%`}
        or ae.details::text ilike ${`%${q}%`}
      )`
    : sql``;

  const rows = await db.execute<RawPermissionAuditRow>(sql`
    select
      ae.id,
      ae.occurred_at,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.details,
      actor.id as actor_id,
      actor.name as actor_name,
      actor.employee_code as actor_code,
      actor.google_email as actor_email,
      actor_dept.name as actor_dept,
      target_emp.name as target_emp_name,
      target_emp.employee_code as target_emp_code,
      target_emp.google_email as target_emp_email,
      target_dept.name as target_emp_dept,
      target_role.code as target_role_code,
      target_role.name as target_role_name
    from audit_events ae
    left join employees actor on actor.id = ae.actor_employee_id
    left join departments actor_dept on actor_dept.id = actor.department_id
    left join employees target_emp on (
      ae.entity_type = 'employee'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and target_emp.id = ae.entity_id::uuid
    )
    left join departments target_dept on target_dept.id = target_emp.department_id
    left join access_roles target_role on (
      ae.entity_type = 'access_role'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and target_role.id = ae.entity_id::uuid
    )
    where ae.action in (${actionsSql})
    ${filterCond}
    ${searchCond}
    order by ae.occurred_at desc, ae.id desc
    limit ${limit}
  `);

  return rows.map((r) => {
    const info = summarizePermissionChange(r, roleNameByCode);
    return {
      id: Number(r.id),
      occurredAt: new Date(r.occurred_at),
      action: r.action,
      actionTitle: actionLabel(r.action),
      actorId: r.actor_id,
      actorName: r.actor_name ?? '系統自動處理',
      actorCode: r.actor_code,
      actorDepartment: r.actor_dept,
      actorEmail: r.actor_email,
      targetType: info.targetType,
      targetName: info.targetName,
      targetCode: info.targetCode,
      targetDepartment: info.targetDepartment,
      summary: info.summary,
      details: (r.details ?? {}) as Record<string, unknown>,
    };
  });
}

// ============================================================================
// 2. 系統操作紀錄 (High-Impact System Operations)
// ============================================================================

export type SystemOperationCategory =
  | 'all'
  | 'announcement'
  | 'survey'
  | 'form'
  | 'regulation'
  | 'org'
  | 'master';

export type SystemOperationAuditItem = {
  id: number;
  occurredAt: Date;
  category: Exclude<SystemOperationCategory, 'all'>;
  categoryLabel: string;
  action: string;
  actionTitle: string;
  actorId: string | null;
  actorName: string;
  actorCode: string | null;
  actorDepartment: string | null;
  targetTitle: string;
  summary: string;
  details: Record<string, unknown>;
};

type RawSystemOpRow = {
  id: number;
  occurred_at: Date;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_code: string | null;
  actor_dept: string | null;
  announcement_title: string | null;
  survey_title: string | null;
  form_name: string | null;
  form_key: string | null;
  regulation_title: string | null;
  target_emp_name: string | null;
  target_emp_code: string | null;
  target_dept_name: string | null;
};

function classifySystemOp(action: string): {
  category: Exclude<SystemOperationCategory, 'all'>;
  categoryLabel: string;
} {
  if (action.startsWith('announcement.')) {
    return { category: 'announcement', categoryLabel: '公司公告' };
  }
  if (action.startsWith('survey.')) {
    return { category: 'survey', categoryLabel: '內部問卷' };
  }
  if (action.startsWith('form_definition.') || action.startsWith('form_category.')) {
    return { category: 'form', categoryLabel: '表單設計' };
  }
  if (action.startsWith('company_regulation.')) {
    return { category: 'regulation', categoryLabel: '公司規章' };
  }
  if (
    action.startsWith('org.') ||
    action === 'employee.created' ||
    action === 'employee.updated' ||
    action === 'employee.directory_updated' ||
    action.startsWith('directory.')
  ) {
    return { category: 'org', categoryLabel: '組織與人事' };
  }
  return { category: 'master', categoryLabel: '系統與主檔設定' };
}

function summarizeSystemOp(row: RawSystemOpRow): { targetTitle: string; summary: string } {
  const d = (row.details ?? {}) as Record<string, unknown>;

  if (row.action.startsWith('announcement.')) {
    const title =
      (typeof d.title === 'string' && d.title) ||
      row.announcement_title ||
      '公司公告';
    const ver = typeof d.version === 'number' ? `（第 ${d.version} 版）` : '';
    const status =
      d.status === 'published'
        ? '並立即發布'
        : d.status === 'scheduled'
          ? '並設定排程發布'
          : '';
    return {
      targetTitle: `公告：${title}`,
      summary: `${actionLabel(row.action)}${status}${ver}`,
    };
  }

  if (row.action.startsWith('survey.')) {
    const title =
      (typeof d.title === 'string' && d.title) ||
      row.survey_title ||
      '內部問卷';
    const qCount =
      typeof d.questionCount === 'number' ? `（共 ${d.questionCount} 題）` : '';
    return {
      targetTitle: `問卷：${title}`,
      summary: `${actionLabel(row.action)}${qCount}`,
    };
  }

  if (row.action.startsWith('form_definition.') || row.action.startsWith('form_category.')) {
    const name =
      (typeof d.name === 'string' && d.name) ||
      (typeof d.title === 'string' && d.title) ||
      row.form_name ||
      '表單定義';
    const key =
      (typeof d.key === 'string' && d.key) ||
      row.form_key ||
      '';
    const ver =
      typeof d.versionNumber === 'number'
        ? `（v${d.versionNumber}）`
        : typeof d.version === 'number'
          ? `（v${d.version}）`
          : '';
    return {
      targetTitle: `表單：${name}${key ? ` (${key})` : ''}`,
      summary: `${actionLabel(row.action)}${ver}`,
    };
  }

  if (row.action.startsWith('company_regulation.')) {
    const title =
      (typeof d.title === 'string' && d.title) ||
      row.regulation_title ||
      '公司規章';
    const cat = typeof d.category === 'string' && d.category ? `［${d.category}］` : '';
    return {
      targetTitle: `規章：${cat}${title}`,
      summary: actionLabel(row.action),
    };
  }

  if (row.action.startsWith('org.department.')) {
    const deptName =
      (typeof d.name === 'string' && d.name) ||
      (d.after && typeof (d.after as Record<string, unknown>).name === 'string'
        ? String((d.after as Record<string, unknown>).name)
        : null) ||
      row.target_dept_name ||
      '部門設定';
    return {
      targetTitle: `部門：${deptName}`,
      summary: actionLabel(row.action),
    };
  }

  if (row.action.startsWith('org.')) {
    const itemName =
      (typeof d.name === 'string' && d.name) ||
      (typeof d.code === 'string' && d.code) ||
      row.entity_type;
    return {
      targetTitle: `組織設定：${itemName}`,
      summary: actionLabel(row.action),
    };
  }

  if (
    row.action === 'employee.created' ||
    row.action === 'employee.updated' ||
    row.action === 'employee.directory_updated'
  ) {
    const empLabel = row.target_emp_name
      ? `${row.target_emp_name}${row.target_emp_code ? ` (${row.target_emp_code})` : ''}`
      : typeof d.employeeCode === 'string'
        ? d.employeeCode
        : '員工資料';
    const changes = Array.isArray(d.changes)
      ? (d.changes as Array<{ field?: string; from?: unknown; to?: unknown }>)
          .map((c) => `${c.field ?? '欄位'}: ${String(c.from ?? '空')} → ${String(c.to ?? '空')}`)
          .join('、')
      : '';
    return {
      targetTitle: `人員：${empLabel}`,
      summary: changes ? `${actionLabel(row.action)}（${changes}）` : actionLabel(row.action),
    };
  }

  const fallbackName =
    (typeof d.name === 'string' && d.name) ||
    (typeof d.title === 'string' && d.title) ||
    (typeof d.code === 'string' && d.code) ||
    row.entity_type;

  return {
    targetTitle: String(fallbackName),
    summary: actionLabel(row.action),
  };
}

export async function listSystemOperationAuditLogs(
  opts: { query?: string; category?: string; limit?: number } = {}
): Promise<SystemOperationAuditItem[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 300);
  const q = opts.query?.trim() ?? '';
  const cat = (opts.category?.trim() ?? 'all') as SystemOperationCategory;

  const categoryCond =
    cat === 'announcement'
      ? sql`and ae.action like 'announcement.%'`
      : cat === 'survey'
        ? sql`and ae.action like 'survey.%'`
        : cat === 'form'
          ? sql`and (ae.action like 'form_definition.%' or ae.action like 'form_category.%')`
          : cat === 'regulation'
            ? sql`and ae.action like 'company_regulation.%'`
            : cat === 'org'
              ? sql`and (ae.action like 'org.%' or ae.action in ('employee.created', 'employee.updated', 'employee.directory_updated') or ae.action like 'directory.%')`
              : cat === 'master'
                ? sql`and (ae.action like 'company_profile.%' or ae.action like 'budget_code.%' or ae.action like 'project.%' or ae.action like 'asset_field.%' or ae.action like 'asset.%')`
                : sql`and (
                    ae.action like 'announcement.%'
                    or ae.action like 'survey.%'
                    or ae.action like 'form_definition.%'
                    or ae.action like 'form_category.%'
                    or ae.action like 'company_regulation.%'
                    or ae.action like 'org.%'
                    or ae.action in ('employee.created', 'employee.updated', 'employee.directory_updated')
                    or ae.action like 'directory.%'
                    or ae.action like 'company_profile.%'
                    or ae.action like 'budget_code.%'
                    or ae.action like 'project.%'
                    or ae.action like 'asset_field.%'
                    or ae.action like 'asset.%'
                  )`;

  const searchCond = q
    ? sql`and (
        actor.name ilike ${`%${q}%`}
        or actor.employee_code ilike ${`%${q}%`}
        or ca.title ilike ${`%${q}%`}
        or cs.title ilike ${`%${q}%`}
        or fd.name ilike ${`%${q}%`}
        or fd.key ilike ${`%${q}%`}
        or cr.title ilike ${`%${q}%`}
        or ae.action ilike ${`%${q}%`}
        or ae.details::text ilike ${`%${q}%`}
      )`
    : sql``;

  const rows = await db.execute<RawSystemOpRow>(sql`
    select
      ae.id,
      ae.occurred_at,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.details,
      actor.id as actor_id,
      actor.name as actor_name,
      actor.employee_code as actor_code,
      actor_dept.name as actor_dept,
      ca.title as announcement_title,
      cs.title as survey_title,
      fd.name as form_name,
      fd.key as form_key,
      cr.title as regulation_title,
      target_emp.name as target_emp_name,
      target_emp.employee_code as target_emp_code,
      target_dept.name as target_dept_name
    from audit_events ae
    left join employees actor on actor.id = ae.actor_employee_id
    left join departments actor_dept on actor_dept.id = actor.department_id
    left join company_announcements ca on (
      ae.entity_type = 'company_announcement'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and ca.id = ae.entity_id::uuid
    )
    left join company_surveys cs on (
      ae.entity_type = 'company_survey'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and cs.id = ae.entity_id::uuid
    )
    left join form_definitions fd on (
      ae.entity_type = 'form_definition'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and fd.id = ae.entity_id::uuid
    )
    left join company_regulations cr on (
      ae.entity_type = 'company_regulation'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and cr.id = ae.entity_id::uuid
    )
    left join employees target_emp on (
      ae.entity_type = 'employee'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and target_emp.id = ae.entity_id::uuid
    )
    left join departments target_dept on (
      ae.entity_type = 'department'
      and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and target_dept.id = ae.entity_id::uuid
    )
    where true
    ${categoryCond}
    ${searchCond}
    order by ae.occurred_at desc, ae.id desc
    limit ${limit}
  `);

  return rows.map((r) => {
    const { category, categoryLabel } = classifySystemOp(r.action);
    const { targetTitle, summary } = summarizeSystemOp(r);
    return {
      id: Number(r.id),
      occurredAt: new Date(r.occurred_at),
      category,
      categoryLabel,
      action: r.action,
      actionTitle: actionLabel(r.action),
      actorId: r.actor_id,
      actorName: r.actor_name ?? '系統排程／自動處理',
      actorCode: r.actor_code,
      actorDepartment: r.actor_dept,
      targetTitle,
      summary,
      details: (r.details ?? {}) as Record<string, unknown>,
    };
  });
}

// ============================================================================
// 3. 登入登出紀錄 (Login / Logout Audit Logs)
// ============================================================================

export type AuthAuditItem = {
  id: number;
  occurredAt: Date;
  action: string;
  actionTitle: string;
  status: 'login' | 'logout' | 'denied';
  employeeId: string | null;
  employeeName: string;
  employeeCode: string | null;
  departmentName: string | null;
  email: string | null;
  role: string | null;
  methodLabel: string;
  note: string;
  sessionId: string | null;
};

type RawAuthRow = {
  id: number;
  occurred_at: Date;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  emp_id: string | null;
  emp_name: string | null;
  emp_code: string | null;
  emp_email: string | null;
  emp_role: string | null;
  dept_name: string | null;
};

export async function listAuthAuditLogs(
  opts: { query?: string; statusFilter?: string; limit?: number } = {}
): Promise<AuthAuditItem[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 120, 1), 400);
  const q = opts.query?.trim() ?? '';
  const statusFilter = opts.statusFilter?.trim() ?? 'all';

  const statusCond =
    statusFilter === 'login'
      ? sql`and ae.action in ('auth.login_succeeded', 'auth.dev_login')`
      : statusFilter === 'logout'
        ? sql`and ae.action = 'auth.logout'`
        : statusFilter === 'denied'
          ? sql`and ae.action in ('auth.login_denied', 'identity.link_requested')`
          : sql`and ae.action in ('auth.login_succeeded', 'auth.dev_login', 'auth.logout', 'auth.login_denied', 'identity.link_requested')`;

  const searchCond = q
    ? sql`and (
        emp.name ilike ${`%${q}%`}
        or emp.employee_code ilike ${`%${q}%`}
        or emp.google_email ilike ${`%${q}%`}
        or dept.name ilike ${`%${q}%`}
        or ae.action ilike ${`%${q}%`}
      )`
    : sql``;

  const rows = await db.execute<RawAuthRow>(sql`
    select
      ae.id,
      ae.occurred_at,
      ae.action,
      ae.entity_type,
      ae.entity_id,
      ae.details,
      emp.id as emp_id,
      emp.name as emp_name,
      emp.employee_code as emp_code,
      emp.google_email as emp_email,
      emp.role as emp_role,
      dept.name as dept_name
    from audit_events ae
    left join employees emp on emp.id = coalesce(
      ae.actor_employee_id,
      case
        when ae.entity_type = 'employee'
          and ae.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ae.entity_id::uuid
        else null
      end
    )
    left join departments dept on dept.id = emp.department_id
    where true
    ${statusCond}
    ${searchCond}
    order by ae.occurred_at desc, ae.id desc
    limit ${limit}
  `);

  return rows.map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    let status: AuthAuditItem['status'] = 'login';
    let methodLabel = 'Google OIDC 單一登入';
    let note = '驗證成功並建立連線工作階段';

    if (r.action === 'auth.dev_login') {
      status = 'login';
      methodLabel = '開發環境快速登入';
      note = '本機開發模式切換身分登入';
    } else if (r.action === 'auth.logout') {
      status = 'logout';
      methodLabel = '主動登出';
      note = '使用者登出並銷毀工作階段 Cookie';
    } else if (r.action === 'auth.login_denied') {
      status = 'denied';
      methodLabel = 'Google OIDC 單一登入';
      const reason =
        d.reason === 'access_disabled'
          ? '帳號已被停用系統存取權限'
          : d.reason === 'identity_revoked'
            ? 'Google 綁定已被管理員撤銷'
            : String(d.reason ?? '未授權存取');
      note = `拒絕登入：${reason}`;
    } else if (r.action === 'identity.link_requested') {
      status = 'denied';
      methodLabel = 'Google OIDC 首次登入';
      note = '尚未綁定員工工號，已送出綁定申請待管理員核准';
    } else if (d.via === 'email_match') {
      note = '首次登入信箱吻合，自動完成綁定並登入';
    }

    return {
      id: Number(r.id),
      occurredAt: new Date(r.occurred_at),
      action: r.action,
      actionTitle: actionLabel(r.action),
      status,
      employeeId: r.emp_id,
      employeeName: r.emp_name ?? '未綁定外部帳號',
      employeeCode: r.emp_code,
      departmentName: r.dept_name,
      email: r.emp_email,
      role: r.emp_role,
      methodLabel,
      note,
      sessionId: r.entity_type === 'session' && r.entity_id ? r.entity_id : null,
    };
  });
}

// ============================================================================
// 4. 助手對話紀錄 (AI Assistant Chat Logs)
// ============================================================================

export type AiUserSummary = {
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentName: string | null;
  conversationCount: number;
  deletedConversationCount: number;
  messageCount: number;
  lastActivityAt: Date | null;
};

/** People who have AI conversations, newest activity first. */
export async function listAiUsers(opts: { query?: string; limit?: number } = {}): Promise<AiUserSummary[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const q = opts.query?.trim();

  const rows = await db
    .select({
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentName: departments.name,
      conversationCount: sql<number>`count(distinct ${aiConversations.id})::int`,
      deletedConversationCount: sql<number>`count(distinct case when ${aiConversations.archivedAt} is not null then ${aiConversations.id} end)::int`,
      messageCount: sql<number>`count(${aiMessages.id})::int`,
      lastActivityAt: sql<Date | null>`max(greatest(${aiConversations.updatedAt}, coalesce(${aiConversations.archivedAt}, ${aiConversations.createdAt}), ${aiMessages.createdAt}))`,
    })
    .from(aiConversations)
    .innerJoin(employees, eq(employees.id, aiConversations.ownerEmployeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(aiMessages, eq(aiMessages.conversationId, aiConversations.id))
    .where(
      q
        ? or(
            ilike(employees.name, `%${q}%`),
            ilike(employees.employeeCode, `%${q}%`),
            ilike(departments.name, `%${q}%`)
          )
        : undefined
    )
    .groupBy(employees.id, employees.employeeCode, employees.name, departments.name)
    .orderBy(sql`max(greatest(${aiConversations.updatedAt}, coalesce(${aiConversations.archivedAt}, ${aiConversations.createdAt}), ${aiMessages.createdAt})) desc nulls last`)
    .limit(limit);

  return rows.map((r) => ({
    employeeId: r.employeeId,
    employeeCode: r.employeeCode,
    name: r.name,
    departmentName: r.departmentName,
    conversationCount: r.conversationCount,
    deletedConversationCount: r.deletedConversationCount,
    messageCount: r.messageCount,
    lastActivityAt: r.lastActivityAt,
  }));
}

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: Date;
  archivedAt: Date | null;
  updatedAt: Date;
  messageCount: number;
};

export async function listConversationsForEmployee(employeeId: string, limit = 40): Promise<ConversationSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      createdAt: aiConversations.createdAt,
      archivedAt: aiConversations.archivedAt,
      updatedAt: aiConversations.updatedAt,
      messageCount: sql<number>`count(${aiMessages.id})::int`,
    })
    .from(aiConversations)
    .leftJoin(aiMessages, eq(aiMessages.conversationId, aiConversations.id))
    .where(eq(aiConversations.ownerEmployeeId, employeeId))
    .groupBy(aiConversations.id)
    .orderBy(desc(aiConversations.createdAt))
    .limit(limit);
  return rows;
}

export type ConversationMessage = {
  id: string;
  role: string;
  contentText: string;
  toolsUsed: unknown;
  blocks: unknown;
  createdAt: Date;
};

export async function listMessagesForConversation(
  conversationId: string,
  ownerEmployeeId: string
): Promise<{ conversation: ConversationSummary | null; messages: ConversationMessage[] }> {
  const db = getDb();
  const [conv] = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      createdAt: aiConversations.createdAt,
      archivedAt: aiConversations.archivedAt,
      updatedAt: aiConversations.updatedAt,
      messageCount: sql<number>`0::int`,
    })
    .from(aiConversations)
    .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.ownerEmployeeId, ownerEmployeeId)))
    .limit(1);
  if (!conv) return { conversation: null, messages: [] };

  const messages = await db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      contentText: aiMessages.contentText,
      toolsUsed: aiMessages.toolsUsed,
      blocks: aiMessages.blocks,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt)
    .limit(500);

  return {
    conversation: { ...conv, messageCount: messages.length },
    messages,
  };
}

export type AuditRow = {
  id: number;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
};

export async function listAuditForEmployee(
  employeeId: string,
  opts: { limit?: number; actionPrefix?: string } = {}
): Promise<AuditRow[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 300);
  const prefix = opts.actionPrefix?.trim();

  return db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorEmployeeId, employeeId),
        prefix ? sql`${auditEvents.action} like ${`${prefix}%`}` : undefined
      )
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);
}

export async function getEmployeeBrief(employeeId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      name: employees.name,
      departmentName: departments.name,
      role: employees.role,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row ?? null;
}
