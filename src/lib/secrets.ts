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

// Human: After an extension reload, chrome.runtime throws. That is not the userscript build.
// Agent: RETURNS true only when chrome exists but the extension context is dead. Userscripts have no chrome.
export function extensionContextBroken(): boolean {
  if (typeof chrome === 'undefined' || !chrome.runtime) return false;
  try {
    return typeof chrome.runtime.id !== 'string' || chrome.runtime.id.length === 0;
  } catch {
    return true;
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
  // Human: A dead extension context must not read a key out of the page.
  if (extensionContextBroken()) return '';
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
  if (extensionContextBroken()) {
    throw new Error('extension_context_invalidated');
  }
  if (value) sessionStorage.setItem(USERSCRIPT_KEY, value);
  else sessionStorage.removeItem(USERSCRIPT_KEY);
}

export async function clearApiKey(): Promise<void> {
  if (hasExtensionRuntime()) {
    await send({ type: 'sth.secrets.clear' });
    return;
  }
  if (extensionContextBroken()) {
    throw new Error('extension_context_invalidated');
  }
  sessionStorage.removeItem(USERSCRIPT_KEY);
}
