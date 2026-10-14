import { evaluateCondition } from './condition';
import type {
  ApproverBlock,
  ApproverSource,
  FlowBlock,
  FlowContext,
  FlowDef,
  OrgSnapshot,
  ResolvedStep,
  ResolveResult,
} from './types';

/**
 * Pure flow resolution: flow x form data x organisation snapshot -> ordered
 * approval steps. The same function backs submission, the approval simulator
 * and the designer preview, so what an admin previews is what gets created.
 */

type Candidate = { employeeId: string; label: string };
type Lookup = { ok: true; candidates: Candidate[] } | { ok: false; reason: string };

const MAX_DEPTH = 50;

const found = (candidates: Candidate[]): Lookup => ({ ok: true, candidates });
const missing = (reason: string): Lookup => ({ ok: false, reason });

function fieldIds(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
  return [];
}

function startDepartment(
  of: 'applicant' | 'department' | 'field',
  ctx: FlowContext,
  org: OrgSnapshot,
  departmentId?: string,
  fieldId?: string
): { id: string } | { reason: string } {
  const picked = of === 'applicant' ? ctx.departmentId : of === 'department' ? departmentId : fieldIds(ctx.fields[fieldId ?? ''])[0];
  if (!picked) return { reason: of === 'field' ? '表單上的部門（或人員）欄位沒有填寫' : '沒有設定部門' };
  const person = of === 'field' ? org.employees.get(picked) : undefined;
  const id = person ? person.departmentId : picked;
  if (!org.departments.has(id)) return { reason: person ? `找不到${person.name}所屬部門的資料` : '找不到部門資料' };
  return { id };
}

function ancestorsOf(deptId: string, org: OrgSnapshot): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = org.departments.get(deptId);
  while (cur && !seen.has(cur.id) && chain.length < MAX_DEPTH) {
    seen.add(cur.id);
    chain.push(cur.id);
    cur = cur.parentId ? org.departments.get(cur.parentId) : undefined;
  }
  return chain;
}

function activeEmployee(id: string | null | undefined, org: OrgSnapshot): string | null {
  if (!id) return null;
  return org.employees.get(id)?.active ? id : null;
}

function single(id: string | null | undefined, org: OrgSnapshot, label: string, whenMissing: string): Lookup {
  if (!id) return missing(whenMissing);
  const emp = org.employees.get(id);
  if (!emp) return missing('找不到員工資料');
  if (!emp.active) return missing(`${emp.name} 的帳號已停用`);
  return found([{ employeeId: id, label }]);
}

function jobRoleHolder(org: OrgSnapshot, jobRole: string, departmentId: string | null): Lookup | null {
  const holders = org.jobRoleBindings.filter(
    (b) => b.jobRole === jobRole && b.departmentId === departmentId && activeEmployee(b.employeeId, org)
  );
  if (holders.length === 0) return null;
  const pick = holders.length === 1 ? holders[0] : holders.find((h) => h.isPrimary);
  if (!pick) return missing(`有 ${holders.length} 位員工擔任此職務，但沒有設定主要人員`);
  return found([{ employeeId: pick.employeeId, label: '' }]);
}

