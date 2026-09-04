// Human: API key access for the panel. Extension builds talk to the service worker; userscripts fall back to sessionStorage.
// Agent: NEVER writes the key into sth-settings-v2. Content script may hold the value only while the settings field is focused.

const USERSCRIPT_KEY = 'sth-secret-api-key';

export function hasExtensionRuntime(): boolean {
  try {
    return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string' && chrome.runtime.id.length > 0;
  } catch {
    return false;
  }
}

export function maskApiKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  if (k.length <= 4) return '••••';
  return `••••${k.slice(-4)}`;
}

async function send(message: { type: string; apiKey?: string }): Promise<{ apiKey?: string; ok?: boolean }> {
  const raw = await chrome.runtime.sendMessage(message);
  return (raw || {}) as { apiKey?: string; ok?: boolean };
}

export async function getApiKey(): Promise<string> {
  if (hasExtensionRuntime()) {
    try {
      const res = await send({ type: 'sth.secrets.get' });
      return String(res.apiKey || '');
    } catch {
      return '';
    }
  }
  try {
    return sessionStorage.getItem(USERSCRIPT_KEY) || '';
  } catch {
    return '';
  }
}

export async function setApiKey(apiKey: string): Promise<void> {
  const value = apiKey.trim();
  if (hasExtensionRuntime()) {
    await send({ type: 'sth.secrets.set', apiKey: value });
    return;
  }
  if (value) sessionStorage.setItem(USERSCRIPT_KEY, value);
  else sessionStorage.removeItem(USERSCRIPT_KEY);
}

export async function clearApiKey(): Promise<void> {
  if (hasExtensionRuntime()) {
    await send({ type: 'sth.secrets.clear' });
    return;
  }
  sessionStorage.removeItem(USERSCRIPT_KEY);
}
