import { describe, expect, it } from 'vitest';
import { isDefaultAddonHost, looksLikeFreshserviceUrl, originMatchPattern, parseDeskOrigin } from './hosts';

describe('isDefaultAddonHost', () => {
  it('allows SaaS Freshservice and Freshworks hosts', () => {
    expect(isDefaultAddonHost('acme.freshservice.com')).toBe(true);
    expect(isDefaultAddonHost('acme.myfreshworks.com')).toBe(true);
    expect(isDefaultAddonHost('freshservice.com')).toBe(true);
  });

  it('rejects custom and unrelated hosts', () => {
    expect(isDefaultAddonHost('servicedesk.mbenergy.com')).toBe(false);
    expect(isDefaultAddonHost('evil.example')).toBe(false);
  });
});

describe('looksLikeFreshserviceUrl', () => {
  it('accepts SaaS lists and custom desks that still use /a/', () => {
    expect(looksLikeFreshserviceUrl('https://acme.freshservice.com/a/tickets')).toBe(true);
    expect(looksLikeFreshserviceUrl('https://servicedesk.mbenergy.com/a/tickets/42')).toBe(true);
    expect(looksLikeFreshserviceUrl('https://help.example.com/a/tickets?foo=1')).toBe(true);
  });

  it('does not treat an arbitrary host as a desk without an app path', () => {
    expect(looksLikeFreshserviceUrl('https://intranet.example.com/')).toBe(false);
  });

  it('rejects unrelated https pages', () => {
    expect(looksLikeFreshserviceUrl('https://mail.google.com/')).toBe(false);
    expect(looksLikeFreshserviceUrl('http://acme.freshservice.com/a/tickets')).toBe(false);
  });
});

describe('parseDeskOrigin', () => {
  it('accepts a host, a full URL, and strips the path', () => {
    expect(parseDeskOrigin('desk.example.com')).toEqual({ origin: 'https://desk.example.com', builtin: false });
    expect(parseDeskOrigin('https://desk.example.com/a/tickets')).toEqual({ origin: 'https://desk.example.com', builtin: false });
  });

  it('marks SaaS hosts as already included', () => {
    expect(parseDeskOrigin('https://acme.freshservice.com/a/tickets')).toEqual({
      origin: 'https://acme.freshservice.com',
      builtin: true,
    });
  });

  it('rejects http and unrelated hosts', () => {
    expect(parseDeskOrigin('http://desk.example.com')).toBeNull();
    expect(parseDeskOrigin('https://github.com/AsP3X/fs-tooling')).toBeNull();
    expect(parseDeskOrigin('')).toBeNull();
  });
});

describe('originMatchPattern', () => {
  it('builds an MV3 host pattern', () => {
    expect(originMatchPattern('https://servicedesk.mbenergy.com')).toBe('https://servicedesk.mbenergy.com/*');
    expect(originMatchPattern('http://servicedesk.mbenergy.com')).toBe('');
  });
});
