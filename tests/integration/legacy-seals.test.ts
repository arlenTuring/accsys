import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONTRACT_SEAL_FORM, GENERAL_SEAL_FORM } from '@/lib/custom-forms/migrated/seals';
import type { MigratedForm } from '@/lib/custom-forms/migrated/types';
import { addDays } from '@/lib/seal-requests/validate';
import { taipeiToday } from '@/lib/taipei-date';

const currentEmployee: { value: unknown } = { value: null };
vi.mock('@/lib/auth/current-employee', () => ({ getCurrentEmployee: async () => currentEmployee.value }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

type Sql = Awaited<ReturnType<typeof loadSql>>;
const loadSql = async () => (await import('@/lib/db')).getSql();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const LEGACY = ['contract_seal_request', 'general_seal_request', 'invoice_seal_request'];

// Batch 1 switch-over: the seal forms as designer definitions (代為申請 in the
// custom runtime) and the hard-coded seal forms refusing new requests once
// replaced. Definitions are immutable, so the keys are tagged per run and the
// legacy link is cleared afterwards (later test files still use the old forms).
describe('batch 1: seal forms moved to the designer runtime', () => {
  let sql: Sql;
  const tag = `ls${Date.now()}`;
  const ids = {} as Record<'dept' | 'other' | 'mgr' | 'filer' | 'applicant' | 'outsider' | 'gm', string>;
  const submissionIds: string[] = [];
  const legacyIds: string[] = [];
  const general: MigratedForm = { ...clone(GENERAL_SEAL_FORM), key: `${tag}-gs`, numberPrefix: 'TG' };
  const contract: MigratedForm = { ...clone(CONTRACT_SEAL_FORM), key: `${tag}-cs`, numberPrefix: 'TC' };
  const selfOnly: MigratedForm = {
    ...clone(GENERAL_SEAL_FORM),
    key: `${tag}-self`,
    numberPrefix: 'TS',
    legacyFormType: `${tag}_none`,
    schema: { ...clone(GENERAL_SEAL_FORM.schema), onBehalf: undefined },
  };

  const actor = (id: string) => ({ id });
  const data = (overrides: Record<string, unknown> = {}) => ({
    urgency: 'normal',
    expectedCompletionDate: addDays(taipeiToday(), 5),
    remark: '',
    documentType: 'quotation',
    documentDescription: '報價單 1 份',
    seals: ['invoice_seal'],
    lendSeal: false,
    ...overrides,
  });
  const install = async (form: MigratedForm, mode: 'draft' | 'publish') => {
    const { runInTransaction } = await import('@/lib/workflow/tx');
    const { installMigratedForm } = await import('@/lib/custom-forms/migrated/install');
    return runInTransaction('test.migrate', async (tx) => ({ ok: true as const, ...(await installMigratedForm(tx, form, ids.mgr, mode)) }));
  };
  const create = async (who: string, key: string, extra: { applicantEmployeeId?: string; data?: unknown } = {}) => {
    const service = await import('@/lib/custom-forms/service');
    const r = await service.createSubmission(actor(who), key, {
      data: extra.data ?? data(),
      idempotencyKey: crypto.randomUUID(),
      fileCount: 1,
      applicantEmployeeId: extra.applicantEmployeeId,
    });
    if (r.ok) submissionIds.push(r.submissionId);
    return r;
  };
  const versionOf = async (id: string) => Number((await sql`select version from form_submissions where id = ${id}`)[0].version);
  const steps = async (id: string) =>
    (
      await sql`select approver_employee_id, approver_role, status from approval_steps
        where form_type = 'custom' and form_id = ${id} order by step_order`
    ).map((s) => [s.approver_role, s.approver_employee_id, s.status]);
  const notices = async (id: string, recipient: string) =>
    (await sql`select type from notifications where form_type = 'custom' and form_id = ${id} and recipient_employee_id = ${recipient} order by created_at`).map(
      (n) => n.type
    );
  const legacyInput = () => ({
    idempotencyKey: crypto.randomUUID(),
    applicantEmployeeId: ids.filer,
    departmentId: ids.dept,
    urgency: 'normal',
    expectedCompletionDate: addDays(taipeiToday(), 10),
    remark: '無',
    documentType: 'quotation',
    documentDescription: '測試報價單 1 份',
    seals: ['invoice_seal'],
    lendSeal: 'no',
    lendSealNote: '無',
  });

  beforeAll(async () => {
    sql = await loadSql();
    // A crashed earlier run may have left a replacement in place.
    await sql`update form_definitions set legacy_form_type = null where legacy_form_type = any(${LEGACY}::text[])`;
    const [anyDept] = await sql`select id from departments limit 1`;
    const employee = async (name: string, deptId: string) =>
      (await sql`insert into employees (employee_code, name, department_id) values (${`${tag}-${name}`}, ${name}, ${deptId}) returning id`)[0]
        .id as string;
    ids.mgr = await employee('mgr', anyDept.id);
    ids.dept = (await sql`insert into departments (code, name, manager_employee_id) values (${tag}, '轉換測試部', ${ids.mgr}) returning id`)[0].id;
    ids.other = (await sql`insert into departments (code, name) values (${`${tag}-O`}, '其他部門') returning id`)[0].id;
    await sql`update employees set department_id = ${ids.dept} where id = ${ids.mgr}`;
    ids.filer = await employee('filer', ids.dept);
    ids.applicant = await employee('applicant', ids.dept);
    ids.outsider = await employee('outsider', ids.other);
    ids.gm = (
      await sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
        where j.code = 'general_manager' and r.department_id is null and r.is_primary`
    )[0].employee_id;
  });

  afterAll(async () => {
    await sql`update form_definitions set legacy_form_type = null where key like ${`${tag}-%`}`;
    if (submissionIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'custom' and form_id = any(${submissionIds}::uuid[])`;
      const cases = await sql`delete from form_submissions where id = any(${submissionIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
    if (legacyIds.length > 0) {
      await sql`delete from approval_steps where form_type = 'general_seal_request' and form_id = any(${legacyIds}::uuid[])`;
      await sql`delete from notifications where form_type = 'general_seal_request' and form_id = any(${legacyIds}::uuid[])`;
      const cases = await sql`delete from general_seal_requests where id = any(${legacyIds}::uuid[]) returning procurement_case_id`;
      await sql`delete from procurement_cases where id = any(${cases.map((c) => c.procurement_case_id)}::uuid[])`;
    }
  });

  it('a draft install changes nothing for users; reruns are no-ops', async () => {
    const { retiredLegacyForms } = await import('@/lib/custom-forms/legacy');
    expect(await install(contract, 'draft')).toMatchObject({ ok: true, outcome: 'drafted' });
    expect(await install(contract, 'draft')).toMatchObject({ ok: true, outcome: 'skipped' });
    expect(await install(contract, 'publish')).toMatchObject({ ok: true, outcome: 'skipped' });
    const [def] = await sql`select status, published_version_id, legacy_form_type from form_definitions where key = ${contract.key}`;
    expect(def).toEqual({ status: 'draft', published_version_id: null, legacy_form_type: 'contract_seal_request' });
    expect((await retiredLegacyForms()).contract_seal_request).toBeUndefined();
  });

  it('publishing switches over: the old create service refuses, existing records stay', async () => {
    const legacyService = await import('@/lib/general-seals/service');
    const { replacementFor, retiredLegacyForms } = await import('@/lib/custom-forms/legacy');
    const legacyActor = { id: ids.filer, departmentId: ids.dept };
    const before = await legacyService.createGeneralSealRequest(legacyActor, legacyInput());
    expect(before.ok).toBe(true);
    if (before.ok) legacyIds.push(before.sealRequestId);

    expect(await install(general, 'publish')).toMatchObject({ ok: true, outcome: 'published' });
    expect(await replacementFor('general_seal_request')).toBe(general.key);
    expect((await retiredLegacyForms()).general_seal_request).toBe(general.key);
    // Another definition cannot claim the same hard-coded form.
    expect(await install({ ...general, key: `${tag}-gs2` }, 'publish')).toMatchObject({ ok: true, outcome: 'skipped' });

    const after = await legacyService.createGeneralSealRequest(legacyActor, legacyInput());
    expect(after).toMatchObject({ ok: false, code: 'conflict' });
    if (before.ok) {
      const [row] = await sql`select status from general_seal_requests where id = ${before.sealRequestId}`;
      expect(row.status).toBe('pending_approval');
    }

    // Archiving the designer form reopens the hard-coded one.
    await sql`update form_definitions set status = 'archived' where key = ${general.key}`;
    expect(await replacementFor('general_seal_request')).toBeNull();
    await sql`update form_definitions set status = 'published' where key = ${general.key}`;
  });

  it('files on behalf: applicant confirms first, the filer may edit and hears the outcome', async () => {
    const service = await import('@/lib/custom-forms/service');
    const { canReadForm } = await import('@/lib/authz/forms');
    const created = await create(ids.filer, general.key, { applicantEmployeeId: ids.applicant });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.submissionId;
    expect(created.formNumber).toMatch(/TG\d{4}$/);

    const [row] = await sql`select s.applicant_employee_id, s.department_id, c.created_by_employee_id
      from form_submissions s join procurement_cases c on c.id = s.procurement_case_id where s.id = ${id}`;
    expect(row).toEqual({ applicant_employee_id: ids.applicant, department_id: ids.dept, created_by_employee_id: ids.filer });
    expect(await steps(id)).toEqual([
      ['step:applicant_confirmation', ids.applicant, 'pending'],
      ['step:dept_manager', ids.mgr, 'pending'],
      ['step:general_manager', ids.gm, 'pending'],
    ]);
    expect(await canReadForm({ id: ids.filer, role: 'staff' }, 'custom', id)).toBe(true);
    expect(await canReadForm({ id: ids.outsider, role: 'staff' }, 'custom', id)).toBe(false);

    // The filer may still edit before the applicant confirms; the confirmation step is kept.
    const edited = await service.reviseSubmission(actor(ids.filer), id, 'update', {
      data: data({ documentDescription: '報價單 2 份' }),
      expectedVersion: await versionOf(id),
      // No file is stored by these tests; attachments stay required on every round.
      newFileCount: 1,
    });
    expect(edited).toEqual({ ok: true });
    expect((await steps(id))[0]).toEqual(['step:applicant_confirmation', ids.applicant, 'pending']);
    expect(await service.reviseSubmission(actor(ids.outsider), id, 'update', { data: data(), expectedVersion: await versionOf(id), newFileCount: 1 })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });

    expect(await service.approveSubmissionStep(actor(ids.applicant), id, await versionOf(id))).toEqual({ ok: true });
    expect(await service.withdrawSubmission(actor(ids.filer), id)).toMatchObject({ ok: false, code: 'conflict' });

    expect(await service.returnSubmissionStep(actor(ids.mgr), id, '請補用印份數', await versionOf(id))).toEqual({ ok: true });
    expect(await notices(id, ids.filer)).toContain('request_returned');

    // The applicant resubmits themselves: no confirmation step this round.
    const resubmitted = await service.reviseSubmission(actor(ids.applicant), id, 'resubmit', {
      data: data({ documentDescription: '報價單 3 份' }),
      expectedVersion: await versionOf(id),
      newFileCount: 1,
    });
    expect(resubmitted).toEqual({ ok: true });
    expect((await steps(id)).filter((s) => s[2] === 'pending')).toEqual([
      ['step:dept_manager', ids.mgr, 'pending'],
      ['step:general_manager', ids.gm, 'pending'],
    ]);
    expect(await service.approveSubmissionStep(actor(ids.mgr), id, await versionOf(id))).toEqual({ ok: true });
    expect(await service.approveSubmissionStep(actor(ids.gm), id, await versionOf(id))).toEqual({ ok: true });
    const [done] = await sql`select status from form_submissions where id = ${id}`;
    expect(done.status).toBe('approved');
    expect(await notices(id, ids.filer)).toContain('request_approved');
  });

  it('the filer may withdraw before the applicant confirms', async () => {
    const service = await import('@/lib/custom-forms/service');
    const created = await create(ids.filer, general.key, { applicantEmployeeId: ids.applicant });
    if (!created.ok) throw new Error(created.error);
    expect(await service.withdrawSubmission(actor(ids.outsider), created.submissionId)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await service.withdrawSubmission(actor(ids.filer), created.submissionId)).toEqual({ ok: true });
  });

  it('refuses 代為申請 when nobody but the applicant and the filer would sign', async () => {
    // The GM files for the department manager: manager (= applicant) and GM (= filer) both drop out.
    const r = await create(ids.gm, general.key, { applicantEmployeeId: ids.mgr });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
  });

  it('refuses another applicant on forms without 代為申請, and disabled applicants', async () => {
    expect(await install(selfOnly, 'publish')).toMatchObject({ ok: true, outcome: 'published' });
    expect(await create(ids.filer, selfOnly.key, { applicantEmployeeId: ids.applicant })).toMatchObject({ ok: false, code: 'validation' });
    expect(await create(ids.filer, selfOnly.key)).toMatchObject({ ok: true });

    await sql`update employees set access_enabled = false, disabled_at = now() where id = ${ids.outsider}`;
    expect(await create(ids.filer, general.key, { applicantEmployeeId: ids.outsider })).toMatchObject({ ok: false, code: 'validation' });
    await sql`update employees set access_enabled = true, disabled_at = null where id = ${ids.outsider}`;
  });

  it('routes contract amounts above NT$100,000 to the chairman', async () => {
    expect(await install({ ...contract, key: `${tag}-cs2`, legacyFormType: `${tag}_cs2` }, 'publish')).toMatchObject({ ok: true, outcome: 'published' });
    const contractData = (amount: string) => ({
      urgency: 'normal',
      expectedCompletionDate: addDays(taipeiToday(), 5),
      documentType: 'contract',
      seals: ['contract_seal'],
      legalReview: ['confirmed'],
      periodStart: taipeiToday(),
      periodEnd: addDays(taipeiToday(), 30),
      totalAmount: amount,
      counterparty: '甲公司',
      subject: '維護合約',
      lendSeal: false,
    });
    const chairman = (
      await sql`select r.employee_id from employee_job_roles r join job_roles j on j.id = r.job_role_id
        where j.code = 'chairman' and r.department_id is null and r.is_primary`
    )[0].employee_id;
    const over = await create(ids.filer, `${tag}-cs2`, { data: contractData('100000.01') });
    if (!over.ok) throw new Error(over.error);
    expect((await steps(over.submissionId)).map((s) => s[1])).toEqual([ids.mgr, ids.gm, chairman]);
    const at = await create(ids.filer, `${tag}-cs2`, { data: contractData('100000') });
    if (!at.ok) throw new Error(at.error);
    expect((await steps(at.submissionId)).map((s) => s[1])).toEqual([ids.mgr, ids.gm]);
  });
});