function lookup(block: ApproverBlock, ctx: FlowContext, org: OrgSnapshot): Lookup {
  const src: ApproverSource = block.source;
  const label = block.label;
  switch (src.kind) {
    case 'employee':
      return single(src.employeeId, org, label, '沒有指定員工');

    case 'department_manager': {
      const start = startDepartment(src.of, ctx, org, src.departmentId, src.fieldId);
      if ('reason' in start) return missing(start.reason);
      const chain = ancestorsOf(start.id, org);
      const levelsUp = Math.max(0, Math.trunc(src.levelsUp));
      const deptId = chain[levelsUp];
      if (!deptId) return missing(`往上 ${levelsUp} 層沒有上層部門`);
      const dept = org.departments.get(deptId)!;
      return single(dept.managerId, org, label, `${dept.name}尚未設定主管`);
    }

    case 'department_members': {
      const dept = org.departments.get(src.departmentId);
      if (!dept) return missing('找不到部門資料');
      const members = [...org.employees.values()]
        .filter((e) => e.departmentId === dept.id && e.active && (src.includeManager || e.id !== dept.managerId))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant') || a.id.localeCompare(b.id));
      if (members.length === 0) return missing(`${dept.name}沒有可簽核的成員`);
      return found(members.map((m) => ({ employeeId: m.id, label: `${label}（${dept.name}）` })));
    }

    case 'org_chain': {
      const start = startDepartment(src.of, ctx, org, undefined, src.fieldId);
      if ('reason' in start) return missing(start.reason);
      const startDept = org.departments.get(start.id)!;
      const fromLevel = startDept.levelCode;
      const target =
        (fromLevel ? src.rules.find((r) => r.fromLevel === fromLevel)?.toLevel : undefined) ?? src.defaultToLevel;
      if (!target) return missing(`${startDept.name}的組織層級沒有對應的簽核終點`);
      const targetRank = org.levels.get(target)?.rank;
      if (targetRank === undefined) return missing('簽核終點的組織層級不存在');
      const candidates: Candidate[] = [];
      let reached = false;
      for (const [idx, deptId] of ancestorsOf(start.id, org).entries()) {
        const dept = org.departments.get(deptId)!;
        const rank = dept.levelCode ? org.levels.get(dept.levelCode)?.rank : undefined;
        if (idx > 0 || src.includeStartDepartment) {
          const manager = activeEmployee(dept.managerId, org);
          if (manager) candidates.push({ employeeId: manager, label: `${label}（${dept.name}）` });
        }
        if (rank !== undefined && rank >= targetRank) {
          reached = true;
          break;
        }
      }
      if (!reached) return missing(`組織架構往上找不到「${org.levels.get(target)!.name}」層級的部門`);
      if (candidates.length === 0) return missing('沿途部門都沒有設定在職的主管');
      return found(candidates);
    }

    case 'form_party': {
      switch (src.party) {
        case 'applicant':
          return single(ctx.applicantEmployeeId, org, label, '沒有申請人');
        case 'filer':
          return single(ctx.filerEmployeeId, org, label, '沒有填表人');
        case 'field_employee': {
          const ids = fieldIds(ctx.fields[src.fieldId ?? '']);
          if (ids.length === 0) return missing('表單上的員工欄位沒有填寫');
          const out: Candidate[] = [];
          for (const id of ids) {
            const one = single(id, org, label, '');
            if (!one.ok) return one;
            out.push(...one.candidates);
          }
          return found(out);
        }
        case 'budget_owner': {
          const codeId = fieldIds(ctx.fields[src.fieldId ?? ''])[0];
          if (!codeId) return missing('表單上的預算編號沒有填寫');
          return single(org.budgetOwners.get(codeId), org, label, '預算編號尚未設定負責人');
        }
        case 'asset_custodian': {
          const assetIds = fieldIds(ctx.fields[src.fieldId ?? '']);
          if (assetIds.length === 0) return missing('表單上沒有選擇財產');
          const out: Candidate[] = [];
          for (const assetId of assetIds) {
            const one = single(org.assetCustodians.get(assetId), org, label, '財產尚未設定保管人');
            if (!one.ok) return one;
            if (!out.some((c) => c.employeeId === one.candidates[0].employeeId)) out.push(...one.candidates);
          }
          return found(out);
        }
        default:
          return missing('不支援的表單關係人');
      }
    }

    case 'employee_group': {
      const group = org.groups.get(src.groupId);
      if (!group || !group.active) return missing('員工群組不存在或已停用');
      const members = group.memberIds.filter((id) => activeEmployee(id, org));
      if (members.length === 0) return missing(`員工群組「${group.name}」沒有在職成員`);
      return found(members.map((id) => ({ employeeId: id, label })));
    }

    case 'job_role': {
      const role = org.jobRoles.get(src.jobRole);
      if (!role || !role.active) return missing('職務類別不存在或已停用');
      const scopes: (string | null)[] = [];
      if (src.scope !== 'company') {
        const start = startDepartment(
          src.scope === 'applicant_department' ? 'applicant' : 'field',
          ctx,
          org,
          undefined,
          src.fieldId
        );
        if ('reason' in start) return missing(start.reason);
        scopes.push(...ancestorsOf(start.id, org));
      }
      scopes.push(null);
      for (const scope of scopes) {
        const hit = jobRoleHolder(org, src.jobRole, scope);
        if (hit) return hit.ok ? found(hit.candidates.map((c) => ({ ...c, label }))) : hit;
      }
      return missing(`沒有在職員工擔任「${role.name}」`);
    }

    default:
      return missing('不支援的簽核人類型');
  }
}

