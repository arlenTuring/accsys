export function isAllowedEmail(email: string, allowedDomain: string): boolean {
  const [, domain] = email.toLowerCase().split('@');
  return domain === allowedDomain.toLowerCase();
}
