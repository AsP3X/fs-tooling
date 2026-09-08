// Human: Shadow-DOM ops panel: quick filter chips, sort, date-range overlay, Manage dialog, GitHub update toast, drag position.
// Agent: READS/WRITES settings via patchRoot/patchPage; CALLS markTickets on highlight-filter changes. Range overlay CALLS listRangeResults and does not mutate the host table.

import { listRangeResults } from '../lib/api/enrich';
import { contextLabel, detectContext } from '../lib/context';
import { HISTORY_KEY, HOST_DEFAULT_INSET_PX } from '../lib/constants';
import { formatStart } from '../lib/dates';
import { accentColor } from '../lib/filters';
import { formatRangeLabel, normalizeRange, rangeActive, rangeApplyReady, rangeListingEnabled } from '../lib/range';
import { detectModule } from '../lib/detect';
import { loadHistory, saveSnapshot } from '../lib/history';
import { savedPoint } from '../lib/settings';
import { collectRows } from '../lib/rows';
import { clearApiKey, getApiKey, hasExtensionRuntime, maskApiKey, setApiKey } from '../lib/secrets';
import { assignRoot, getLastRangeMeta, getLastRangeResults, getLastReportMeta, getLastReportables, getLastStats, getModuleId, getSettings, hasApiKeyPresent, page, patchPage, patchRoot, setApiKeyPresent, setLastRangeResults, setModuleId } from '../lib/state';
import { buildReport } from '../lib/stats';
import { escapeHtml, fmtDur } from '../lib/text';
import type { FilterRule, ModuleSetting, PageSettings, SortDir, SortKey } from '../lib/types';
import { markTickets, openMarked, paintList } from '../page/paint';
import { runtime } from '../page/runtime';
import { applyPageStyles } from '../page/styles';
import { syncStartColumnHeader } from '../page/start-column';
import { applyFeatureVisibility, syncRegisteredFeatures } from './features';
import { initAbout } from './about';
import { initManage } from './manage';
import { initUpdateToast } from './update-toast';
import panelCss from './panel.css?raw';
import panelHtml from './panel.html?raw';

