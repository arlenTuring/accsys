/**
 * What an admin should look at after a directory sync, computed from the
 * snapshot and ACCSYS records. Nothing here changes data; the actions in
 * admin/accounts re-check everything on the server.
 *
 * A directory account is linked to an employee only through a Google login
 * binding (employee_identities.subject = directory id, revoked or not). New
 * hires are matched to existing employees by Workspace email or employee code
 * as a suggestion only; bindings are still made by approving a login.
 */

export type SnapshotRow = {
  directoryUserId: string;
  primaryEmail: string;
  fullName: string;
  suspended: boolean;
  archived: boolean;
  removed: boolean;
  phone: string | null;
  title: string | null;
  department: string | null;
  employeeCode: string | null;
};

export type EmployeeRow = {
  id: string;
  employeeCode: string;
  name: string;
  googleEmail: string | null;
  phone: string | null;
  title: string | null;
  departmentName: string;
  accessEnabled: boolean;
};

export type IdentityRow = { employeeId: string; subject: string; active: boolean };
export type LinkRequestRow = { id: string; subject: string; email: string };

export const CHANGE_FIELDS = ['name', 'email', 'phone', 'title'] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type FieldChange = { field: ChangeField; current: string | null; next: string };

export type NewHire = {
  directoryUserId: string;
  email: string;
  fullName: string;
  phone: string | null;
  title: string | null;
  department: string | null;
  employeeCode: string | null;
  /** An employee that looks like this person; `changes` would align its record with the directory. */
  match: { by: 'email' | 'code'; employeeId: string; employeeCode: string; name: string; changes: FieldChange[] } | null;
  linkRequestId: string | null;
};

export type ProfileChange = {
  employeeId: string;
  employeeCode: string;
  name: string;
  directoryUserId: string;
  changes: FieldChange[];
  departmentHint: string | null;
  departmentName: string;
};

export type Leaver = {
  employeeId: string;
  employeeCode: string;
  name: string;
  email: string | null;
  reason: 'suspended' | 'archived' | 'removed' | 'missing';
};

export type DirectoryReview = {
  newHires: NewHire[];
  changes: ProfileChange[];
  leavers: Leaver[];
  /** Active bindings whose subject appears in the snapshot, out of all active bindings. */
  matchedBindings: number;
  activeBindings: number;
};

/** Workspace often stores CJK names as "given family" ("小明 王"); spacing and that order are not a change. */
export function sameName(record: string, directory: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, '');
  const parts = directory.trim().split(/\s+/);
  return squash(record) === squash(directory) || squash(record) === parts.reverse().join('');
}

/** Directory values that differ from the employee record (empty directory values never overwrite). */
export function fieldChanges(
  dir: Pick<SnapshotRow, 'fullName' | 'primaryEmail' | 'phone' | 'title'>,
  emp: Pick<EmployeeRow, 'name' | 'googleEmail' | 'phone' | 'title'>
): FieldChange[] {
  const out: FieldChange[] = [];
  const add = (field: ChangeField, current: string | null, next: string | null) => {
    if (next && next !== (current ?? '')) out.push({ field, current, next });
  };
  const fullName = dir.fullName.trim();
  if (fullName && !sameName(emp.name, fullName)) out.push({ field: 'name', current: emp.name, next: fullName });
  add('email', emp.googleEmail?.toLowerCase() ?? null, dir.primaryEmail);
  add('phone', emp.phone, dir.phone);
  add('title', emp.title, dir.title);
  return out;
}

