// Human: MV3 service worker. Holds the Freshservice API key out of the page JS world.
// Agent: READS/WRITES chrome.storage.local key sth.apiKey. Responds to sth.secrets.* messages from the content script.

const STORAGE_KEY = 'sth.apiKey';

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
  return undefined;
});
