import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { clientIp, isSameOriginRequest } from './http';

const APP = 'https://accsys.example.com';
const req = (headers: Record<string, string>) => new NextRequest(`${APP}/auth/logout`, { method: 'POST', headers });

describe('isSameOriginRequest', () => {
  it('accepts only the exact configured origin', () => {
    expect(isSameOriginRequest(req({ origin: APP }), APP)).toBe(true);
    expect(isSameOriginRequest(req({ origin: 'https://accsys.example.com.evil.test' }), APP)).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'http://accsys.example.com' }), APP)).toBe(false);
    expect(isSameOriginRequest(req({ origin: 'null' }), APP)).toBe(false);
  });

  it('falls back to Sec-Fetch-Site only when Origin is absent', () => {
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-origin' }), APP)).toBe(true);
    expect(isSameOriginRequest(req({ 'sec-fetch-site': 'same-site' }), APP)).toBe(false);
    expect(isSameOriginRequest(req({}), APP)).toBe(false);
  });
});

describe('clientIp', () => {
  it('uses only the configured proxy header and ignores X-Forwarded-For', () => {
    const r = req({ 'x-real-ip': '192.0.2.10', 'x-forwarded-for': '198.51.100.1' });
    expect(clientIp(r, { clientIpHeader: 'x-real-ip' })).toBe('192.0.2.10');
    expect(clientIp(r, { clientIpHeader: null })).toBe('unknown');
    expect(clientIp(req({ 'x-real-ip': 'drop table' }), { clientIpHeader: 'x-real-ip' })).toBe('unknown');
  });
});
