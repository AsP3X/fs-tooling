// Human: Default SaaS hosts vs user-entered custom desk origins. No tenant hostname is hardcoded.
// Agent: PURE. Worker copies parseDeskOrigin / isDefaultAddonHost / originMatchPattern (background.ts is not bundled). options.js copies the same three so Add can request hosts in the click gesture. Keep those copies aligned.

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

const BLOCKED_DESK_HOSTS = new Set([
  'https', 'http', 'ftp', 'file', 'javascript', 'mailto', 'about', 'chrome', 'edge', 'www',
]);

// Human: Match-pattern-safe hostname: DNS labels or IPv4. Blocks leftovers from a doubled https:// paste.
function usableDeskHost(host: string): boolean {
  if (!host || host === 'localhost' || host.includes('..')) return false;
  if (host === 'github.com' || host.endsWith('.github.com') || host === 'api.github.com') return false;
  if (BLOCKED_DESK_HOSTS.has(host)) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host);
}

/**
 * Normalize a user-entered desk URL to `https://host`.
 * Default SaaS hosts are marked builtin so they are not stored as extras.
 */
// Human: Accepts messy pastes — http, quotes, angle brackets, trailing dots, zero-width chars, a URL buried in a sentence.
// Agent: RETURNS { origin, builtin } or null. Upgrades http→https. Rejects github.com / localhost / scheme-like hosts so match patterns stay valid.
export function parseDeskOrigin(raw: string): { origin: string; builtin: boolean } | null {
  let s = String(raw || '');
  try { s = s.normalize('NFKC'); } catch { /* ignore */ }
  s = s.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD\u00A0]/g, '');
  s = s.replace(/[\u201C\u201D\u00AB\u00BB]/g, '"').replace(/[\u2018\u2019\u2039\u203A]/g, "'");
  s = Array.from(s, (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? ' ' : ch;
  }).join('').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const wrapLead = new Set(['"', "'", '<', '(', '[']);
  const wrapTail = new Set(['"', "'", '>', ')', ']']);
  while (s.length && wrapLead.has(s[0])) s = s.slice(1);
  while (s.length && wrapTail.has(s[s.length - 1])) s = s.slice(0, -1);
  s = s.trim();
  const embedded = s.match(/https?:\/\/[^\s<>"']+/i);
  if (embedded) s = embedded[0];
  s = s.replace(/[.,;:!?]+$/g, '');
  if (/^\/\//.test(s)) s = `https:${s}`;
  s = s.replace(/^(?:https?:\/\/)+/i, 'https://');
  if (!/^https:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
    if (!usableDeskHost(host)) return null;
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
    return path === '/a' || path.startsWith('/a/') || path.startsWith('/helpdesk') || path.startsWith('/support/');
  } catch {
    return false;
  }
}
