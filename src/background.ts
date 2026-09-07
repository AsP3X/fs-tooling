/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Human: MV3 service worker. API key, custom desk URLs, Freshservice /api/v2 proxy, and GitHub Releases update check.
// Agent: READS/WRITES chrome.storage.local sth.apiKey, sth.desks, sth.updates.cache, sth.updates.dismissed. Custom desks are user-entered origins (no tenant hardcoded). sth.api.fetch allows default SaaS hosts or sth.desks. sth.updates.check FETCH only the public latest-release URL.

const STORAGE_KEY = 'sth.apiKey';
const DESKS_KEY = 'sth.desks';
const UPDATE_CACHE_KEY = 'sth.updates.cache';
const UPDATE_DISMISSED_KEY = 'sth.updates.dismissed';
// Keep in sync with GITHUB_RELEASES_API / UPDATE_CHECK_MAX_AGE_MS / UPDATE_RETRY_MS in src/lib/updates.ts.
const GITHUB_RELEASES_LATEST = 'https://api.github.com/repos/AsP3X/fs-tooling/releases/latest';
const UPDATE_MAX_AGE_MS = 86400000;
const UPDATE_RETRY_MS = 15 * 60 * 1000;

const CUSTOM_SCRIPT_ID = 'sth-custom-hosts';

// Keep in sync with src/lib/hosts.ts (this file is copied to background.js, not bundled).
function isDefaultAddonHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'freshservice.com' || h.endsWith('.freshservice.com')
    || h === 'myfreshworks.com' || h.endsWith('.myfreshworks.com');
}

function originMatchPattern(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return '';
    return `${u.origin}/*`;
  } catch {
    return '';
  }
}

function looksLikeFreshserviceUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (isDefaultAddonHost(u.hostname)) return true;
    const path = u.pathname || '/';
    return path.startsWith('/a/') || path.startsWith('/helpdesk') || path.startsWith('/support/');
  } catch {
    return false;
  }
}

function parseDeskOrigin(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const u = new URL(withProto);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!host || host === 'localhost') return null;
    if (host === 'github.com' || host.endsWith('.github.com') || host === 'api.github.com') return null;
    const origin = `https://${host}${u.port && u.port !== '443' ? `:${u.port}` : ''}`;
    return { origin, builtin: isDefaultAddonHost(host) };
  } catch {
    return null;
  }
}

async function readDesks() {
  const stored = await chrome.storage.local.get(DESKS_KEY);
  const raw = stored[DESKS_KEY];
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  list.forEach((item) => {
    const parsed = parseDeskOrigin(String(item || ''));
    if (!parsed || parsed.builtin || seen.has(parsed.origin)) return;
    seen.add(parsed.origin);
    out.push(parsed.origin);
  });
  return out;
}

async function writeDesks(origins) {
  await chrome.storage.local.set({ [DESKS_KEY]: origins });
  await syncCustomContentScripts();
}

async function allowedOrigin(origin) {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    if (isDefaultAddonHost(u.hostname)) return true;
    const desks = await readDesks();
    return desks.includes(u.origin);
  } catch {
    return false;
  }
}

function allowedPath(path) {
  return path.startsWith('/api/v2/') && !path.includes('..');
}

