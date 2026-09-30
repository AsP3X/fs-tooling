// Human: Content-script entry. Mounts the shadow panel on Freshservice / Freshworks list pages.
// Agent: WRITES #sth-host and #sth-page-style. Page observers live in page/observers.ts (childList repaint +
// attribute guard); our start-column writes are ignored so paint cannot loop.

import { HOST_DEFAULT_INSET_PX, HOST_ID, STYLE_ID } from './lib/constants';
import { hasExtensionRuntime } from './lib/secrets';
import { startListObservers } from './page/observers';
import { disposePaint, markTickets, visualSortActive } from './page/paint';
import { runtime } from './page/runtime';
import { installSelectionGuard } from './page/selection-guard';
import { initPanel } from './panel/ui';
// New context-specific cards: registerPanelFeature() from ./panel/features and import that module here.

document.getElementById(HOST_ID)?.remove();
document.getElementById(STYLE_ID)?.remove();
window.__staleTicketObserver?.disconnect();
window.__sthAttrObserver?.disconnect();
window.__sthTeardown?.();

const pageStyle = document.createElement('style');
pageStyle.id = STYLE_ID;
document.head.appendChild(pageStyle);

const host = document.createElement('div');
host.id = HOST_ID;
host.style.cssText = `all:initial;position:fixed;z-index:2147483647;bottom:${HOST_DEFAULT_INSET_PX}px;left:${HOST_DEFAULT_INSET_PX}px;top:auto;right:auto;touch-action:none;`;
document.documentElement.appendChild(host);
const shadow = host.attachShadow({ mode: 'open' });

initPanel(host, shadow);
markTickets();

if (hasExtensionRuntime()) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'sth.panel.reveal') return undefined;
    runtime.revealPanel();
    sendResponse({ ok: true });
    return true;
  });
}

const observers = startListObservers(document.body, host, () => {
  markTickets();
  runtime.onPageChange();
});
window.__staleTicketObserver = observers.childObserver;
window.__sthAttrObserver = observers.attrObserver;

// Row-height changes are handled inside paint.ts (ResizeObserver on visually sorted rows).
const removeSelectionGuard = installSelectionGuard(window, visualSortActive, (message) => runtime.notify(message));
// Agent: Called by the next injected instance. Stops pending repaints and the paint module's observers so
// two instances never write marks / offsets to the same table.
window.__sthTeardown = () => {
  observers.stop();
  removeSelectionGuard();
  disposePaint();
};
