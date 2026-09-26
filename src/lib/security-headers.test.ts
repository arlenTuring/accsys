import { describe, expect, it } from 'vitest';
import { buildCsp, hstsHeader } from './security-headers';

describe('buildCsp', () => {
  it('uses a nonce for scripts and no unsafe-inline/unsafe-eval in production', () => {
    const csp = buildCsp('abc', false);
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toContain("'nonce-abc'");
    expect(script).not.toContain('unsafe-inline');
    expect(script).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('only allows eval for the development server', () => {
    expect(buildCsp('abc', true)).toContain("'unsafe-eval'");
  });
});

describe('hstsHeader', () => {
  it('is off unless explicitly enabled', () => {
    expect(hstsHeader({})).toBeNull();
    expect(hstsHeader({ ENABLE_HSTS: 'true' })).toContain('max-age=');
  });
});