async function handleApiFetch(message) {
  const origin = String(message.origin || '');
  const path = String(message.path || '');
  if (!(await allowedOrigin(origin)) || !allowedPath(path)) {
    return { ok: false, status: 0, json: null, error: 'forbidden' };
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const apiKey = String(stored[STORAGE_KEY] || '');
  if (!apiKey) return { ok: false, status: 0, json: null, error: 'no_key' };
  try {
    const headers = {
      Authorization: `Basic ${btoa(`${apiKey}:X`)}`,
      'Content-Type': 'application/json',
    };
    const res = await fetch(`${origin}${path}`, {
      method: message.method || 'GET',
      headers,
      body: message.body || undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null, error: 'fetch_failed' };
  }
}

function installedVersion() {
  try {
    return String(chrome.runtime.getManifest().version || '');
  } catch {
    return '';
  }
}

function githubReleaseUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return '';
    if (!parsed.pathname.toLowerCase().startsWith('/asp3x/fs-tooling/')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function snapshotRelease(json) {
  if (!json || typeof json !== 'object') return null;
  const tagName = String(json.tag_name || json.tagName || '').trim();
  if (!tagName) return null;
  return {
    tagName,
    name: String(json.name || '').trim(),
    htmlUrl: githubReleaseUrl(json.html_url || json.htmlUrl),
  };
}

function readCache(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const checkedAt = Number(raw.checkedAt);
  if (!Number.isFinite(checkedAt)) return null;
  return {
    checkedAt,
    etag: String(raw.etag || ''),
    error: !!raw.error,
    release: snapshotRelease(raw.release),
  };
}

function cacheIsFresh(cache, now) {
  if (!cache) return false;
  if (cache.checkedAt > now) return false;
  const maxAge = cache.error ? UPDATE_RETRY_MS : UPDATE_MAX_AGE_MS;
  return now - cache.checkedAt < maxAge;
}

async function storedUpdateState() {
  const stored = await chrome.storage.local.get([UPDATE_CACHE_KEY, UPDATE_DISMISSED_KEY]);
  return {
    cache: readCache(stored[UPDATE_CACHE_KEY]),
    dismissed: String(stored[UPDATE_DISMISSED_KEY] || '').trim() || null,
  };
}

function updatePayload(release, dismissed, extra) {
  return {
    ok: true,
    currentVersion: installedVersion(),
    dismissed,
    release,
    ...extra,
  };
}

async function writeUpdateCache(entry) {
  await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: entry });
}

async function rememberFailedCheck(cache, now) {
  await writeUpdateCache({
    checkedAt: now,
    etag: cache?.etag || '',
    error: true,
    release: cache?.release || null,
  });
}

let updatesCheckInFlight = null;

// Human: GitHub REST "Get the latest release". Cache 24h (15m after errors), then revalidate with ETag.
// Agent: READS/WRITES sth.updates.cache + sth.updates.dismissed. FETCH only GITHUB_RELEASES_LATEST. `force` skips max-age (Settings → Check for updates). Coalesces overlapping checks. RETURNS a small snapshot, never the notes body.
async function runUpdatesCheck(opts) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  try {
    const { cache, dismissed } = await storedUpdateState();
    if (!force && cacheIsFresh(cache, now)) {
      return updatePayload(cache?.release || null, dismissed, { fromCache: true });
    }
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (cache?.etag) headers['If-None-Match'] = cache.etag;
    const res = await fetch(GITHUB_RELEASES_LATEST, {
      method: 'GET',
      headers,
      credentials: 'omit',
      cache: 'no-store',
    });
    const latestDismissed = (await storedUpdateState()).dismissed;
    if (res.status === 304) {
      await writeUpdateCache({
        checkedAt: now,
        etag: cache?.etag || '',
        error: false,
        release: cache?.release || null,
      });
      return updatePayload(cache?.release || null, latestDismissed, { fromCache: true });
    }
    if (!res.ok) {
      await rememberFailedCheck(cache, now);
      return {
        ok: false,
        currentVersion: installedVersion(),
        dismissed: latestDismissed,
        release: cache?.release || null,
        error: 'http',
      };
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    const release = snapshotRelease(json);
    await writeUpdateCache({
      checkedAt: now,
      etag: res.headers.get('ETag') || '',
      error: false,
      release,
    });
    return updatePayload(release, latestDismissed, { fromCache: false });
  } catch {
    const { cache, dismissed } = await storedUpdateState().catch(() => ({ cache: null, dismissed: null }));
    try { await rememberFailedCheck(cache, now); } catch { /* ignore */ }
    return {
      ok: false,
      currentVersion: installedVersion(),
      dismissed,
      release: cache?.release || null,
      error: 'fetch_failed',
    };
  }
}

function handleUpdatesCheck(message) {
  const force = !!message?.force;
  // Track the work promise itself (not promise.finally()), or the lock never clears.
  const op = updatesCheckInFlight
    ? (force ? updatesCheckInFlight.then(() => runUpdatesCheck({ force: true })) : updatesCheckInFlight)
    : runUpdatesCheck({ force });
  if (op !== updatesCheckInFlight) {
    const tracked = op;
    updatesCheckInFlight = tracked;
    tracked.finally(() => {
      if (updatesCheckInFlight === tracked) updatesCheckInFlight = null;
    });
  }
  return op;
}

async function handleUpdatesDismiss(message) {
  const version = String(message?.version || '').trim();
  if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) {
    return { ok: false, error: 'bad_version' };
  }
  await chrome.storage.local.set({ [UPDATE_DISMISSED_KEY]: version });
  return { ok: true };
}

