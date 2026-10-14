// Any Unicode decimal digit: IMEs commonly produce full-width ０-９.
const DIGIT = /\p{Nd}/gu;

/** Approvers see that an account was given, not the account itself: every digit but the last four is hidden. */
export function maskRemittance(info: string): string {
  const digits = (info.match(DIGIT) ?? []).length;
  let seen = 0;
  return info.replace(DIGIT, (d) => (++seen > digits - 4 ? d : '＊'));
}

export function canSeeRemittance(actor: { id: string; role: string } | null, applicantEmployeeId: string): boolean {
  return actor !== null && (actor.id === applicantEmployeeId || actor.role === 'finance' || actor.role === 'admin');
}
