import { describe, expect, it } from 'vitest';
import { isAllowedEmail } from './allowed-domain';

describe('isAllowedEmail', () => {
  it('accepts an email on the allowed domain', () => {
    expect(isAllowedEmail('user@turingdrive.ai', 'turingdrive.ai')).toBe(true);
  });

  it('rejects an email on a different domain', () => {
    expect(isAllowedEmail('user@gmail.com', 'turingdrive.ai')).toBe(false);
  });

  it('is case-insensitive on the domain', () => {
    expect(isAllowedEmail('user@TuringDrive.AI', 'turingdrive.ai')).toBe(true);
  });

  it('rejects a domain that merely ends with the allowed domain', () => {
    expect(isAllowedEmail('user@notturingdrive.ai', 'turingdrive.ai')).toBe(false);
  });
});
