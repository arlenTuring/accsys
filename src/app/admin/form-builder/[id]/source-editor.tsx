'use client';

import type { ApproverSource, FormParty } from '@/lib/approval/flow/types';
import type { FormSchema } from '@/lib/custom-forms/schema';
import type { BuilderOrg } from '@/lib/form-builder/queries';
import { dangerBtn, smallBtn, smallInput } from '../../org/org-ui';
import { Field } from '../builder-ui';
import { fieldsOfType } from './designer-model';

const PARTY_LABELS: Record<FormParty, string> = {
  applicant: '申請人',
  filer: '代填人',
  field_employee: '表單中選的員工',
  budget_owner: '預算編號的負責人',
  asset_custodian: '資產的保管人',
};
/** Parties offered in the designer (asset fields arrive with the asset form migration). */
const PARTIES: FormParty[] = ['field_employee', 'budget_owner', 'applicant', 'filer'];

const SCOPE_LABELS = { company: '全公司', applicant_department: '申請人部門（往上找）', field_department: '表單中選的部門（往上找）' } as const;

function Select({
  value,
  onChange,
  list,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  list: { value: string; label: string }[];
  placeholder: string;
  label: string;
}) {
  return (
    <select className={smallInput} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {value && !list.some((o) => o.value === value) && <option value={value}>（已停用或不存在）</option>}
      {list.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const nameOf = (list: { value: string; label: string }[], v: string | undefined | null) => list.find((o) => o.value === v)?.label ?? '（未選擇）';

export function sourceSummary(s: ApproverSource, org: BuilderOrg, schema: FormSchema): string {
  const emps = org.employees.map((e) => ({ value: e.id, label: e.label }));
  const depts = org.departments.map((d) => ({ value: d.id, label: d.name }));
  const fieldName = (id?: string) => fieldsOfType(schema, ['employee', 'department', 'budget_code']).find((f) => f.id === id)?.label ?? '（未選擇欄位）';
  const levelName = (code: string | null) => org.levels.find((l) => l.code === code)?.name ?? code ?? '';
  switch (s.kind) {
    case 'employee':
      return nameOf(emps, s.employeeId);
    case 'department_manager': {
      const base = s.of === 'applicant' ? '申請人部門' : s.of === 'department' ? nameOf(depts, s.departmentId) : `「${fieldName(s.fieldId)}」`;
      return `${base}的主管${s.levelsUp > 0 ? `（往上 ${s.levelsUp} 層）` : ''}`;
    }
    case 'department_members':
      return `${nameOf(depts, s.departmentId)}的成員依序簽核${s.includeManager ? '（含主管）' : ''}`;
    case 'org_chain': {
      const start = s.of === 'applicant' ? '申請人部門' : `「${fieldName(s.fieldId)}」`;
      const rules = s.rules.map((r) => `${levelName(r.fromLevel)}→${levelName(r.toLevel)}`).join('、');
      return `從${start}${s.includeStartDepartment ? '' : '的上一層'}往上逐級簽到 ${rules || ''}${s.defaultToLevel ? `${rules ? '，其他' : ''}到 ${levelName(s.defaultToLevel)}` : ''}`;
    }
    case 'form_party':
      return s.party === 'applicant' || s.party === 'filer' ? PARTY_LABELS[s.party] : `${PARTY_LABELS[s.party]}：「${fieldName(s.fieldId)}」`;
    case 'employee_group':
      return `群組「${nameOf(org.groups.map((g) => ({ value: g.id, label: g.name })), s.groupId)}」依序簽核`;
    case 'job_role':
      return `${nameOf(org.jobRoles.map((r) => ({ value: r.code, label: r.name })), s.jobRole)}（${SCOPE_LABELS[s.scope]}${s.scope === 'field_department' ? `：${fieldName(s.fieldId)}` : ''}）`;
  }
}

export function SourceEditor({
  source,
  onChange,
  org,
  schema,
}: {
  source: ApproverSource;
  onChange: (s: ApproverSource) => void;
  org: BuilderOrg;
  schema: FormSchema;
}) {
  const emps = org.employees.map((e) => ({ value: e.id, label: e.label }));
  const depts = org.departments.map((d) => ({ value: d.id, label: d.name }));
  const levels = org.levels.map((l) => ({ value: l.code, label: `${l.name}（${l.code}）` }));
  const deptFields = fieldsOfType(schema, ['department']).map((f) => ({ value: f.id, label: f.label }));
  const empFields = fieldsOfType(schema, ['employee']).map((f) => ({ value: f.id, label: f.label }));
  const budgetFields = fieldsOfType(schema, ['budget_code']).map((f) => ({ value: f.id, label: f.label }));
  const noFields = (what: string) => <p className="text-xs text-amber-700">表單還沒有{what}欄位，請先到「欄位設計」加入。</p>;

  switch (source.kind) {
    case 'employee':
      return (
        <Field label="簽核人">
          <Select label="簽核人" value={source.employeeId} onChange={(employeeId) => onChange({ ...source, employeeId })} list={emps} placeholder="選擇員工…" />
        </Field>
      );
    case 'department_manager':
      return (
        <div className="space-y-2">
          <Field label="哪個部門的主管">
            <select
              className={smallInput}
              value={source.of}
              onChange={(e) => {
                const of = e.target.value as 'applicant' | 'department' | 'field';
                onChange({ kind: 'department_manager', of, levelsUp: source.levelsUp, ...(of === 'department' ? { departmentId: '' } : {}), ...(of === 'field' ? { fieldId: '' } : {}) });
              }}
            >
              <option value="applicant">申請人所屬部門</option>
              <option value="department">指定部門</option>
              <option value="field">表單中選的部門</option>
            </select>
          </Field>
          {source.of === 'department' && (
            <Select label="部門" value={source.departmentId ?? ''} onChange={(departmentId) => onChange({ ...source, departmentId })} list={depts} placeholder="選擇部門…" />
          )}
          {source.of === 'field' &&
            (deptFields.length ? (
              <Select label="部門欄位" value={source.fieldId ?? ''} onChange={(fieldId) => onChange({ ...source, fieldId })} list={deptFields} placeholder="選擇部門欄位…" />
            ) : (
              noFields('部門選擇')
            ))}
          <Field label="往上幾層" hint="0 = 該部門主管；1 = 上一層部門的主管">
            <input
              className={smallInput}
              type="number"
              min={0}
              max={10}
              value={source.levelsUp}
              onChange={(e) => onChange({ ...source, levelsUp: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
            />
          </Field>
        </div>
      );
    case 'department_members':
      return (
        <div className="space-y-2">
          <Field label="部門">
            <Select label="部門" value={source.departmentId} onChange={(departmentId) => onChange({ ...source, departmentId })} list={depts} placeholder="選擇部門…" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={source.includeManager} onChange={(e) => onChange({ ...source, includeManager: e.target.checked })} />
            包含部門主管
          </label>
          <p className="text-xs text-td-muted">部門內在職成員依姓名順序一人一關。</p>
        </div>
      );
    case 'org_chain':
      return (
        <div className="space-y-2">
          <Field label="起點">
            <select
              className={smallInput}
              value={source.of}
              onChange={(e) => {
                const of = e.target.value as 'applicant' | 'field';
                const { includeStartDepartment, rules, defaultToLevel } = source;
                onChange({ kind: 'org_chain', of, includeStartDepartment, rules, defaultToLevel, ...(of === 'field' ? { fieldId: '' } : {}) });
              }}
            >
              <option value="applicant">申請人所屬部門</option>
              <option value="field">表單中選的部門</option>
            </select>
          </Field>
          {source.of === 'field' &&
            (deptFields.length ? (
              <Select label="部門欄位" value={source.fieldId ?? ''} onChange={(fieldId) => onChange({ ...source, fieldId })} list={deptFields} placeholder="選擇部門欄位…" />
            ) : (
              noFields('部門選擇')
            ))}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={source.includeStartDepartment} onChange={(e) => onChange({ ...source, includeStartDepartment: e.target.checked })} />
            包含起點部門的主管
          </label>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-td-blue-dark">依起點部門的層級決定簽到哪一層</p>
            {source.rules.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <Select
                  label="起點層級"
                  value={r.fromLevel}
                  onChange={(fromLevel) => onChange({ ...source, rules: source.rules.map((x, j) => (j === i ? { ...x, fromLevel } : x)) })}
                  list={levels}
                  placeholder="起點層級"
                />
                <span className="text-xs">簽到</span>
                <Select
                  label="終點層級"
                  value={r.toLevel}
                  onChange={(toLevel) => onChange({ ...source, rules: source.rules.map((x, j) => (j === i ? { ...x, toLevel } : x)) })}
                  list={levels}
                  placeholder="終點層級"
                />
                <button type="button" className={dangerBtn} aria-label="刪除規則" onClick={() => onChange({ ...source, rules: source.rules.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className={smallBtn} onClick={() => onChange({ ...source, rules: [...source.rules, { fromLevel: '', toLevel: '' }] })}>
              ＋ 層級規則
            </button>
          </div>
          <Field label="其他層級（或沒有符合的規則時）簽到">
            <Select
              label="預設終點"
              value={source.defaultToLevel ?? ''}
              onChange={(v) => onChange({ ...source, defaultToLevel: v || null })}
              list={levels}
              placeholder="（不設定）"
            />
          </Field>
          {org.levels.length === 0 && <p className="text-xs text-amber-700">尚未設定組織層級，請先到「組織與簽核設定 → 組織層級」建立。</p>}
        </div>
      );
    case 'form_party': {
      const needsField = source.party !== 'applicant' && source.party !== 'filer';
      const list = source.party === 'budget_owner' ? budgetFields : empFields;
      return (
        <div className="space-y-2">
          <Field label="關係人">
            <select
              className={smallInput}
              value={source.party}
              onChange={(e) => {
                const party = e.target.value as FormParty;
                onChange(party === 'applicant' || party === 'filer' ? { kind: 'form_party', party } : { kind: 'form_party', party, fieldId: '' });
              }}
            >
              {PARTIES.map((p) => (
                <option key={p} value={p}>
                  {PARTY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          {needsField &&
            (list.length ? (
              <Select label="欄位" value={source.fieldId ?? ''} onChange={(fieldId) => onChange({ ...source, fieldId })} list={list} placeholder="選擇欄位…" />
            ) : (
              noFields(source.party === 'budget_owner' ? '預算編號' : '員工選擇')
            ))}
        </div>
      );
    }
    case 'employee_group':
      return (
        <Field label="員工群組" hint="群組成員依設定順序一人一關">
          <Select
            label="員工群組"
            value={source.groupId}
            onChange={(groupId) => onChange({ ...source, groupId })}
            list={org.groups.map((g) => ({ value: g.id, label: g.name }))}
            placeholder="選擇群組…"
          />
        </Field>
      );
    case 'job_role':
      return (
        <div className="space-y-2">
          <Field label="職務類別">
            <Select
              label="職務類別"
              value={source.jobRole}
              onChange={(jobRole) => onChange({ ...source, jobRole })}
              list={org.jobRoles.map((r) => ({ value: r.code, label: r.name }))}
              placeholder="選擇職務…"
            />
          </Field>
          <Field label="找哪個範圍的負責人">
            <select
              className={smallInput}
              value={source.scope}
              onChange={(e) => {
                const scope = e.target.value as keyof typeof SCOPE_LABELS;
                onChange(scope === 'field_department' ? { kind: 'job_role', jobRole: source.jobRole, scope, fieldId: '' } : { kind: 'job_role', jobRole: source.jobRole, scope });
              }}
            >
              {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {source.scope === 'field_department' &&
            (deptFields.length ? (
              <Select label="部門欄位" value={source.fieldId ?? ''} onChange={(fieldId) => onChange({ ...source, fieldId })} list={deptFields} placeholder="選擇部門欄位…" />
            ) : (
              noFields('部門選擇')
            ))}
        </div>
      );
  }
}
