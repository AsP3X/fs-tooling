import { describe, expect, it } from 'vitest';
import { isAllowedApiPath, isAllowedOrigin } from './http';

describe('isAllowedOrigin', () => {
  it('allows Freshservice HTTPS tenants', () => {
    expect(isAllowedOrigin('https://acme.freshservice.com')).toBe(true);
    expect(isAllowedOrigin('https://acme.myfreshworks.com')).toBe(true);
  });

  it('rejects other origins', () => {
    expect(isAllowedOrigin('http://acme.freshservice.com')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });
});

describe('isAllowedApiPath', () => {
  it('allows v2 paths only', () => {
    expect(isAllowedApiPath('/api/v2/tickets')).toBe(true);
    expect(isAllowedApiPath('/api/v1/tickets')).toBe(false);
    expect(isAllowedApiPath('/api/v2/../tickets')).toBe(false);
  });
});
