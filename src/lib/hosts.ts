// Human: Default SaaS hosts vs user-entered custom desk origins. No tenant hostname is hardcoded.
// Agent: PURE. Worker copies parseDeskOrigin / isDefaultAddonHost (background.ts is not bundled). Keep those copies aligned.

export function isDefaultAddonHost(hostname: string): boolean {
  const h = String(hostname || '').toLowerCase();
  return h === 'freshservice.com' || h.endsWith('.freshservice.com')
    || h === 'myfreshworks.com' || h.endsWith('.myfreshworks.com');
}

export function originMatchPattern(origin: string): string {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return '';
    return `${u.origin}/*`;
  } catch {
    return '';
  }
}

/**
 * Normalize a user-entered desk URL to `https://host`.
 * Default SaaS hosts are marked builtin so they are not stored as extras.
 */
export function parseDeskOrigin(raw: string): { origin: string; builtin: boolean } | null {
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

/** SaaS hosts, or a path that still looks like the Freshservice Ember app. */
export function looksLikeFreshserviceUrl(url: string): boolean {
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
