// Human: Content-script entry. Mounts the shadow panel on Freshservice / Freshworks list pages.
// Agent: WRITES #sth-host and #sth-page-style; observer ignores our start-column writes so paint cannot loop.

import { HOST_ID, STYLE_ID } from './lib/constants';
import { shouldIgnoreMutations } from './page/mutations';
import { markTickets } from './page/paint';
import { runtime } from './page/runtime';
import { initPanel } from './panel/ui';
// New context-specific cards: registerPanelFeature() from ./panel/features and import that module here.

document.getElementById(HOST_ID)?.remove();
document.getElementById(STYLE_ID)?.remove();
window.__staleTicketObserver?.disconnect();

const pageStyle = document.createElement('style');
pageStyle.id = STYLE_ID;
document.head.appendChild(pageStyle);

const host = document.createElement('div');
host.id = HOST_ID;
host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:20px;right:20px;top:auto;left:auto;touch-action:none;';
document.documentElement.appendChild(host);
const shadow = host.attachShadow({ mode: 'open' });

initPanel(host, shadow);
markTickets();

let timer: ReturnType<typeof setTimeout>;
window.__staleTicketObserver = new MutationObserver((muts) => {
  if (shouldIgnoreMutations(muts, host)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    markTickets();
    runtime.onPageChange();
  }, 300);
});
window.__staleTicketObserver.observe(document.body, { childList: true, subtree: true });
