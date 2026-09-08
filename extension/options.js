// Human: Extension options — user-configured custom desk origins. No tenant is hardcoded.
// Agent: Parses locally, then chrome.permissions.request in the same click (content scripts cannot request hosts). Worker round-trip before request drops the user-gesture and Chrome never shows the prompt.

const deskInput = document.getElementById('deskInput');
const deskStatus = document.getElementById('deskStatus');
const deskList = document.getElementById('deskList');

// Keep in sync with src/lib/hosts.ts and src/background.ts (this page is not bundled).
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

const BLOCKED_DESK_HOSTS = new Set([
  'https', 'http', 'ftp', 'file', 'javascript', 'mailto', 'about', 'chrome', 'edge', 'www',
]);

function usableDeskHost(host) {
  if (!host || host === 'localhost' || host.includes('..')) return false;
  if (host === 'github.com' || host.endsWith('.github.com') || host === 'api.github.com') return false;
  if (BLOCKED_DESK_HOSTS.has(host)) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host);
}

function parseDeskOrigin(raw) {
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

function send(message) {
  return chrome.runtime.sendMessage(message);
}

// Human: A sleeping MV3 worker can drop the first message after the permission dialog.
// Agent: CALLS chrome.runtime.sendMessage up to 3 times. RETURNS the last successful payload or throws.
async function sendRetry(message) {
  let lastErr;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await send(message);
    } catch (err) {
      lastErr = err;
      if (i < 2) await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
  }
  throw lastErr;
}

function setStatus(text, kind) {
  deskStatus.textContent = text;
  deskStatus.className = kind === 'err' ? 'hint err' : kind === 'ok' ? 'hint ok' : 'hint';
}

async function render() {
  try {
    const res = await sendRetry({ type: 'sth.desks.list' });
    const desks = Array.isArray(res?.desks) ? res.desks : [];
    deskList.replaceChildren();
    desks.forEach((row) => {
      const origin = String(row.origin || '');
      if (!origin) return;
      const item = document.createElement('div');
      item.className = 'desk';
      const code = document.createElement('code');
      code.textContent = origin.replace(/^https:\/\//, '');
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost';
      del.textContent = 'Remove';
      del.addEventListener('click', async () => {
        try {
          await sendRetry({ type: 'sth.desks.remove', origin });
          await render();
        } catch {
          setStatus('Could not remove that desk. Try again.', 'err');
        }
      });
      item.append(code, del);
      deskList.appendChild(item);
    });
  } catch {
    setStatus('Could not load saved desks. Reload this tab.', 'err');
  }
}

const PARSE_HINT = 'Paste the desk address from the browser bar, like https://desk.example.com';
const addBtn = document.getElementById('addDesk');
let addInFlight = false;

function saveErrorMessage(error) {
  if (error === 'bad_url') return PARSE_HINT;
  return 'Could not save that desk. Try Add again.';
}

async function addDesk() {
  if (addInFlight) return;
  const parsed = parseDeskOrigin(deskInput.value);
  if (!parsed) {
    setStatus(PARSE_HINT, 'err');
    return;
  }
  if (parsed.builtin) {
    setStatus('That host is already included (*.freshservice.com / *.myfreshworks.com).', 'ok');
    return;
  }
  const pattern = originMatchPattern(parsed.origin);
  if (!pattern) {
    setStatus(PARSE_HINT, 'err');
    return;
  }
  addInFlight = true;
  addBtn.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      setStatus('Chrome needs site access to show the panel on that desk.', 'err');
      return;
    }
    const saved = await sendRetry({ type: 'sth.desks.add', origin: parsed.origin });
    if (!saved?.ok) {
      setStatus(saveErrorMessage(saved?.error), 'err');
      return;
    }
    deskInput.value = '';
    setStatus('Saved. If the desk is already open, refresh it or click the toolbar icon.', 'ok');
    await render();
  } catch {
    setStatus('Could not save that desk. Try Add again.', 'err');
  } finally {
    addInFlight = false;
    addBtn.disabled = false;
  }
}

addBtn.addEventListener('click', () => { void addDesk(); });
deskInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void addDesk();
  }
});
try {
  const prefill = new URLSearchParams(location.search).get('desk');
  if (prefill) {
    deskInput.value = prefill;
    setStatus('Click Add and allow site access for this desk.', 'ok');
  }
} catch { /* ignore */ }
void render();