function reply(sendResponse, op) {
  op.then(sendResponse, () => sendResponse({ ok: false, error: 'failed' }));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (type === 'sth.secrets.get') {
    chrome.storage.local.get(STORAGE_KEY).then((data) => {
      sendResponse({ apiKey: String(data[STORAGE_KEY] || '') });
    });
    return true;
  }
  if (type === 'sth.secrets.set') {
    const apiKey = String(message.apiKey || '').trim();
    const op = apiKey
      ? chrome.storage.local.set({ [STORAGE_KEY]: apiKey })
      : chrome.storage.local.remove(STORAGE_KEY);
    op.then(() => sendResponse({ ok: true }));
    return true;
  }
  if (type === 'sth.secrets.clear') {
    chrome.storage.local.remove(STORAGE_KEY).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (type === 'sth.api.fetch') {
    handleApiFetch(message).then(sendResponse);
    return true;
  }
  if (type === 'sth.updates.check') {
    reply(sendResponse, handleUpdatesCheck(message));
    return true;
  }
  if (type === 'sth.updates.dismiss') {
    reply(sendResponse, handleUpdatesDismiss(message));
    return true;
  }
  if (type === 'sth.desks.parse') {
    const parsed = parseDeskOrigin(message?.raw);
    sendResponse(parsed ? { ok: true, ...parsed } : { ok: false, error: 'bad_url' });
    return true;
  }
  if (type === 'sth.desks.list') {
    readDesks().then((desks) => sendResponse({ ok: true, desks: desks.map((origin) => ({ origin })) }));
    return true;
  }
  if (type === 'sth.desks.add') {
    reply(sendResponse, (async () => {
      const parsed = parseDeskOrigin(message?.origin);
      if (!parsed || parsed.builtin) return { ok: false, error: 'bad_url' };
      const desks = await readDesks();
      if (!desks.includes(parsed.origin)) desks.push(parsed.origin);
      await writeDesks(desks);
      return { ok: true, origin: parsed.origin };
    })());
    return true;
  }
  if (type === 'sth.desks.remove') {
    reply(sendResponse, (async () => {
      const parsed = parseDeskOrigin(message?.origin);
      const origin = parsed?.origin || '';
      const desks = (await readDesks()).filter((item) => item !== origin);
      await writeDesks(desks);
      const pattern = originMatchPattern(origin);
      if (pattern && chrome.permissions?.remove) {
        try { await chrome.permissions.remove({ origins: [pattern] }); } catch { /* ignore */ }
      }
      return { ok: true };
    })());
    return true;
  }
  if (type === 'sth.desks.open') {
    try {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
    } catch {
      sendResponse({ ok: false });
    }
    return true;
  }
  return undefined;
});

async function syncCustomContentScripts() {
  if (!chrome.scripting?.registerContentScripts) return;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  } catch {
    /* not registered yet */
  }
  const extra = (await readDesks()).map(originMatchPattern).filter(Boolean);
  if (!extra.length) return;
  await chrome.scripting.registerContentScripts([{
    id: CUSTOM_SCRIPT_ID,
    matches: extra,
    js: ['content.js'],
    runAt: 'document_idle',
    persistAcrossSessions: true,
    allFrames: false,
  }]);
}

async function revealOrInject(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'sth.panel.reveal' });
    return;
  } catch {
    /* no content script yet */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    /* no host access */
  }
}

chrome.action?.onClicked?.addListener(async (tab) => {
  const tabId = tab?.id;
  const url = String(tab?.url || '');
  if (!tabId || !looksLikeFreshserviceUrl(url)) {
    try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
    return;
  }
  const parsed = new URL(url);
  if (!isDefaultAddonHost(parsed.hostname)) {
    const pattern = originMatchPattern(parsed.origin);
    if (pattern && chrome.permissions?.request) {
      try {
        const ok = await chrome.permissions.request({ origins: [pattern] });
        if (ok) {
          const desks = await readDesks();
          if (!desks.includes(parsed.origin)) {
            desks.push(parsed.origin);
            await writeDesks(desks);
          } else {
            await syncCustomContentScripts();
          }
        }
      } catch {
        /* user closed the prompt */
      }
    }
  }
  await revealOrInject(tabId);
});

chrome.runtime.onInstalled.addListener((details) => {
  void syncCustomContentScripts();
  if (details?.reason === 'install') {
    try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
  }
});
chrome.runtime.onStartup?.addListener(() => {
  void syncCustomContentScripts();
});
chrome.permissions?.onAdded?.addListener(() => {
  void syncCustomContentScripts();
});