export function initPanel(host: HTMLElement, shadow: ShadowRoot): void {
  shadow.innerHTML = `<style>${panelCss}</style>${panelHtml}`;

  const $ = (id: string): HTMLElement => {
    const el = shadow.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el;
  };
  const panel = $('panel');
  const fab = $('fab');
  const report = $('report');
  const settingsPanel = $('settingsPanel');
  const resultsPanel = $('resultsPanel');
  const filterPanel = $('filterPanel');
  const chromeRow = $('chromeRow');
  const about = initAbout(shadow);
  let reportOpen = false;
  let settingsOpen = false;
  let resultsOpen = false;
  let filterOpen = false;
  let panelPin: { x: number; y: number } | null = null;
  const didDrag = { current: false };
  let rangeDraft: { startFrom: string | null; startTo: string | null } | null = null;
  let rangeDraftModule: ReturnType<typeof getModuleId> | null = null;

  function barsHtml(buckets: Array<{ key: string; n: number }>): string {
    const max = Math.max(1, ...buckets.map((b) => b.n));
    return `<div class="bars">${buckets.map((b) => `<div class="bar-row"><span>${escapeHtml(b.key)}</span><div class="bar-track"><div class="bar-fill" style="width:${(b.n / max) * 100}%"></div></div><span>${b.n}</span></div>`).join('')}</div>`;
  }

  function tableHtml(rows: Array<{ name: string; n: number }>): string {
    if (!rows.length) return '<p class="note">No groups on this list.</p>';
    return `<table class="split"><thead><tr><th>Group</th><th class="num">n</th></tr></thead><tbody>${rows.slice(0, 12).map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderReport(): void {
    const bundle = getLastReportables();
    const meta = getLastReportMeta();
    const r = buildReport(bundle.length ? bundle : collectRows(), getModuleId());
    const hist = loadHistory().filter((h) => h.module === r.module);
    $('reportTitle').textContent = r.module === 'journeys' ? 'Journey statistics' : 'Ticket statistics';
    const src = meta.fromApi ? (meta.truncated ? 'API · capped at 500' : 'API') : 'this page';
    $('reportSub').textContent = `${r.n} rows · ${src} · ${hist.length} snapshots · names not stored`;
    const extra = r.module === 'journeys' ? `
      <div class="kpi">
        <div class="stat"><b>${r.awaiting}</b><span>Awaiting info</span></div>
        <div class="stat"><b>${r.processing}</b><span>Being processed</span></div>
        <div class="stat"><b>${r.startWeek}</b><span>Start in 7d</span></div>
        <div class="stat"><b>${r.startPast}</b><span>Start already passed</span></div>
      </div>
      <div class="section-title">Child-ticket progress</div>
      ${barsHtml(r.progBuckets)}
      <div class="section-title">Internal vs external</div>
      ${tableHtml(r.byKind)}
      <div class="kpi">
        <div class="stat"><b>${r.progress.avg == null ? '—' : Math.round(r.progress.avg) + '%'}</b><span>Avg child progress</span></div>
        <div class="stat"><b>${fmtDur(r.startIn.med)}</b><span>Median days to start</span></div>
      </div>` : `
      <div class="kpi">
        <div class="stat"><b>${fmtDur(r.idle.avg)}</b><span>Idle avg</span></div>
        <div class="stat"><b>${fmtDur(r.idle.p90)}</b><span>Idle p90</span></div>
      </div>`;
    $('reportBody').innerHTML = `${extra}
      <div class="section-title">${r.module === 'journeys' ? 'Days in current status' : 'Idle buckets'}</div>
      ${barsHtml(r.idleBuckets)}
      <div class="section-title">By status</div>
      ${tableHtml(r.byStatus)}
      <p class="note">${meta.fromApi ? 'Idle uses ticket updated_at from the API when a key is saved. ' : 'Journeys use the badge “since N days” when present, otherwise created-on. '}Person names are stripped from stored labels.</p>`;
  }

  // Human: Range overlay — our table only. Does not hide or rebuild the live Freshservice list.
  // Agent: READS getLastRangeResults; WRITES #resultsBody. CALLS listRangeResults from loadAndRenderRange.
  function renderResults(): void {
    const cfg = page();
    const meta = getLastRangeMeta();
    const rows = getLastRangeResults();
    const journeys = getModuleId() === 'journeys';
    const dateHead = journeys ? 'Start' : 'Updated';
    const ranged = rangeActive(cfg.startFrom, cfg.startTo);
    $('resultsTitle').textContent = 'Range results';
    const rangeBit = ranged ? ` · ${formatRangeLabel(cfg.startFrom, cfg.startTo)}` : '';
    const src = meta.fromApi ? (meta.truncated ? 'API · capped at 500' : 'API') : 'this page';
    $('resultsSub').textContent = `${rows.length} rows${rangeBit} · ${src}`;
    if (!ranged) {
      $('resultsBody').innerHTML = '<p class="note">Set From and/or To to list items. Freshservice’s table stays as it is.</p>';
      return;
    }
    if (!rows.length) {
      $('resultsBody').innerHTML = `<p class="note">${meta.fromApi
        ? 'No items in this range.'
        : 'No matches on this page. Save an API key in Settings to list every ticket or journey in the range without changing Freshservice’s table.'}</p>`;
      return;
    }
    const sorted = [...rows].sort((a, b) => {
      const ka = (journeys ? a.startKey : a.updatedKey) || a.startKey || a.updatedKey || '';
      const kb = (journeys ? b.startKey : b.updatedKey) || b.startKey || b.updatedKey || '';
      return ka.localeCompare(kb);
    });
    $('resultsBody').innerHTML = `<table class="split"><thead><tr><th>${dateHead}</th><th>Status</th><th>Item</th></tr></thead><tbody>${sorted.map((row) => {
      const key = journeys ? row.startKey : row.updatedKey;
      const date = key ? escapeHtml(formatStart(key)) : '—';
      const label = escapeHtml(row.label || row.status);
      const cell = row.href
        ? `<a href="${escapeHtml(row.href)}" target="_blank" rel="noopener">${label}</a>`
        : label;
      return `<tr><td>${date}</td><td>${escapeHtml(row.status)}</td><td>${cell}</td></tr>`;
    }).join('')}</tbody></table><p class="note">This table is ours. Freshservice’s list, pager, and sort are unchanged.</p>`;
  }

  let rangeGen = 0;
  async function loadAndRenderRange(force = false): Promise<void> {
    if (!rangeListingEnabled(hasApiKeyPresent())) {
      $('resultsBody').innerHTML = '<p class="note">Save an API key in Settings to list by date range.</p>';
      return;
    }
    const gen = ++rangeGen;
    $('resultsBody').innerHTML = '<p class="note">Loading…</p>';
    const result = await listRangeResults(collectRows(), force);
    if (gen !== rangeGen) return;
    setLastRangeResults(result.rows, { truncated: result.truncated, fromApi: result.fromApi });
    renderResults();
  }

  // Human: Draft From/To until Apply. Saved settings are the applied range.
  function shownRange(): { startFrom: string | null; startTo: string | null } {
    if (rangeDraft && rangeDraftModule === getModuleId()) return rangeDraft;
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
    reportOpen = false;
    settingsOpen = false;
    if (getSettings().collapsed) patchRoot({ collapsed: false });
    syncUI();
    void loadAndRenderRange(false);
  }

  function setRange(from: string | null, to: string | null, openTable = true): void {
    const next = normalizeRange(from, to);
    const active = rangeActive(next.startFrom, next.startTo);
    if (active && !rangeListingEnabled(hasApiKeyPresent())) return;
    rangeDraft = null;
    rangeDraftModule = null;
    patchPage({ startFrom: next.startFrom, startTo: next.startTo, activePreset: null });
    if (active && openTable) {
      resultsOpen = true;
      reportOpen = false;
      settingsOpen = false;
      if (getSettings().collapsed) patchRoot({ collapsed: false });
    } else if (!active) {
      resultsOpen = false;
      setLastRangeResults([], { truncated: false, fromApi: false });
    }
    syncUI();
    syncStartColumnHeader();
    if (resultsOpen) void loadAndRenderRange(true);
  }

  // Human: Commit the date inputs and open the overlay. No-op without a key or dates.
  // Agent: CALLS setRange. Does not run on input change.
  function applyRange(): void {
    if (!rangeListingEnabled(hasApiKeyPresent())) return;
    const next = normalizeRange(
      ($('rangeFrom') as HTMLInputElement).value,
      ($('rangeTo') as HTMLInputElement).value,
    );
    if (!rangeActive(next.startFrom, next.startTo)) return;
    setRange(next.startFrom, next.startTo, true);
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

  function clampPos(x: number, y: number): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    const pad = 8;
    return {
      x: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - rect.width - pad)),
      y: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - rect.height - pad)),
    };
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

  function placeFilterSide(): void {
    const main = panel.getBoundingClientRect();
    const need = 488;
    const rightSpace = window.innerWidth - main.right;
    const leftSpace = main.left;
    const side = rightSpace >= need || rightSpace >= leftSpace ? 'right' : 'left';
    filterPanel.style.order = side === 'left' ? '0' : '2';
    panel.style.order = '1';
    chromeRow.dataset.side = side;
  }

  // Human: Keep the main panel where it is when the side dialog opens or grows.
  // Agent: WRITES host left/top so panel.getBoundingClientRect matches panelPin, then clamps.
  function pinChrome(): void {
    void host.offsetWidth;
    if (panel.classList.contains('hide') || !filterOpen) {
      applySavedPosition();
      return;
    }
    placeFilterSide();
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
    $('openStale').textContent = totalMarked ? `Open ${totalMarked} marked` : 'Open marked tabs';
  }
  runtime.renderStats = renderStats;
  runtime.onPageChange = () => { syncUI(); };
  runtime.revealPanel = () => {
    reportOpen = false;
    settingsOpen = false;
    resultsOpen = false;
    filterOpen = false;
    updateRoot({ collapsed: false });
    requestAnimationFrame(() => applySavedPosition());
  };

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
    const filters = page().filters || [];
    const sig = filters.map((r) => `${r.id}:${r.enabled ? 1 : 0}:${r.color}:${r.name}`).join('|');
    if (sig === chipSig && wrap.childElementCount === filters.length) return;
    chipSig = sig;
    wrap.innerHTML = filters.map((rule) =>
      `<button type="button" class="chip filter-chip${rule.enabled ? ' on' : ''}" data-filter="${escapeHtml(rule.id)}"><span class="sw" style="background:${escapeHtml(rule.color)}"></span>${escapeHtml(rule.name)}</button>`,
    ).join('');
    wrap.querySelectorAll('button[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.filter || '';
        const next = (page().filters || []).map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
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
      : `Sorted by ${label}, ${cfg.sortDir === 'desc' ? 'newest / Z first' : 'oldest / A first'}.`;
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
        ? 'List filters apply on ticket and journey tables. Use Manage for the API key.'
        : 'Open a ticket or journeys list to use filters.';
    }
    $('enabled').classList.toggle('on', cfg.enabled);
    shadow.querySelectorAll('#moduleSeg button').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).dataset.module === settings.module);
    });
    const journeys = getModuleId() === 'journeys';
    if (rangeDraft && rangeDraftModule !== getModuleId()) {
      rangeDraft = null;
      rangeDraftModule = null;
    }
    const canRange = rangeListingEnabled(hasApiKeyPresent());
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
    if (!editingRange) {
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
    const overlay = reportOpen || settingsOpen || resultsOpen;
    if (overlay || settings.collapsed) filterOpen = false;
    panel.classList.toggle('hide', settings.collapsed || overlay);
    fab.classList.toggle('show', settings.collapsed && !overlay);
    report.classList.toggle('show', reportOpen && !settings.collapsed);
    settingsPanel.classList.toggle('hide', !settingsOpen || settings.collapsed);
    resultsPanel.classList.toggle('show', resultsOpen && !settings.collapsed);
    resultsPanel.classList.toggle('hide', !resultsOpen || settings.collapsed);
    filterPanel.classList.toggle('hide', !filterOpen || settings.collapsed || overlay);
    renderFilterChips();
    renderSortKeys();
    if (filterOpen) manage.sync();
    applyFeatureVisibility(shadow, ctx);
    syncRegisteredFeatures($('featureMount'), ctx);
    applyPageStyles();
    if (filterOpen && !panel.classList.contains('hide')) pinChrome();
    else applySavedPosition();
    renderStats();
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
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        didDrag.current = true;
        const p = placeAt(origX + dx, origY + dy);
        if (getSettings().collapsed) assignRoot({ fabX: p.x, fabY: p.y });
        else assignRoot({ x: p.x, y: p.y });
        const main = panel.getBoundingClientRect();
        panelPin = { x: main.left, y: main.top };
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          const s = getSettings();
          if (s.collapsed) patchRoot({ fabX: s.fabX, fabY: s.fabY });
          else patchRoot({ x: s.x, y: s.y });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
  makeDraggable($('dragHandle'));
  makeDraggable($('reportHandle'));
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
  const rangeFromInput = $('rangeFrom') as HTMLInputElement;
  const rangeToInput = $('rangeTo') as HTMLInputElement;
  (['keydown', 'keypress', 'keyup'] as const).forEach((type) => {
    apiKeyInput.addEventListener(type, (e) => e.stopPropagation());
    rangeFromInput.addEventListener(type, (e) => e.stopPropagation());
    rangeToInput.addEventListener(type, (e) => e.stopPropagation());
  });
  const captureRangeDraft = () => {
    rangeDraft = normalizeRange(rangeFromInput.value, rangeToInput.value);
    rangeDraftModule = getModuleId();
    const applyBtn = $('applyRange') as HTMLButtonElement;
    applyBtn.disabled = !rangeApplyReady(hasApiKeyPresent(), rangeDraft.startFrom, rangeDraft.startTo);
  };
  rangeFromInput.addEventListener('input', captureRangeDraft);
  rangeToInput.addEventListener('input', captureRangeDraft);
  rangeFromInput.addEventListener('change', captureRangeDraft);
  rangeToInput.addEventListener('change', captureRangeDraft);
  $('applyRange').addEventListener('click', applyRange);
  $('clearRange').addEventListener('click', () => {
    rangeDraft = null;
    rangeDraftModule = null;
    setRange(null, null, false);
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
    settingsOpen = false;
    reportOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
  });
  $('closeFilters').addEventListener('click', (e) => {
    e.stopPropagation();
    filterOpen = false;
    syncUI();
  });
  $('collapse').addEventListener('click', (e) => {
    e.stopPropagation();
    updateRoot({ collapsed: true });
  });
  fab.addEventListener('click', () => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    updateRoot({ collapsed: false });
  });
  $('openStale').addEventListener('click', openMarked);
  $('openStats').addEventListener('click', () => {
    reportOpen = true;
    settingsOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
    void paintList(document, false).then(() => renderReport());
  });
  $('closeReport').addEventListener('click', (e) => {
    e.stopPropagation();
    reportOpen = false;
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
    reportOpen = false;
    resultsOpen = false;
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
    void refreshApiKeyStatus();
    void about.refresh();
  });
  $('closeSettings').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsOpen = false;
    syncUI();
  });
  $('saveApiKey').addEventListener('click', () => {
    const value = apiKeyInput.value;
    apiKeyInput.value = '';
    void setApiKey(value).then(refreshApiKeyStatus);
  });
  apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const value = apiKeyInput.value;
    apiKeyInput.value = '';
    void setApiKey(value).then(refreshApiKeyStatus);
  });
  $('clearApiKey').addEventListener('click', () => {
    if (!confirm('Remove the saved API key from this browser?')) return;
    apiKeyInput.value = '';
    void clearApiKey().then(refreshApiKeyStatus);
  });
  $('saveSnap').addEventListener('click', () => {
    const bundle = getLastReportables();
    saveSnapshot(buildReport(bundle.length ? bundle : collectRows(), getModuleId()));
    renderReport();
  });
  $('clearHist').addEventListener('click', () => {
    if (!confirm('Clear saved statistics snapshots?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderReport();
  });
  $('rescan').addEventListener('click', () => markTickets({ force: true }));

  document.addEventListener('click', (e) => {
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
  document.addEventListener('contextmenu', (e) => {
    const td = (e.target as Element | null)?.closest?.('td[data-sth-col="start"]') as HTMLElement | null;
    const key = td?.dataset.startKey;
    if (!key) return;
    if (!rangeListingEnabled(hasApiKeyPresent())) return;
    e.preventDefault();
    rangeDraft = { startFrom: key, startTo: key };
    rangeDraftModule = getModuleId();
    expandRangeSection();
  }, true);

  window.addEventListener('resize', () => {
    const settings = getSettings();
    const dock = settings.collapsed
      ? savedPoint(settings.fabX, settings.fabY)
      : savedPoint(settings.x, settings.y);
    if (!dock) return;
    const p = placeAt(dock.x, dock.y);
    if (settings.collapsed) patchRoot({ fabX: p.x, fabY: p.y });
    else patchRoot({ x: p.x, y: p.y });
  });

  applyPageStyles();
  syncUI();
  void refreshApiKeyStatus();
  initUpdateToast(shadow, () => applySavedPosition());
}
