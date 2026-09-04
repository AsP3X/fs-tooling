/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// Human: MV3 service worker. Stores the API key and proxies /api/v2 calls so the content script never sends Authorization.
// Agent: READS/WRITES chrome.storage.local sth.apiKey. sth.api.fetch validates HTTPS Freshservice origin and /api/v2 path.

const STORAGE_KEY = 'sth.apiKey';

function allowedOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:'
      && (u.hostname.endsWith('.freshservice.com') || u.hostname.endsWith('.myfreshworks.com'));
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
  if (!allowedOrigin(origin) || !allowedPath(path)) {
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
  return undefined;
});
