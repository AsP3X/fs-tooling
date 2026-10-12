// Human: Shadow-DOM ops panel: quick filter chips, sort, date-range overlay, Manage dialog, GitHub update toast, drag position.
// Agent: READS/WRITES settings via patchRoot/patchPage; CALLS markTickets on highlight-filter changes. Range overlay CALLS listRangeResults and does not mutate the host table.
// WRITES window.__sthPanelTeardown, which removes every document/window listener this module adds.

import { listRangeResults } from '../lib/api/enrich';
import { contextLabel, detectContext } from '../lib/context';
import { HOST_DEFAULT_INSET_PX } from '../lib/constants';
import { formatStart } from '../lib/dates';
import { missingColumnsForRule, missingColumnsMessage, visibleColumnNames } from '../lib/columns';
import { accentColor } from '../lib/filters';
import { formatRangeLabel, normalizeRange, rangeActive, rangeApplyReady, rangeListingEnabled } from '../lib/range';
import { detectModule } from '../lib/detect';
import { savedPoint } from '../lib/settings';
import { collectRows } from '../lib/rows';
import { clearApiKey, getApiKey, hasExtensionRuntime, maskApiKey, setApiKey } from '../lib/secrets';
import { assignRoot, getLastMarkedUrls, getLastRangeMeta, getLastRangeResults, getLastStats, getModuleId, getSettings, hasApiKeyPresent, page, patchPage, patchRoot, setApiKeyPresent, setLastRangeResults, setModuleId } from '../lib/state';
import { escapeHtml } from '../lib/text';
import type { FilterRule, ModuleId, ModuleSetting, PageSettings, SortDir, SortKey } from '../lib/types';
import { markTickets, openMarked } from '../page/paint';
import { trackCurrentTicket } from '../page/ops-track';
import { runtime } from '../page/runtime';
import { applyPageStyles } from '../page/styles';
import { syncStartColumnHeader } from '../page/start-column';
import { applyFeatureVisibility, syncRegisteredFeatures } from './features';
import { initAbout } from './about';
import { initManage } from './manage';
import { initStats } from './stats';
import { initUpdateToast } from './update-toast';
import panelCss from './panel.css?raw';
import panelHtml from './panel.html?raw';

// Human: A range request that has not answered by now is shown as failed, so "Loading…" cannot stay forever.
const RANGE_TIMEOUT_MS = 60_000;