export function buildDirectoryReview(input: {
  snapshot: SnapshotRow[];
  employees: EmployeeRow[];
  identities: IdentityRow[];
  linkRequests: LinkRequestRow[];
}): DirectoryReview {
  const employees = new Map(input.employees.map((e) => [e.id, e]));
  const byEmail = new Map(input.employees.filter((e) => e.googleEmail).map((e) => [e.googleEmail!.toLowerCase(), e]));
  const byCode = new Map(input.employees.map((e) => [e.employeeCode, e]));
  // Revoked bindings still link (the sync revokes suspended accounts), unless the
  // employee has since been bound to another account. Active wins per subject.
  const reboundEmployees = new Set(input.identities.filter((i) => i.active).map((i) => i.employeeId));
  const linked = new Map<string, IdentityRow>();
  for (const i of input.identities) {
    if (!i.active && reboundEmployees.has(i.employeeId)) continue;
    if (!linked.has(i.subject) || i.active) linked.set(i.subject, i);
  }
  const linkedEmployees = new Set([...linked.values()].map((i) => i.employeeId));
  const requests = new Map(input.linkRequests.map((r) => [r.subject, r]));
  const snapshotIds = new Set(input.snapshot.map((d) => d.directoryUserId));

  const active = [...linked.values()].filter((i) => i.active);
  const review: DirectoryReview = {
    newHires: [],
    changes: [],
    leavers: [],
    matchedBindings: active.filter((i) => snapshotIds.has(i.subject)).length,
    activeBindings: active.length,
  };
  for (const dir of input.snapshot) {
    const identity = linked.get(dir.directoryUserId);
    const emp = identity ? employees.get(identity.employeeId) : undefined;
    const gone = dir.suspended || dir.archived || dir.removed;
    if (emp) {
      if (gone) {
        if (emp.accessEnabled) {
          review.leavers.push({
            employeeId: emp.id,
            employeeCode: emp.employeeCode,
            name: emp.name,
            email: emp.googleEmail,
            reason: dir.removed ? 'removed' : dir.suspended ? 'suspended' : 'archived',
          });
        }
        continue;
      }
      const changes = fieldChanges(dir, emp);
      const departmentHint = dir.department && dir.department !== emp.departmentName ? dir.department : null;
      if (changes.length > 0 || departmentHint) {
        review.changes.push({
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          name: emp.name,
          directoryUserId: dir.directoryUserId,
          changes,
          departmentHint,
          departmentName: emp.departmentName,
        });
      }
      continue;
    }
    if (gone) continue;
    const candidate = byEmail.get(dir.primaryEmail) ?? (dir.employeeCode ? byCode.get(dir.employeeCode) : undefined);
    const match =
      candidate && !linkedEmployees.has(candidate.id)
        ? {
            by: byEmail.get(dir.primaryEmail) === candidate ? ('email' as const) : ('code' as const),
            employeeId: candidate.id,
            employeeCode: candidate.employeeCode,
            name: candidate.name,
            changes: fieldChanges(dir, candidate),
          }
        : null;
    review.newHires.push({
      directoryUserId: dir.directoryUserId,
      email: dir.primaryEmail,
      fullName: dir.fullName,
      phone: dir.phone,
      title: dir.title,
      department: dir.department,
      employeeCode: dir.employeeCode,
      match,
      linkRequestId: requests.get(dir.directoryUserId)?.id ?? null,
    });
  }

  // Bound to an account the directory never listed (only meaningful once a sync ran).
  // If no binding matches at all the directory ids probably are not login ids; listing everyone would mislead.
  if (input.snapshot.length > 0 && review.matchedBindings > 0) {
    for (const identity of active) {
      if (snapshotIds.has(identity.subject)) continue;
      const emp = employees.get(identity.employeeId);
      if (emp?.accessEnabled) review.leavers.push({ employeeId: emp.id, employeeCode: emp.employeeCode, name: emp.name, email: emp.googleEmail, reason: 'missing' });
    }
  }
  const byCodeOrder = <T extends { employeeCode: string }>(a: T, b: T) => a.employeeCode.localeCompare(b.employeeCode);
  review.changes.sort(byCodeOrder);
  review.leavers.sort(byCodeOrder);
  review.newHires.sort((a, b) => a.email.localeCompare(b.email));
  return review;
}
