// Human: Tenant-scoped Freshservice /api/v2 client. Extension traffic goes through the service worker.
// Agent: WRITES nothing locally. Rejects non-HTTPS / non-Freshservice origins. Userscripts fetch same-origin with the session key.

import { getApiKey, hasExtensionRuntime } from '../secrets';

export interface ApiResponse {
  ok: boolean;
  status: number;
  json: unknown;
  error?: string;
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:'
      && (u.hostname.endsWith('.freshservice.com') || u.hostname.endsWith('.myfreshworks.com'));
  } catch {
    return false;
  }
}

export function isAllowedApiPath(path: string): boolean {
  if (!path.startsWith('/api/v2/')) return false;
  if (path.includes('..')) return false;
  return true;
}

export async function apiRequest(path: string, init: { method?: string; body?: string } = {}): Promise<ApiResponse> {
  if (!isAllowedApiPath(path)) return { ok: false, status: 0, json: null, error: 'bad_path' };
  const origin = location.origin;
  if (hasExtensionRuntime()) {
    try {
      const raw = await chrome.runtime.sendMessage({
        type: 'sth.api.fetch',
        origin,
        path,
        method: init.method || 'GET',
        body: init.body,
      });
      return (raw || { ok: false, status: 0, json: null, error: 'no_response' }) as ApiResponse;
    } catch (err) {
      return { ok: false, status: 0, json: null, error: err instanceof Error ? err.message : 'send_failed' };
    }
  }
  const key = await getApiKey();
  if (!key) return { ok: false, status: 0, json: null, error: 'no_key' };
  try {
    const res = await fetch(`${origin}${path}`, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${key}:X`)}`,
        'Content-Type': 'application/json',
      },
      body: init.body,
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err instanceof Error ? err.message : 'fetch_failed' };
  }
}

export function asRecord(json: unknown): Record<string, unknown> {
  return json && typeof json === 'object' ? json as Record<string, unknown> : {};
}

export function asArray(json: unknown): unknown[] {
  return Array.isArray(json) ? json : [];
}