function delegateFor(employeeId: string, ctx: FlowContext, org: OrgSnapshot): string | null {
  const d = org.delegations.find(
    (x) =>
      x.delegatorId === employeeId &&
      x.startsOn <= ctx.today &&
      ctx.today <= x.endsOn &&
      (x.formKeys === null || (ctx.formKey !== null && x.formKeys.includes(ctx.formKey)))
  );
  if (!d || d.delegateId === employeeId) return null;
  return activeEmployee(d.delegateId, org);
}

export function resolveFlow(flow: FlowDef, ctx: FlowContext, org: OrgSnapshot): ResolveResult {
  const steps: ResolvedStep[] = [];
  const path: string[] = [];
  const signers = new Set<string>();

  const walk = (blocks: FlowBlock[], depth: number): { error: string; blockId: string } | null => {
    if (depth > 10) return { error: '簽核流程的條件層數過多', blockId: '' };
    for (const block of blocks) {
      if (block.type === 'condition') {
        const branch = block.branches.find((b) => evaluateCondition(b.when, ctx, org));
        path.push(`${block.label}：${branch ? branch.label : block.otherwise.label}`);
        const err = walk(branch ? branch.blocks : block.otherwise.blocks, depth + 1);
        if (err) return err;
        continue;
      }

      const self = (id: string) => id === ctx.applicantEmployeeId || id === ctx.filerEmployeeId;
      if (block.fallbackFor) {
        const covered = steps.some(
          (s) => block.fallbackFor!.includes(s.blockId) && s.approverEmployeeId !== null && !self(s.approverEmployeeId)
        );
        path.push(`${block.label}：${covered ? '前面已有申請人以外的人簽核，不需要' : '需要（前面沒有申請人以外的人簽核）'}`);
        if (covered) continue;
      }
      let result = lookup(block, ctx, org);
      if (block.fallbackFor && result.ok) {
        const others = result.candidates.filter((c) => !self(delegateFor(c.employeeId, ctx, org) ?? c.employeeId));
        result = others.length > 0 ? found(others) : missing('只有申請人本人可簽');
      }
      if (!result.ok) {
        if (block.onUnresolved === 'block') {
          return { error: `「${block.label}」找不到簽核人：${result.reason}，請聯絡系統管理員`, blockId: block.id };
        }
        steps.push({
          blockId: block.id,
          label: block.label,
          sourceKind: block.source.kind,
          approverEmployeeId: null,
          delegatedFromEmployeeId: null,
          status: 'skipped',
          systemNote: `找不到簽核人，已略過：${result.reason}`,
        });
        continue;
      }

      const explicitApplicant = block.source.kind === 'form_party' && block.source.party === 'applicant';
      for (const c of result.candidates) {
        const delegate = delegateFor(c.employeeId, ctx, org);
        const approver = delegate ?? c.employeeId;
        let status: ResolvedStep['status'] = 'pending';
        let note: string | null = null;
        if (!explicitApplicant && flow.options.skipApplicant && approver === ctx.applicantEmployeeId) {
          status = 'auto_approved';
          note = '簽核人即申請人，由系統代簽';
        } else if (
          flow.options.skipFiler &&
          ctx.filerEmployeeId !== ctx.applicantEmployeeId &&
          approver === ctx.filerEmployeeId
        ) {
          status = 'auto_approved';
          note = '簽核人即填表人，由系統代簽';
        } else if (flow.options.collapseDuplicates && signers.has(approver)) {
          status = 'auto_approved';
          note = '同一人已負責前面的關卡，由系統代簽';
        }
        if (status === 'pending') signers.add(approver);
        steps.push({
          blockId: block.id,
          label: c.label || block.label,
          sourceKind: block.source.kind,
          approverEmployeeId: approver,
          delegatedFromEmployeeId: delegate ? c.employeeId : null,
          status,
          systemNote: note,
        });
      }
    }
    return null;
  };

  const err = walk(flow.blocks, 0);
  if (err) return { ok: false, error: err.error, blockId: err.blockId || null };
  if (flow.options.whenEmpty === 'block' && !steps.some((s) => s.status === 'pending')) {
    return { ok: false, error: '依目前的簽核流程設定，這張表單沒有任何需要簽核的關卡，請聯絡系統管理員', blockId: null };
  }
  return { ok: true, steps, path };
}
