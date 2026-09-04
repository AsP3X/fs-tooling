// Human: Content-script entry. Mounts the shadow panel on Freshservice / Freshworks list pages.
// Agent: WRITES #sth-host and #sth-page-style; disconnects a previous observer so re-injects (HMR/reload) stay single-instance.

import { HOST_ID, STYLE_ID } from './lib/constants';
import { markTickets } from './page/paint';
import { initPanel } from './panel/ui';

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
  if (muts.every((m) => host.contains(m.target) || (m.target instanceof Element && m.target.closest(`#${HOST_ID}`)))) {
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(markTickets, 300);
});
window.__staleTicketObserver.observe(document.body, { childList: true, subtree: true });
