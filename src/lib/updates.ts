// Human: GitHub Releases update check. Compare the installed addon version to /releases/latest; ignore CI build suffixes.
// Agent: PURE parse/compare. fetchLatestRelease CALLS the service worker (sth.updates.check). dismissUpdate WRITES sth.updates.dismissed via the worker. Never hits GitHub from the content script.

import { hasExtensionRuntime } from './secrets';

declare const __STH_VERSION__: string;

export const GITHUB_REPO = 'AsP3X/fs-tooling';
export const ADDON_PUBLISHER = 'AsP3X';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
/** Re-fetch at most once a day. GitHub's unauthenticated cap is 60 requests/hour/IP. */
export const UPDATE_CHECK_MAX_AGE_MS = 86_400_000;
/** After a failed fetch, wait 15 minutes before trying GitHub again (avoids burning the hourly cap). */
export const UPDATE_RETRY_MS = 15 * 60 * 1000;

export function cacheTtlMs(failed: boolean): number {
  return failed ? UPDATE_RETRY_MS : UPDATE_CHECK_MAX_AGE_MS;
}

export interface AddonRelease {
  version: string;
  tagName: string;
  title: string;
  htmlUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  dismissed: string | null;
  release: AddonRelease | null;
  ok: boolean;
  error?: string;
}

const VERSION_PREFIX = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function field(rec: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * Addon versions are `major.minor.patch` (Chrome/Edge manifest). CI tags are `v2.7.0-42`;
 * the `-42` is a build id of the same version, not a newer release.
 */
export function parseAddonVersion(raw: string | null | undefined): string | null {
  const text = String(raw || '').trim().replace(/^v/i, '');
  const match = text.match(VERSION_PREFIX);
  if (!match) return null;
  const parts = [match[1], match[2] || '0', match[3] || '0'];
  if (match[4] != null) parts.push(match[4]);
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 65535)) return null;
  return nums.join('.');
}

export function compareAddonVersions(left: string, right: string): number {
  const a = parseAddonVersion(left);
  const b = parseAddonVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isCacheFresh(checkedAt: unknown, now: number, maxAgeMs = UPDATE_CHECK_MAX_AGE_MS): boolean {
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt)) return false;
  if (checkedAt > now) return false;
  return now - checkedAt < maxAgeMs;
}

export function isGithubReleaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return false;
    return parsed.pathname.toLowerCase().startsWith(`/${GITHUB_REPO.toLowerCase()}/`);
  } catch {
    return false;
  }
}

function releaseUrl(tagName: string, htmlUrl: string): string {
  if (isGithubReleaseUrl(htmlUrl)) return htmlUrl;
  if (!tagName) return GITHUB_RELEASES_PAGE;
  return `https://github.com/${GITHUB_REPO}/releases/tag/${encodeURIComponent(tagName)}`;
}

/** Map GitHub's latest-release JSON (or the worker's snapshot) to a comparable addon release. */
export function parseGithubRelease(json: unknown): AddonRelease | null {
  const rec = asRecord(json);
  if (!rec) return null;
  if (rec.draft === true || rec.prerelease === true) return null;
  const tagName = field(rec, 'tag_name', 'tagName');
  const version = parseAddonVersion(tagName);
  if (!version) return null;
  const title = field(rec, 'name', 'title');
  return {
    version,
    tagName,
    title,
    htmlUrl: releaseUrl(tagName, field(rec, 'html_url', 'htmlUrl')),
  };
}

/** True when GitHub is a newer addon version than the install. Ignores toast dismiss state. */
export function isUpdateAvailable(current: string, latest: string | null | undefined): boolean {
  const installed = parseAddonVersion(current);
  const remote = parseAddonVersion(latest);
  if (!installed || !remote) return false;
  return compareAddonVersions(remote, installed) > 0;
}

export function shouldShowUpdateNotice(input: {
  current: string;
  latest: string | null;
  dismissed: string | null;
}): boolean {
  if (!isUpdateAvailable(input.current, input.latest)) return false;
  const latest = parseAddonVersion(input.latest);
  const dismissed = parseAddonVersion(input.dismissed);
  if (dismissed && latest && compareAddonVersions(latest, dismissed) <= 0) return false;
  return true;
}

function emptyResult(currentVersion: string, error: string): UpdateCheckResult {
  return { currentVersion, dismissed: null, release: null, ok: false, error };
}

function workerResult(raw: unknown): UpdateCheckResult {
  const rec = asRecord(raw);
  if (!rec) return emptyResult('', 'no_response');
  const dismissed = parseAddonVersion(field(rec, 'dismissed'));
  const error = field(rec, 'error');
  return {
    currentVersion: parseAddonVersion(field(rec, 'currentVersion')) || '',
    dismissed,
    release: parseGithubRelease(rec.release),
    ok: rec.ok !== false,
    error: error || undefined,
  };
}

function stampedVersion(): string {
  try {
    return parseAddonVersion(__STH_VERSION__) || '';
  } catch {
    return '';
  }
}

function manifestVersion(): string {
  try {
    return parseAddonVersion(chrome.runtime.getManifest()?.version) || '';
  } catch {
    return '';
  }
}

// Human: Prefer the running manifest; fall back to the version Vite stamped from package.json.
// Agent: READS chrome.runtime.getManifest().version, then __STH_VERSION__. RETURNS dotted addon version or ''.
export function installedAddonVersion(): string {
  return manifestVersion() || stampedVersion();
}

export async function fetchLatestRelease(opts: { force?: boolean } = {}): Promise<UpdateCheckResult> {
  const currentVersion = installedAddonVersion();
  if (!hasExtensionRuntime()) {
    return emptyResult(currentVersion, 'no_runtime');
  }
  try {
    const raw = await chrome.runtime.sendMessage({
      type: 'sth.updates.check',
      force: !!opts.force,
    });
    const result = workerResult(raw);
    if (!result.currentVersion) result.currentVersion = currentVersion;
    return result;
  } catch {
    return emptyResult(currentVersion, 'send_failed');
  }
}

export async function dismissUpdate(version: string): Promise<void> {
  const parsed = parseAddonVersion(version);
  if (!parsed || !hasExtensionRuntime()) return;
  try {
    await chrome.runtime.sendMessage({ type: 'sth.updates.dismiss', version: parsed });
  } catch {
    // Keep the toast hidden for this page even if storage write fails.
  }
}
