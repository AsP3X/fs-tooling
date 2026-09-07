import { describe, expect, it } from 'vitest';
import {
  UPDATE_CHECK_MAX_AGE_MS,
  UPDATE_RETRY_MS,
  cacheTtlMs,
  compareAddonVersions,
  dismissUpdate,
  fetchLatestRelease,
  installedAddonVersion,
  isCacheFresh,
  isGithubReleaseUrl,
  isUpdateAvailable,
  parseAddonVersion,
  parseGithubRelease,
  shouldShowUpdateNotice,
} from './updates';

describe('parseAddonVersion', () => {
  it('reads the manifest form and strips a leading v', () => {
    expect(parseAddonVersion('2.7.0')).toBe('2.7.0');
    expect(parseAddonVersion('v2.7.0')).toBe('2.7.0');
  });

  it('drops the CI build suffix from GitHub tags (v2.7.0-42 is still 2.7.0)', () => {
    expect(parseAddonVersion('v2.7.0-42')).toBe('2.7.0');
    expect(parseAddonVersion('v2.8.0-1')).toBe('2.8.0');
  });

  it('pads missing patch/minor so 2.8 compares as 2.8.0', () => {
    expect(parseAddonVersion('2.8')).toBe('2.8.0');
    expect(parseAddonVersion('v3')).toBe('3.0.0');
  });

  it('rejects empty or non-version strings', () => {
    expect(parseAddonVersion('')).toBeNull();
    expect(parseAddonVersion('latest')).toBeNull();
    expect(parseAddonVersion(null)).toBeNull();
  });
});

describe('compareAddonVersions', () => {
  it('orders dotted versions numerically, not as strings', () => {
    expect(compareAddonVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareAddonVersions('2.7.1', '2.7.0')).toBe(1);
    expect(compareAddonVersions('2.7.0', '2.7.0')).toBe(0);
    expect(compareAddonVersions('2.6.9', '2.7.0')).toBe(-1);
  });

  it('treats a CI tag of the same version as equal to the manifest', () => {
    expect(compareAddonVersions('v2.7.0-99', '2.7.0')).toBe(0);
  });
});

describe('shouldShowUpdateNotice', () => {
  it('shows when GitHub is ahead of the installed addon', () => {
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: '2.8.0', dismissed: null })).toBe(true);
  });

  it('does not show when the latest tag is the same version (new CI build only)', () => {
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: 'v2.7.0-85', dismissed: null })).toBe(false);
  });

  it('does not show after that version was dismissed', () => {
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: '2.8.0', dismissed: '2.8.0' })).toBe(false);
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: 'v2.8.0-3', dismissed: '2.8.0' })).toBe(false);
  });

  it('shows again when a newer version than the dismissed one is released', () => {
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: '2.9.0', dismissed: '2.8.0' })).toBe(true);
  });

  it('does not show when already on the latest version', () => {
    expect(shouldShowUpdateNotice({ current: '2.8.0', latest: '2.8.0', dismissed: null })).toBe(false);
  });

  it('does not show when GitHub has no comparable release', () => {
    expect(shouldShowUpdateNotice({ current: '2.7.0', latest: null, dismissed: null })).toBe(false);
  });
});

describe('isUpdateAvailable', () => {
  it('is true when GitHub is ahead, even if that version was dismissed', () => {
    expect(isUpdateAvailable('2.7.0', '2.8.0')).toBe(true);
    expect(isUpdateAvailable('2.7.0', 'v2.7.0-85')).toBe(false);
    expect(isUpdateAvailable('2.8.0', '2.8.0')).toBe(false);
  });
});

describe('parseGithubRelease', () => {
  it('reads the GitHub REST latest-release payload', () => {
    const release = parseGithubRelease({
      tag_name: 'v2.8.0-12',
      name: 'Freshservice Ops Panel 2.8.0 (build 12)',
      html_url: 'https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0-12',
      draft: false,
      prerelease: false,
    });
    expect(release).toEqual({
      version: '2.8.0',
      tagName: 'v2.8.0-12',
      title: 'Freshservice Ops Panel 2.8.0 (build 12)',
      htmlUrl: 'https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0-12',
    });
  });

  it('accepts the worker snapshot shape (camelCase)', () => {
    const release = parseGithubRelease({
      tagName: 'v2.8.0-12',
      name: 'Freshservice Ops Panel 2.8.0 (build 12)',
      htmlUrl: 'https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0-12',
    });
    expect(release?.version).toBe('2.8.0');
  });

  it('skips drafts and prereleases', () => {
    expect(parseGithubRelease({ tag_name: 'v2.8.0', draft: true })).toBeNull();
    expect(parseGithubRelease({ tag_name: 'v2.8.0', prerelease: true })).toBeNull();
  });

  it('ignores non-GitHub html_url values and builds a tag link instead', () => {
    const release = parseGithubRelease({
      tag_name: 'v2.8.0',
      html_url: 'javascript:alert(1)',
    });
    expect(release?.htmlUrl).toBe('https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0');
  });

  it('tolerates a null release name from GitHub', () => {
    const release = parseGithubRelease({
      tag_name: 'v2.8.0',
      name: null,
      html_url: 'https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0',
    });
    expect(release?.title).toBe('');
    expect(release?.version).toBe('2.8.0');
  });
});

describe('isGithubReleaseUrl', () => {
  it('allows https links under this repo', () => {
    expect(isGithubReleaseUrl('https://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0')).toBe(true);
  });

  it('rejects other hosts and schemes', () => {
    expect(isGithubReleaseUrl('http://github.com/AsP3X/fs-tooling/releases/tag/v2.8.0')).toBe(false);
    expect(isGithubReleaseUrl('https://evil.example/AsP3X/fs-tooling')).toBe(false);
  });
});

describe('extension messaging without a runtime', () => {
  it('returns the stamped version and does not throw on dismiss', async () => {
    const current = installedAddonVersion();
    expect(current).toMatch(/^\d+\.\d+\.\d+/);
    await expect(fetchLatestRelease()).resolves.toEqual({
      currentVersion: current,
      dismissed: null,
      release: null,
      ok: false,
      error: 'no_runtime',
    });
    await expect(fetchLatestRelease({ force: true })).resolves.toEqual({
      currentVersion: current,
      dismissed: null,
      release: null,
      ok: false,
      error: 'no_runtime',
    });
    await expect(dismissUpdate('2.8.0')).resolves.toBeUndefined();
  });
});

describe('isCacheFresh', () => {
  const now = 1_700_000_000_000;

  it('is fresh inside the max-age window', () => {
    expect(isCacheFresh(now - 60_000, now)).toBe(true);
    expect(isCacheFresh(now - 86_399_000, now)).toBe(true);
  });

  it('is stale at or beyond 24h, or when the timestamp is missing', () => {
    expect(isCacheFresh(now - 86_400_000, now)).toBe(false);
    expect(isCacheFresh(undefined, now)).toBe(false);
    expect(isCacheFresh(now + 5_000, now)).toBe(false);
  });

  it('uses a 15-minute window after a failed fetch', () => {
    expect(cacheTtlMs(false)).toBe(UPDATE_CHECK_MAX_AGE_MS);
    expect(cacheTtlMs(true)).toBe(UPDATE_RETRY_MS);
    expect(isCacheFresh(now - 14 * 60 * 1000, now, UPDATE_RETRY_MS)).toBe(true);
    expect(isCacheFresh(now - 15 * 60 * 1000, now, UPDATE_RETRY_MS)).toBe(false);
  });
});