export function initPanel(host: HTMLElement, shadow: ShadowRoot): void {
  shadow.innerHTML = `<style>${panelCss}</style>${panelHtml}`;

  // Human: Listeners on document / window outlive the host element. Register them here so a re-inject can
  // remove them; two live copies would each handle the same click.
  // Agent: WRITES cleanups. RETURNS a remover for listeners that end early (drag). teardown() runs the rest.
  const cleanups = new Set<() => void>();
  const listen = (target: EventTarget, type: string, handler: EventListener, capture = false): (() => void) => {
    target.addEventListener(type, handler, capture);
    const off = (): void => {
      target.removeEventListener(type, handler, capture);
      cleanups.delete(off);
    };
    cleanups.add(off);
    return off;
  };

  const $ = (id: string): HTMLElement => {
    const el = shadow.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el;
  };
  const panel = $('panel');
  const fab = $('fab');
  const settingsPanel = $('settingsPanel');
  const resultsPanel = $('resultsPanel');
  const filterPanel = $('filterPanel');
  const statsPanel = $('statsPanel');
  const chromeRow = $('chromeRow');
  const about = initAbout(shadow);
  let settingsOpen = false;
  let resultsOpen = false;
  let filterOpen = false;
  let statsOpen = false;
  let panelPin: { x: number; y: number } | null = null;
  const didDrag = { current: false };
  // Human: Unsaved From/To. It belongs to rangeModule, the list the inputs were filled for.
  // Agent: syncUI drops the draft and refills the inputs when the page's module is no longer rangeModule.
  let rangeDraft: { startFrom: string | null; startTo: string | null } | null = null;
  let rangeModule: ModuleId = detectModule(getSettings().module);
  // Human: The last range request failed although a key is saved. Not the same as "no key" or an empty result.
  let rangeFailed = false;
  const liveModule = (): ModuleId => detectModule(getSettings().module);

  // Human: Range overlay — our table only. Does not hide or rebuild the live Freshservice list.
  // Agent: READS getLastRangeResults + rangeFailed; WRITES #resultsBody. Three different empty states: failed
  // request (retry), partial list, and a real "nothing in this range". CALLS loadAndRenderRange from Retry.
  function renderResults(): void {
    const cfg = page();
    const meta = getLastRangeMeta();
    const rows = getLastRangeResults();
    const journeys = getModuleId() === 'journeys';
    const dateHead = journeys ? 'Start' : 'Updated';
    const ranged = rangeActive(cfg.startFrom, cfg.startTo);
    const body = $('resultsBody');
    $('resultsTitle').textContent = 'Range results';
    const rangeBit = ranged ? ` · ${formatRangeLabel(cfg.startFrom, cfg.startTo)}` : '';
    const src = rangeFailed
      ? 'list not loaded'
      : meta.fromApi ? (meta.truncated ? 'API · partial list' : 'API') : 'this page';
    $('resultsSub').textContent = `${rows.length} rows${rangeBit} · ${src}`;
    if (!ranged) {
      body.innerHTML = '<p class="note">Set From and/or To to list items. Freshservice’s table stays as it is.</p>';
      return;
    }
    const failed = rangeFailed
      ? `<p class="note">Couldn’t load the list from Freshservice.${rows.length ? ' Showing matches from this page only.' : ''}</p><button class="ghost" id="retryRange" type="button">Retry</button>`
      : '';
    const partial = !rangeFailed && meta.truncated
      ? '<p class="note">Partial list. Not every item in this range was loaded. Narrow the range to see the rest.</p>'
      : '';
    if (!rows.length) {
      body.innerHTML = failed || `${partial}<p class="note">${meta.truncated ? 'No items were loaded for this range.' : 'No items in this range.'}</p>`;
    } else {
      const sorted = [...rows].sort((a, b) => {
        const ka = (journeys ? a.startKey : a.updatedKey) || a.startKey || a.updatedKey || '';
        const kb = (journeys ? b.startKey : b.updatedKey) || b.startKey || b.updatedKey || '';
        return ka.localeCompare(kb);
      });
      body.innerHTML = `${failed}${partial}<table class="split"><thead><tr><th>${dateHead}</th><th>Status</th><th>Item</th></tr></thead><tbody>${sorted.map((row) => {
        const key = journeys ? row.startKey : row.updatedKey;
        const date = key ? escapeHtml(formatStart(key)) : '—';
        const label = escapeHtml(row.label || row.status);
        const cell = row.href
          ? `<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">${label}</a>`
          : label;
        return `<tr><td>${date}</td><td>${escapeHtml(row.status)}</td><td>${cell}</td></tr>`;
      }).join('')}</tbody></table><p class="note">This table is ours. Freshservice’s list, pager, and sort are unchanged.</p>`;
    }
    body.querySelector('#retryRange')?.addEventListener('click', () => { void loadAndRenderRange(true); });
  }

  // Human: Load the overlay rows for the current list. A request is dropped when a newer one started or the
  // page moved to the other module, so ticket rows never land under the journeys heading.
  // Agent: CALLS listRangeResults. fromApi:false with a saved key means the request failed (401, worker error,
  // thrown). A thrown or unanswered request is also a failure. WRITES rangeFailed + setLastRangeResults.
  let rangeGen = 0;
  async function loadAndRenderRange(force = false): Promise<void> {
    if (!rangeListingEnabled(hasApiKeyPresent())) {
      $('resultsBody').innerHTML = '<p class="note">Save an API key in Settings to list by date range.</p>';
      return;
    }
    const gen = ++rangeGen;
    const moduleAtStart = getModuleId();
    const current = (): boolean => gen === rangeGen && moduleAtStart === getModuleId();
    const fail = (): void => {
      rangeFailed = true;
      setLastRangeResults([], { truncated: false, fromApi: false });
      renderResults();
    };
    rangeFailed = false;
    $('resultsBody').innerHTML = '<p class="note">Loading…</p>';
    // Agent: The timer only reports; a late answer for the same request still replaces the failure.
    const timer = setTimeout(() => { if (current()) fail(); }, RANGE_TIMEOUT_MS);
    let result: Awaited<ReturnType<typeof listRangeResults>>;
    try {
      result = await listRangeResults(collectRows(), force);
    } catch {
      if (current()) fail();
      return;
    } finally {
      clearTimeout(timer);
    }
    if (!current()) return;
    rangeFailed = !result.fromApi;
    setLastRangeResults(result.rows, { truncated: result.truncated, fromApi: result.fromApi });
    renderResults();
  }

  // Human: Draft From/To until Apply. Saved settings are the applied range.
  function shownRange(): { startFrom: string | null; startTo: string | null } {
    if (rangeDraft) return rangeDraft;
    const cfg = page();
    return { startFrom: cfg.startFrom, startTo: cfg.startTo };
  }

  function expandRangeSection(): void {
    const open = { ...(getSettings().uiOpen || {}), range: true };
    if (getSettings().collapsed) patchRoot({ collapsed: false, uiOpen: open });
    else patchRoot({ uiOpen: open });
    syncUI();
  }

  function showResults(): void {
    if (!rangeListingEnabled(hasApiKeyPresent())) {
      expandRangeSection();
      return;
    }
    const cfg = page();
    if (!rangeActive(cfg.startFrom, cfg.startTo)) {
      expandRangeSection();
      return;
    }
    resultsOpen = true;
    statsOpen = false;
    filterOpen = false;
    settingsOpen = false;
    if (getSettings().collapsed) patchRoot({ collapsed: false });
    syncUI();
    void loadAndRenderRange(false);
  }

  // Human: Save a range for one list and, when that is the list on screen, open or close the overlay.
  // Agent: WRITES settings[moduleId].startFrom/startTo (not "whichever module is current"). A write for a
  // module the page has left only saves. Clearing bumps rangeGen so a pending request cannot refill the rows.
  function setRange(from: string | null, to: string | null, openTable = true, moduleId: ModuleId = liveModule()): void {
    const next = normalizeRange(from, to);
    const active = rangeActive(next.startFrom, next.startTo);
    if (active && !rangeListingEnabled(hasApiKeyPresent())) return;
    rangeDraft = null;
    patchRoot({ [moduleId]: { ...getSettings()[moduleId], startFrom: next.startFrom, startTo: next.startTo, activePreset: null } });
    const onScreen = moduleId === liveModule();
    if (onScreen && active && openTable) {
      resultsOpen = true;
      statsOpen = false;
      filterOpen = false;
      settingsOpen = false;
      if (getSettings().collapsed) patchRoot({ collapsed: false });
    } else if (onScreen && !active) {
      resultsOpen = false;
      rangeGen += 1;
      rangeFailed = false;
      setLastRangeResults([], { truncated: false, fromApi: false });
    }
    syncUI();
    syncStartColumnHeader();
    if (onScreen && active && resultsOpen) void loadAndRenderRange(true);
  }

  // Human: Commit the date inputs and open the overlay. No-op without a key or dates.
  // Agent: CALLS setRange for rangeModule. If the page moved to the other list since the inputs were filled,
  // the draft is discarded and syncUI shows that list's saved range instead. Does not run on input change.
  function applyRange(): void {
    if (!rangeListingEnabled(hasApiKeyPresent())) return;
    if (rangeModule !== liveModule()) {
      rangeDraft = null;
      syncUI();
      return;
    }
    const next = normalizeRange(
      ($('rangeFrom') as HTMLInputElement).value,
      ($('rangeTo') as HTMLInputElement).value,
    );
    if (!rangeActive(next.startFrom, next.startTo)) return;
    setRange(next.startFrom, next.startTo, true, rangeModule);
  }

  function openRangeUrls(): void {
    const urls = [...new Set(getLastRangeResults().map((row) => row.href).filter((u): u is string => !!u))];
    if (!urls.length) return;
    if (urls.length > 8 && !confirm(`Open ${urls.length} listed items in new tabs?`)) return;
    let opened = 0;
    urls.forEach((url) => {
      if (window.open(url, '_blank', 'noopener')) opened += 1;
    });
    if (opened < urls.length) alert(`Opened ${opened} of ${urls.length} tabs. Allow pop-ups for this site.`);
  }

  // Human: A side dialog (Manage / Statistics) sits next to the main panel inside the same host.
  const sideOpen = (): boolean => (filterOpen || statsOpen) && !panel.classList.contains('hide');

  // Human: Keep a box of the given size inside the viewport. Defaults to the host; pass the main panel's box
  // when a side dialog is open, because the host is then wider and taller than the docked panel.
  function clampPos(
    x: number,
    y: number,
    box: { width: number; height: number } = host.getBoundingClientRect(),
  ): { x: number; y: number } {
    const pad = 8;
    return {
      x: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - box.width - pad)),
      y: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - box.height - pad)),
    };
  }
  // Human: The dock that would put the main panel where it is now once the side dialog closes.
  // Agent: RETURNS the host origin, or with a side dialog open the main panel's corner less whatever sits above
  // the row (notices). The host origin is wrong then: a dialog on the left or a taller dialog offsets the panel.
  function dockPoint(): { x: number; y: number } {
    const hostRect = host.getBoundingClientRect();
    if (!sideOpen()) return { x: hostRect.left, y: hostRect.top };
    const main = panel.getBoundingClientRect();
    const row = chromeRow.getBoundingClientRect();
    return { x: main.left, y: main.top - (row.top - hostRect.top) };
  }
  function placeDefault(): void {
    host.style.top = 'auto';
    host.style.right = 'auto';
    host.style.left = `${HOST_DEFAULT_INSET_PX}px`;
    host.style.bottom = `${HOST_DEFAULT_INSET_PX}px`;
  }
  function placeAt(x: number, y: number): { x: number; y: number } {
    const p = clampPos(x, y);
    host.style.left = p.x + 'px';
    host.style.top = p.y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    return p;
  }
  // Human: Collapsed uses fabX/fabY; expanded uses x/y. Unset dock → default lower-left.
  // Agent: READS settings.collapsed + dock coords. WRITES host left/top, or left/bottom when that dock is unset.
  function applySavedPosition(): void {
    const settings = getSettings();
    const dock = settings.collapsed
      ? savedPoint(settings.fabX, settings.fabY)
      : savedPoint(settings.x, settings.y);
    void host.offsetWidth;
    if (dock) placeAt(dock.x, dock.y);
    else placeDefault();
  }

  // Human: Put the side dialog where there is room for it, judged from where the main panel is pinned.
  // Agent: READS panelPin, falling back to the measured panel rect when no pin is set. WRITES flex order on the
  // dialog and the panel, and #chromeRow data-side. Never writes x/y/fabX/fabY. The measured left is not
  // usable while a pin exists: syncUI unhides the dialog before this runs, and with no order yet (or the order
  // of an earlier opening) the dialog can sit left of the panel and displace it by its own width.
  function placeSidePanel(sideEl: HTMLElement): void {
    const measured = panel.getBoundingClientRect();
    const left = panelPin ? panelPin.x : measured.left;
    const need = 488;
    const rightSpace = window.innerWidth - (left + measured.width);
    const leftSpace = left;
    const side = rightSpace >= need || rightSpace >= leftSpace ? 'right' : 'left';
    sideEl.style.order = side === 'left' ? '0' : '2';
    panel.style.order = '1';
    chromeRow.dataset.side = side;
  }

  // Human: Keep the main panel where it is when the side dialog opens or grows. Also the one entry point for
  // "re-place the host": with no side dialog it falls back to the saved dock.
  // Agent: WRITES host left/top so panel.getBoundingClientRect matches panelPin, then clamps the pair. Never
  // writes x/y/fabX/fabY.
  function pinChrome(): void {
    void host.offsetWidth;
    if (panel.classList.contains('hide') || (!filterOpen && !statsOpen)) {
      applySavedPosition();
      return;
    }
    placeSidePanel(filterOpen ? filterPanel : statsPanel);
    void host.offsetWidth;
    const main = panel.getBoundingClientRect();
    if (!panelPin) panelPin = { x: main.left, y: main.top };
    const hostRect = host.getBoundingClientRect();
    placeAt(hostRect.left + (panelPin.x - main.left), hostRect.top + (panelPin.y - main.top));
  }

  function renderStats(): void {
    const lastStats = getLastStats();
    const totalMarked = lastStats.marked + lastStats.extraMarked;
    $('fabCount').textContent = String(totalMarked);
    const ctx = detectContext(getSettings().module);
    const labels = contextLabel(ctx);
    if (ctx.surface === 'list') {
      const prefix = getSettings().module === 'auto' ? `Auto · ${labels.title}` : labels.title;
      const extra = lastStats.extraMarked ? ` +${lastStats.extraMarked} off-page` : '';
      $('panelSub').textContent = `${prefix} · ${lastStats.marked}/${lastStats.tickets}${extra}`;
    }
    // Human: The chip's accessible name carries what the two inner spans show.
    fab.setAttribute('aria-label', `${labels.title} · ${totalMarked} marked. Expand panel`);
    // Human: Nothing to open → the button is off instead of doing nothing on click.
    // Agent: READS getLastMarkedUrls (what openMarked opens), not the marked-row count.
    const openBtn = $('openStale') as HTMLButtonElement;
    openBtn.textContent = totalMarked ? `Open ${totalMarked} marked` : 'Open marked tabs';
    openBtn.disabled = getLastMarkedUrls().length === 0;
  }
  const onPageChange = (): void => {
    syncUI();
    void trackCurrentTicket().then(() => { if (statsOpen) stats.sync(); });
  };
  // Human: Page-level notice (blocked shift-select, etc.). Auto-hides; a new message restarts the timer.
  // Agent: WRITES #pageNotice text/hidden in the shadow root. CALLS pinChrome so the host re-clamps after the
  // height change: with Manage / Statistics open the main panel keeps its place instead of jumping to the dock.
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (message: string): void => {
    const notice = $('pageNotice');
    $('pageNoticeText').textContent = message;
    notice.hidden = false;
    pinChrome();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
      pinChrome();
    }, 7000);
  };
  const revealPanel = (): void => {
    settingsOpen = false;
    resultsOpen = false;
    filterOpen = false;
    statsOpen = false;
    updateRoot({ collapsed: false });
    requestAnimationFrame(() => pinChrome());
  };
  runtime.renderStats = renderStats;
  runtime.onPageChange = onPageChange;
  runtime.notify = notify;
  runtime.revealPanel = revealPanel;

  async function refreshApiKeyStatus(): Promise<void> {
    const key = await getApiKey();
    const present = !!key.trim();
    $('apiKeyStatus').textContent = present ? `Saved · ${maskApiKey(key)}` : 'No key saved';
    $('settingsSub').textContent = present ? 'API key saved' : 'API access';
    setApiKeyPresent(present);
    if (!present && resultsOpen) {
      resultsOpen = false;
      setLastRangeResults([], { truncated: false, fromApi: false });
    }
    syncUI();
    syncStartColumnHeader();
  }

  let chipSig = '';
  function renderFilterChips(): void {
    const wrap = $('filterChips');
    const warnEl = shadow.getElementById('filterWarn');
    const filters = page().filters || [];
    const visible = visibleColumnNames(document);
    const api = hasApiKeyPresent();
    const cols = [...visible].sort().join(',');
    // Agent: Criteria are part of the signature. The column warning and the amber chip are derived from them,
    // so a rule edited in Manage must not hit the early return.
    const sig = `${cols}|${api ? 1 : 0}|${filters.map((r) => `${r.id}:${r.enabled ? 1 : 0}:${r.color}:${r.name}:${JSON.stringify(r.criteria || {})}`).join('|')}`;
    if (sig === chipSig && wrap.childElementCount === filters.length) return;
    chipSig = sig;
    const warnings = filters
      .filter((r) => r.enabled)
      .map((r) => missingColumnsMessage(missingColumnsForRule(r, visible, api)))
      .filter(Boolean);
    if (warnEl) {
      warnEl.hidden = !warnings.length;
      warnEl.textContent = warnings[0] || '';
    }
    wrap.innerHTML = filters.map((rule) => {
      const warn = missingColumnsMessage(missingColumnsForRule({ ...rule, enabled: true }, visible, api));
      const missingOn = rule.enabled && warn;
      return `<button type="button" class="chip filter-chip${rule.enabled ? ' on' : ''}${missingOn ? ' warn' : ''}" data-filter="${escapeHtml(rule.id)}" ${warn ? `title="${escapeHtml(warn)}"` : ''}><span class="sw" style="background:${escapeHtml(rule.color)}"></span>${escapeHtml(rule.name)}</button>`;
    }).join('');
    wrap.querySelectorAll('button[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.filter || '';
        const cur = (page().filters || []).find((r) => r.id === id);
        const enabling = !cur?.enabled;
        const next = (page().filters || []).map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
        if (enabling && cur && warnEl) {
          const msg = missingColumnsMessage(missingColumnsForRule({ ...cur, enabled: true }, visibleColumnNames(document), hasApiKeyPresent()));
          warnEl.hidden = !msg;
          warnEl.textContent = msg;
        }
        applyFilters(next);
      });
    });
  }

  function applyFilters(filters: FilterRule[]): void {
    updatePage({ filters, color: accentColor({ ...page(), filters }, getModuleId()) });
  }

  function sortOptions(): Array<{ id: SortKey; name: string }> {
    if (getModuleId() === 'journeys') {
      return [
        { id: 'default', name: 'Default' },
        { id: 'start', name: 'Start date' },
        { id: 'created', name: 'Created On' },
        { id: 'initiator', name: 'Initiator' },
        { id: 'status', name: 'Request Status' },
        { id: 'progress', name: 'Child progress' },
      ];
    }
    return [
      { id: 'default', name: 'Default' },
      { id: 'created', name: 'Created' },
      { id: 'status', name: 'Status' },
    ];
  }

  function renderSortKeys(): void {
    const wrap = $('sortKeys');
    const cfg = page();
    wrap.innerHTML = sortOptions().map((opt) =>
      `<button type="button" class="chip${cfg.sortKey === opt.id ? ' on' : ''}" data-sort="${opt.id}">${escapeHtml(opt.name)}</button>`,
    ).join('');
    wrap.querySelectorAll('button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = ((btn as HTMLElement).dataset.sort || 'default') as SortKey;
        if (page().sortKey === id && id !== 'default') {
          updatePage({ sortDir: page().sortDir === 'asc' ? 'desc' : 'asc' });
        } else {
          updatePage({ sortKey: id });
        }
      });
    });
    shadow.querySelectorAll('#sortDir button').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).dataset.dir === cfg.sortDir);
    });
    const label = sortOptions().find((o) => o.id === cfg.sortKey)?.name || 'Default';
    const badge = $('sortBadge');
    if (badge) badge.textContent = label;
    $('sortHint').textContent = cfg.sortKey === 'default'
      ? 'Table order from Freshservice.'
      : `Sorted by ${label}, ${cfg.sortDir === 'desc' ? 'newest / Z first' : 'oldest / A first'}. Visual only: keyboard navigation follows Freshservice's order, and shift-select is paused while sorted.`;
  }

  function syncUI(): void {
    setModuleId(detectModule(getSettings().module));
    const ctx = detectContext(getSettings().module);
    const cfg = page();
    const settings = getSettings();
    const labels = contextLabel(ctx);
    const accent = accentColor(cfg, getModuleId());
    shadow.querySelectorAll<HTMLElement>('.panel, .fab, .logo, .toggle, input[type="range"], .primary, .update-toast').forEach((el) => {
      el.style.setProperty('--accent', accent);
    });
    $('panelTitle').textContent = labels.title;
    $('fabLabel').textContent = labels.title;
    if (ctx.surface !== 'list') {
      $('panelSub').textContent = labels.sub;
      $('contextHintText').textContent = ctx.surface === 'detail'
        ? 'List filters apply on ticket and journey tables. The API key is in Settings (gear icon).'
        : 'Open a ticket or journeys list to use filters.';
    }
    $('enabled').classList.toggle('on', cfg.enabled);
    shadow.querySelectorAll('#moduleSeg button').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).dataset.module === settings.module);
    });
    const journeys = getModuleId() === 'journeys';
    const canRange = rangeListingEnabled(hasApiKeyPresent());
    // Human: The page moved to the other list. An unsaved range was typed for the previous one: drop it, show
    // this list's saved range (even while an input has focus), and stop any request still loading the old list.
    // Agent: WRITES rangeModule, rangeGen. The open overlay reloads for the new list, or closes without a range.
    const moduleChanged = rangeModule !== getModuleId();
    let reloadResults = false;
    if (moduleChanged) {
      rangeModule = getModuleId();
      rangeDraft = null;
      rangeGen += 1;
      rangeFailed = false;
      setLastRangeResults([], { truncated: false, fromApi: false });
      reloadResults = resultsOpen && canRange && rangeActive(cfg.startFrom, cfg.startTo);
      if (!reloadResults) resultsOpen = false;
    }
    const shown = shownRange();
    const rangeCard = shadow.querySelector<HTMLElement>('[data-feature="list-range"]');
    rangeCard?.classList.toggle('range-locked', !canRange);
    $('rangeCaption').textContent = journeys ? 'Start date range' : 'Updated range';
    $('rangeHint').textContent = !canRange
      ? 'Save an API key in Settings to list by date range.'
      : journeys
        ? 'Set From / to, then Apply. Lists journeys by start date. Freshservice’s list is left alone.'
        : 'Set From / to, then Apply. Lists tickets by updated_at. Freshservice’s list is left alone.';
    const rangeText = formatRangeLabel(cfg.startFrom, cfg.startTo);
    $('rangeBadge').textContent = !canRange ? 'Needs key' : (rangeText || 'Off');
    const fromInput = $('rangeFrom') as HTMLInputElement;
    const toInput = $('rangeTo') as HTMLInputElement;
    const editingRange = shadow.activeElement === fromInput || shadow.activeElement === toInput;
    if (!editingRange || moduleChanged) {
      fromInput.value = shown.startFrom || '';
      toInput.value = shown.startTo || '';
    }
    fromInput.disabled = !canRange;
    toInput.disabled = !canRange;
    const applyBtn = $('applyRange') as HTMLButtonElement;
    const clearBtn = $('clearRange') as HTMLButtonElement;
    applyBtn.disabled = !rangeApplyReady(canRange, shown.startFrom, shown.startTo);
    clearBtn.disabled = !canRange;
    clearBtn.style.visibility = canRange && (rangeActive(shown.startFrom, shown.startTo) || rangeActive(cfg.startFrom, cfg.startTo))
      ? 'visible'
      : 'hidden';
    const open = settings.uiOpen || {};
    shadow.querySelectorAll<HTMLElement>('[data-sec]').forEach((el) => el.classList.toggle('open', !!open[el.dataset.sec || '']));
    const overlay = settingsOpen || resultsOpen;
    if (overlay || settings.collapsed) {
      filterOpen = false;
      statsOpen = false;
    }
    panel.classList.toggle('hide', settings.collapsed || overlay);
    fab.classList.toggle('show', settings.collapsed && !overlay);
    settingsPanel.classList.toggle('hide', !settingsOpen || settings.collapsed);
    resultsPanel.classList.toggle('show', resultsOpen && !settings.collapsed);
    resultsPanel.classList.toggle('hide', !resultsOpen || settings.collapsed);
    filterPanel.classList.toggle('hide', !filterOpen || settings.collapsed || overlay);
    statsPanel.classList.toggle('hide', !statsOpen || settings.collapsed || overlay);
    renderFilterChips();
    renderSortKeys();
    if (filterOpen) manage.sync();
    if (statsOpen) stats.sync();
    applyFeatureVisibility(shadow, ctx);
    syncRegisteredFeatures($('featureMount'), ctx);
    applyPageStyles();
    pinChrome();
    renderStats();
    if (reloadResults) void loadAndRenderRange(false);
  }

  function updateRoot(partial: Parameters<typeof patchRoot>[0]): void {
    patchRoot(partial);
    syncUI();
    if (!('x' in partial || 'y' in partial || 'fabX' in partial || 'fabY' in partial || 'collapsed' in partial)) markTickets();
  }

  function updatePage(partial: Partial<PageSettings>): void {
    patchPage(partial);
    syncUI();
    markTickets();
  }

  const manage = initManage(shadow, {
    onChange: (filters) => applyFilters(filters),
    onLayout: () => pinChrome(),
  });
  const stats = initStats(shadow, {
    onLayout: () => pinChrome(),
    onRefresh: () => trackCurrentTicket(location, document, { force: true }),
  });

  // Human: Drag by a header or the chip. The dock is saved from the main panel's corner, so dragging with a
  // side dialog open does not move the panel when the dialog closes.
  // Agent: WRITES host left/top, x/y or fabX/fabY (assignRoot while moving, patchRoot on release), panelPin,
  // didDrag. didDrag is cleared one task after pointerup: the click that ends this drag still sees it, the
  // next click on the chip does not.
  function makeDraggable(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (handle !== fab && (e.target as Element | null)?.closest?.('#collapse, .icon-btn, button, input, label')) return;
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const origX = rect.left;
      const origY = rect.top;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      didDrag.current = false;
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        didDrag.current = true;
        placeAt(origX + dx, origY + dy);
        const dock = dockPoint();
        if (getSettings().collapsed) assignRoot({ fabX: dock.x, fabY: dock.y });
        else assignRoot({ x: dock.x, y: dock.y });
        const main = panel.getBoundingClientRect();
        panelPin = { x: main.left, y: main.top };
      };
      const onUp = (): void => {
        offMove();
        offUp();
        if (!moved) return;
        const s = getSettings();
        if (s.collapsed) patchRoot({ fabX: s.fabX, fabY: s.fabY });
        else patchRoot({ x: s.x, y: s.y });
        setTimeout(() => { didDrag.current = false; }, 0);
      };
      const offMove = listen(window, 'pointermove', onMove as EventListener);
      const offUp = listen(window, 'pointerup', onUp);
    });
  }
  makeDraggable($('dragHandle'));
  makeDraggable($('statsHandle'));
  makeDraggable($('settingsHandle'));
  makeDraggable($('resultsHandle'));
  makeDraggable($('filterHandle'));
  makeDraggable(fab);

  shadow.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('[data-toggle]') as HTMLElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.toggle;
    if (!id) return;
    const open = { ...(getSettings().uiOpen || {}) };
    open[id] = !open[id];
    updateRoot({ uiOpen: open });
  });

  const apiKeyInput = $('apiKeyInput') as HTMLInputElement;
  // Human: Result of the last Save / Clear, next to (never instead of) the "Saved · ••••" status line.
  const keyNote = $('apiKeyNote');
  const showKeyNote = (message: string, err = false): void => {
    keyNote.textContent = message;
    keyNote.classList.toggle('err', err && !!message);
    keyNote.classList.toggle('hide', !message);
  };
  const rangeFromInput = $('rangeFrom') as HTMLInputElement;
  const rangeToInput = $('rangeTo') as HTMLInputElement;
  (['keydown', 'keypress', 'keyup'] as const).forEach((type) => {
    apiKeyInput.addEventListener(type, (e) => e.stopPropagation());
    rangeFromInput.addEventListener(type, (e) => e.stopPropagation());
    rangeToInput.addEventListener(type, (e) => e.stopPropagation());
  });
  const captureRangeDraft = () => {
    rangeDraft = normalizeRange(rangeFromInput.value, rangeToInput.value);
    const applyBtn = $('applyRange') as HTMLButtonElement;
    applyBtn.disabled = !rangeApplyReady(hasApiKeyPresent(), rangeDraft.startFrom, rangeDraft.startTo);
  };
  rangeFromInput.addEventListener('input', captureRangeDraft);
  rangeToInput.addEventListener('input', captureRangeDraft);
  rangeFromInput.addEventListener('change', captureRangeDraft);
  rangeToInput.addEventListener('change', captureRangeDraft);
  $('applyRange').addEventListener('click', applyRange);
  // Agent: Clears rangeModule's saved range, the one the inputs show, not a list the page navigated to.
  $('clearRange').addEventListener('click', () => {
    rangeDraft = null;
    setRange(null, null, false, rangeModule);
  });
  $('clearRangeFromResults').addEventListener('click', () => {
    resultsOpen = false;
    setRange(null, null, false);
  });
  $('openRangeTabs').addEventListener('click', openRangeUrls);
  $('closeResults').addEventListener('click', (e) => {
    e.stopPropagation();
    resultsOpen = false;
    syncUI();
  });
  $('enabled').addEventListener('click', () => updatePage({ enabled: !page().enabled }));
  shadow.querySelectorAll('#moduleSeg button').forEach((btn) => {
    btn.addEventListener('click', () => updateRoot({ module: ((btn as HTMLElement).dataset.module || 'auto') as ModuleSetting }));
  });
  shadow.querySelectorAll('#sortDir button').forEach((btn) => {
    btn.addEventListener('click', () => updatePage({ sortDir: ((btn as HTMLElement).dataset.dir || 'asc') as SortDir }));
  });
  $('openManage').addEventListener('click', () => {
    const main = panel.getBoundingClientRect();
    panelPin = { x: main.left, y: main.top };
    filterOpen = true;
    statsOpen = false;
    settingsOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
  });
  $('closeFilters').addEventListener('click', (e) => {
    e.stopPropagation();
    filterOpen = false;
    syncUI();
  });
  // Human: Minimize hides the panel (display:none), so focus moves to the chip. The chip is a tab stop with
  // role="button": click, Enter, or Space expands it and focus returns to Minimize.
  // Agent: WRITES settings.collapsed. The chip acts on keyup of a key it also saw go down (chipKey). Focus
  // changes hands on both actions, so acting on keydown would let the same held key press the other control,
  // and the keyup of the Enter that pressed Minimize would expand again. Enter/Space are stopped so
  // Freshservice shortcuts and page scroll do not run.
  const collapseBtn = $('collapse');
  let chipKey: string | null = null;
  const expandFromChip = (): void => {
    updateRoot({ collapsed: false });
    collapseBtn.focus();
  };
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chipKey = null;
    updateRoot({ collapsed: true });
    fab.focus();
  });
  fab.addEventListener('click', () => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    expandFromChip();
  });
  fab.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) chipKey = e.key;
  });
  fab.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    const armed = chipKey === e.key;
    chipKey = null;
    if (armed) expandFromChip();
  });
  fab.addEventListener('blur', () => { chipKey = null; });
  $('openStale').addEventListener('click', openMarked);
  const openStatsPanel = (): void => {
    const main = panel.getBoundingClientRect();
    panelPin = { x: main.left, y: main.top };
    statsOpen = true;
    filterOpen = false;
    settingsOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
    void trackCurrentTicket().then(() => stats.sync());
  };
  $('openStats').addEventListener('click', openStatsPanel);
  $('openStatsDetail').addEventListener('click', openStatsPanel);
  $('closeStats').addEventListener('click', (e) => {
    e.stopPropagation();
    statsOpen = false;
    syncUI();
  });
  const deskBtn = $('openDeskSettings');
  const deskStatus = $('deskSettingsStatus');
  if (!hasExtensionRuntime()) deskBtn.closest('.card')?.setAttribute('hidden', '');
  // Human: Content scripts cannot open the options page. A sleeping worker can drop the first message; retry before showing an error.
  // Agent: CALLS sth.desks.open (worker tabs.create). WRITES #deskSettingsStatus on failure.
  const openDeskSettings = async (): Promise<void> => {
    deskStatus.textContent = '';
    deskStatus.classList.add('hide');
    deskStatus.classList.remove('err');
    let lastErr: unknown;
    for (let i = 0; i < 3; i += 1) {
      try {
        const raw = await chrome.runtime.sendMessage({ type: 'sth.desks.open' });
        const res = (raw || {}) as { ok?: boolean };
        if (res.ok === true) return;
        lastErr = new Error('open_failed');
      } catch (err) {
        lastErr = err;
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 80 * (i + 1)));
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || '');
    deskStatus.textContent = /invalidated/i.test(msg)
      ? 'Reload this Freshservice tab, then try again.'
      : 'Couldn’t open Desk URL settings. Try the toolbar icon.';
    deskStatus.classList.add('err');
    deskStatus.classList.remove('hide');
  };
  deskBtn.addEventListener('click', () => { void openDeskSettings(); });
  $('openSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = true;
    filterOpen = false;
    statsOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
    showKeyNote('');
    void refreshApiKeyStatus();
    void about.refresh();
  });
  $('closeSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = false;
    syncUI();
  });
  // Human: The key field is never filled from storage and is emptied after a save, so an empty field means
  // "nothing typed", not "delete my key". Only Clear key (which asks first) removes it.
  // Agent: CALLS setApiKey with a non-empty value only; the worker treats '' as storage.remove. On a throw
  // (extension_context_invalidated after an extension reload, or a worker error) WRITES #apiKeyNote and leaves
  // #apiKeyStatus alone: getApiKey would answer '' there and wrongly show "No key saved".
  const keyFailure = (err: unknown, action: string): string => {
    const msg = err instanceof Error ? err.message : String(err || '');
    return /invalidated/i.test(msg)
      ? `The extension was reloaded. Reload this Freshservice tab, then ${action} the key again.`
      : `Couldn’t ${action} the key. Try again.`;
  };
  const saveApiKey = async (): Promise<void> => {
    const value = apiKeyInput.value.trim();
    if (!value) {
      apiKeyInput.value = '';
      showKeyNote('Paste a key first. Nothing was changed.');
      return;
    }
    try {
      await setApiKey(value);
    } catch (err) {
      showKeyNote(keyFailure(err, 'save'), true);
      return;
    }
    apiKeyInput.value = '';
    showKeyNote('');
    await refreshApiKeyStatus();
  };
  $('saveApiKey').addEventListener('click', () => { void saveApiKey(); });
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    void saveApiKey();
  });
  $('clearApiKey').addEventListener('click', () => {
    if (!confirm('Remove the saved API key from this browser?')) return;
    apiKeyInput.value = '';
    void clearApiKey().then(
      () => {
        showKeyNote('');
        return refreshApiKeyStatus();
      },
      (err: unknown) => showKeyNote(keyFailure(err, 'remove'), true),
    );
  });
  $('rescan').addEventListener('click', () => markTickets({ force: true }));

  listen(document, 'click', (e) => {
    const target = e.target as Element | null;
    if (target?.closest?.('.sth-range-badge')) {
      e.preventDefault();
      e.stopPropagation();
      if (!rangeListingEnabled(hasApiKeyPresent())) {
        expandRangeSection();
        return;
      }
      showResults();
      return;
    }
    const th = target?.closest?.('th[data-sth-col="start"]');
    if (!th) return;
    e.preventDefault();
    e.stopPropagation();
    const nextDir: SortDir = page().sortKey === 'start' && page().sortDir === 'asc' ? 'desc' : 'asc';
    updatePage({ sortKey: 'start', sortDir: nextDir });
  }, true);
  // Human: Right-click a start date to list that day: the range is saved as that single day and the results
  // open. Without a key the browser's own menu shows, as before.
  // Agent: CALLS setRange(key, key) for the list on screen, which opens the overlay and loads it.
  listen(document, 'contextmenu', (e) => {
    const td = (e.target as Element | null)?.closest?.('td[data-sth-col="start"]') as HTMLElement | null;
    const key = td?.dataset.startKey;
    if (!key) return;
    if (!rangeListingEnabled(hasApiKeyPresent())) return;
    e.preventDefault();
    setRange(key, key, true);
  }, true);

  // Human: Keep the panel on screen when the window changes size. Only a resize of the bare panel or chip
  // re-saves the dock. With Manage / Statistics (or Settings / Range results) open the host has another box,
  // and clamping that would drag the saved dock along.
  // Agent: WRITES x/y or fabX/fabY only when the host is just the panel or the chip. With a side dialog the
  // pin is clamped by the main panel's own box and the pair is re-placed without persisting.
  listen(window, 'resize', () => {
    if (sideOpen()) {
      if (panelPin) panelPin = clampPos(panelPin.x, panelPin.y, panel.getBoundingClientRect());
      pinChrome();
      return;
    }
    const settings = getSettings();
    const dock = settings.collapsed
      ? savedPoint(settings.fabX, settings.fabY)
      : savedPoint(settings.x, settings.y);
    if (!dock) return;
    const p = placeAt(dock.x, dock.y);
    if (!settings.collapsed && (settingsOpen || resultsOpen)) return;
    if (settings.collapsed) patchRoot({ fabX: p.x, fabY: p.y });
    else patchRoot({ x: p.x, y: p.y });
  });

  // Human: Called by the next injected copy (content.ts) before it mounts. Without it the old document and
  // window listeners keep running; two copies each flip the Start sort, so ascending is never reached.
  // Agent: Removes every listen() registration, stops timers and pending range loads, and unhooks runtime
  // callbacks that are still this instance's. Clears window.__sthPanelTeardown so it cannot run twice.
  const teardown = (): void => {
    [...cleanups].forEach((off) => off());
    clearTimeout(noticeTimer);
    rangeGen += 1;
    if (runtime.renderStats === renderStats) runtime.renderStats = () => {};
    if (runtime.onPageChange === onPageChange) runtime.onPageChange = () => {};
    if (runtime.notify === notify) runtime.notify = () => {};
    if (runtime.revealPanel === revealPanel) runtime.revealPanel = () => {};
    if (window.__sthPanelTeardown === teardown) delete window.__sthPanelTeardown;
  };
  window.__sthPanelTeardown = teardown;

  applyPageStyles();
  syncUI();
  void refreshApiKeyStatus();
  void trackCurrentTicket().then(() => { if (statsOpen) stats.sync(); });
  initUpdateToast(shadow, () => pinChrome());
}
