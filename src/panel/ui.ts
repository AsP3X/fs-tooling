// Human: Shadow-DOM ops panel: filters, saved views, sort, statistics, drag position.
// Agent: READS/WRITES settings via patchRoot/patchPage; CALLS markTickets on filter changes. Isolated from the host page CSS.

import { HISTORY_KEY, JOURNEY_PRESETS, TICKET_PRESETS } from '../lib/constants';
import { formatStart, parseStartInput } from '../lib/dates';
import { detectModule } from '../lib/detect';
import { loadHistory, saveSnapshot } from '../lib/history';
import { collectRows } from '../lib/rows';
import { assignRoot, getLastStats, getModuleId, getSettings, page, patchPage, patchRoot, setModuleId } from '../lib/state';
import { buildReport } from '../lib/stats';
import { escapeHtml, fmtDur } from '../lib/text';
import type { MatchMode, ModuleSetting, PageSettings, Preset, SortDir, SortKey } from '../lib/types';
import { markTickets, openMarked } from '../page/paint';
import { runtime } from '../page/runtime';
import { applyPageStyles } from '../page/styles';
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
  let reportOpen = false;
  const didDrag = { current: false };

  function builtinPresets(): Preset[] {
    return getModuleId() === 'journeys' ? JOURNEY_PRESETS : TICKET_PRESETS;
  }
  function allPresets(): Preset[] {
    return [...builtinPresets(), ...(page().presets || [])];
  }

  function barsHtml(buckets: Array<{ key: string; n: number }>): string {
    const max = Math.max(1, ...buckets.map((b) => b.n));
    return `<div class="bars">${buckets.map((b) => `<div class="bar-row"><span>${escapeHtml(b.key)}</span><div class="bar-track"><div class="bar-fill" style="width:${(b.n / max) * 100}%"></div></div><span>${b.n}</span></div>`).join('')}</div>`;
  }

  function tableHtml(rows: Array<{ name: string; n: number }>): string {
    if (!rows.length) return '<p class="note">No groups on this list.</p>';
    return `<table class="split"><thead><tr><th>Group</th><th class="num">n</th></tr></thead><tbody>${rows.slice(0, 12).map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderReport(): void {
    const r = buildReport(collectRows(), getModuleId());
    const hist = loadHistory().filter((h) => h.module === r.module);
    $('reportTitle').textContent = r.module === 'journeys' ? 'Journey statistics' : 'Ticket statistics';
    $('reportSub').textContent = `${r.n} rows · ${hist.length} snapshots · names not stored`;
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
      <p class="note">Journeys use the badge “since N days” when present, otherwise created-on. Person names are stripped from stored labels.</p>`;
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
    host.style.left = 'auto';
    host.style.right = '20px';
    host.style.bottom = '20px';
  }
  function placeAt(x: number, y: number): { x: number; y: number } {
    const p = clampPos(x, y);
    host.style.left = p.x + 'px';
    host.style.top = p.y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    return p;
  }
  function applySavedPosition(): void {
    const settings = getSettings();
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y) && settings.x != null && settings.y != null) {
      requestAnimationFrame(() => placeAt(settings.x as number, settings.y as number));
    } else {
      placeDefault();
    }
  }

  function renderStats(): void {
    const lastStats = getLastStats();
    $('fabCount').textContent = String(lastStats.marked);
    const name = getModuleId() === 'journeys' ? 'Journeys' : 'Tickets';
    const prefix = getSettings().module === 'auto' ? `Auto · ${name}` : name;
    $('panelSub').textContent = `${prefix} · ${lastStats.marked}/${lastStats.tickets}`;
    $('openStale').textContent = lastStats.marked ? `Open ${lastStats.marked} marked` : 'Open marked tabs';
  }
  runtime.renderStats = renderStats;

  function discoveredStatuses(): string[] {
    return [...new Set(collectRows().map((r) => r.status).filter((s) => s && s !== '—'))].sort((a, b) => a.localeCompare(b));
  }
  function discoveredStarts(): string[] {
    return [...new Set(collectRows().map((r) => r.startKey).filter((s): s is string => !!s))].sort();
  }

  function renderStatusTags(): void {
    const wrap = $('statusTags');
    const hints = $('statusHints');
    const cfg = page();
    wrap.innerHTML = cfg.statuses.map((s) => `<span class="tag">${escapeHtml(s)}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`).join('');
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const remove = (btn as HTMLElement).dataset.remove || '';
        updatePage({ statuses: cfg.statuses.filter((s) => s.toLowerCase() !== remove.toLowerCase()), activePreset: null });
      });
    });
    const selected = new Set(cfg.statuses.map((s) => s.toLowerCase()));
    hints.innerHTML = discoveredStatuses().filter((s) => !selected.has(s.toLowerCase()))
      .map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
    hints.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const add = (btn as HTMLElement).dataset.add || '';
        if (cfg.statuses.some((s) => s.toLowerCase() === add.toLowerCase())) return;
        updatePage({ statuses: [...cfg.statuses, add], activePreset: null });
      });
    });
  }

  function addStartDate(raw: string): void {
    const key = parseStartInput(raw);
    if (!key) return;
    if ((page().startDates || []).includes(key)) return;
    updatePage({ startDates: [...(page().startDates || []), key], activePreset: null });
  }

  function renderStartTags(): void {
    const wrap = $('startTags');
    const hints = $('startHints');
    const cfg = page();
    wrap.innerHTML = (cfg.startDates || []).map((s) =>
      `<span class="tag">${escapeHtml(formatStart(s))}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`,
    ).join('');
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const remove = (btn as HTMLElement).dataset.remove || '';
        updatePage({ startDates: cfg.startDates.filter((s) => s !== remove), activePreset: null });
      });
    });
    const selected = new Set(cfg.startDates || []);
    hints.innerHTML = discoveredStarts().filter((s) => !selected.has(s))
      .map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(formatStart(s))}</button>`).join('');
    hints.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => addStartDate((btn as HTMLElement).dataset.add || ''));
    });
  }

  function renderViewPresets(): void {
    const wrap = $('viewPresets');
    const cfg = page();
    wrap.innerHTML = allPresets().map((p) => `<button type="button" class="chip${cfg.activePreset === p.id ? ' on' : ''}" data-preset="${p.id}">${escapeHtml(p.name)}</button>`).join('');
    wrap.querySelectorAll('button[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => applyPreset((btn as HTMLElement).dataset.preset || ''));
    });
  }

  function applyPreset(id: string): void {
    const p = allPresets().find((x) => x.id === id);
    if (!p) return;
    updatePage({
      days: p.days,
      statuses: [...(p.statuses || [])],
      matchMode: p.matchMode === 'and' ? 'and' : 'or',
      maxProgress: p.maxProgress ?? null,
      startWithin: p.startWithin ?? null,
      startDates: [...(p.startDates || [])],
      activePreset: p.id,
    });
  }

  function renderExtraFilters(): void {
    const box = $('extraFilters');
    if (getModuleId() !== 'journeys') {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'grid';
    const cfg = page();
    box.innerHTML = `
      <button type="button" class="tagbox-head" data-toggle="extra">
        <span class="label">Journey extras</span>
        <span class="chev">▸</span>
      </button>
      <div class="tagbox-body">
        <div class="row-between"><span class="label">Max child progress %</span><b>${cfg.maxProgress == null ? 'off' : cfg.maxProgress + '%'}</b></div>
        <input type="range" id="maxProgress" min="0" max="100" step="5" value="${cfg.maxProgress == null ? 100 : cfg.maxProgress}" />
        <div class="chips">
          <button type="button" class="chip" data-prog="">Off</button>
          <button type="button" class="chip" data-prog="25">≤25%</button>
          <button type="button" class="chip" data-prog="40">≤40%</button>
          <button type="button" class="chip" data-prog="60">≤60%</button>
        </div>
        <div class="row-between"><span class="label">Start within days</span><b>${cfg.startWithin == null ? 'off' : cfg.startWithin + 'd'}</b></div>
        <div class="chips">
          <button type="button" class="chip" data-start="">Off</button>
          <button type="button" class="chip" data-start="3">3d</button>
          <button type="button" class="chip" data-start="7">7d</button>
          <button type="button" class="chip" data-start="14">14d</button>
        </div>
      </div>`;
    box.querySelectorAll('[data-prog]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = (btn as HTMLElement).dataset.prog;
        updatePage({ maxProgress: raw === '' ? null : Number(raw), activePreset: null });
      });
    });
    box.querySelectorAll('[data-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const raw = (btn as HTMLElement).dataset.start;
        updatePage({ startWithin: raw === '' ? null : Number(raw), activePreset: null });
      });
    });
    box.querySelector('#maxProgress')?.addEventListener('input', (e) => {
      updatePage({ maxProgress: Number((e.target as HTMLInputElement).value), activePreset: null });
    });
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
    const cfg = page();
    const settings = getSettings();
    const name = getModuleId() === 'journeys' ? 'Journeys' : 'Tickets';
    shadow.querySelectorAll<HTMLElement>('.panel, .fab, .logo, .toggle, input[type="range"], .primary').forEach((el) => {
      el.style.setProperty('--accent', cfg.color);
    });
    $('panelTitle').textContent = name;
    $('panelSub').textContent = settings.module === 'auto' ? `Auto · ${name}` : name;
    $('fabLabel').textContent = name;
    $('daysCaption').textContent = getModuleId() === 'journeys' ? 'Age' : 'Idle age';
    $('enabled').classList.toggle('on', cfg.enabled);
    const days = $('days') as HTMLInputElement;
    days.value = String(cfg.days);
    days.style.setProperty('--p', ((cfg.days - 1) / 44) * 100 + '%');
    $('daysLabel').textContent = `${cfg.days}d`;
    ($('customColor') as HTMLInputElement).value = cfg.color;
    $('dayChips').innerHTML = [3, 6, 10, 14, 21, 30].map((d) => `<button type="button" class="chip${d === cfg.days ? ' on' : ''}" data-days="${d}">${d}d</button>`).join('');
    $('dayChips').querySelectorAll('[data-days]').forEach((btn) => {
      btn.addEventListener('click', () => updatePage({ days: Number((btn as HTMLElement).dataset.days), activePreset: null }));
    });
    shadow.querySelectorAll('#matchMode button').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).dataset.mode === cfg.matchMode);
    });
    shadow.querySelectorAll('#moduleSeg button').forEach((btn) => {
      (btn as HTMLElement).classList.toggle('on', (btn as HTMLElement).dataset.module === settings.module);
    });
    $('matchHint').textContent = cfg.matchMode === 'and'
      ? 'Mark only if every selected filter matches (age, status, start).'
      : 'Mark if age, status, or start date matches.';
    $('statusLabel').textContent = cfg.matchMode === 'and' ? 'Limit to status' : 'Also mark status';
    $('statusCount').textContent = String(cfg.statuses.length);
    $('startLabel').textContent = cfg.matchMode === 'and' ? 'Limit to start date' : 'Also mark start date';
    $('startCount').textContent = String((cfg.startDates || []).length);
    $('startBox').style.display = getModuleId() === 'journeys' ? '' : 'none';
    const open = settings.uiOpen || {};
    shadow.querySelectorAll<HTMLElement>('[data-sec]').forEach((el) => el.classList.toggle('open', !!open[el.dataset.sec || '']));
    $('deleteView').style.visibility = (cfg.presets || []).some((p) => p.id === cfg.activePreset) ? 'visible' : 'hidden';
    shadow.querySelectorAll<HTMLElement>('.swatch').forEach((sw) => {
      sw.classList.toggle('on', (sw.dataset.color || '').toLowerCase() === cfg.color.toLowerCase());
    });
    panel.classList.toggle('hide', settings.collapsed || reportOpen);
    fab.classList.toggle('show', settings.collapsed && !reportOpen);
    report.classList.toggle('show', reportOpen && !settings.collapsed);
    renderViewPresets();
    renderStatusTags();
    renderStartTags();
    renderExtraFilters();
    renderSortKeys();
    applyPageStyles();
    applySavedPosition();
    renderStats();
  }

  function updateRoot(partial: Parameters<typeof patchRoot>[0]): void {
    patchRoot(partial);
    syncUI();
    if (!('x' in partial || 'y' in partial || 'collapsed' in partial)) markTickets();
  }

  function updatePage(partial: Partial<PageSettings>): void {
    patchPage(partial);
    syncUI();
    markTickets();
  }

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
        assignRoot({ x: p.x, y: p.y });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
          const s = getSettings();
          patchRoot({ x: s.x, y: s.y });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
  makeDraggable($('dragHandle'));
  makeDraggable($('reportHandle'));
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

  const statusInput = $('statusInput') as HTMLInputElement;
  const startInput = $('startInput') as HTMLInputElement;
  (['keydown', 'keypress', 'keyup'] as const).forEach((type) => {
    statusInput.addEventListener(type, (e) => e.stopPropagation());
    startInput.addEventListener(type, (e) => e.stopPropagation());
  });
  startInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const raw = startInput.value;
      startInput.value = '';
      addStartDate(raw);
    }
  });
  statusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const name = statusInput.value.replace(/\s+/g, ' ').trim();
      statusInput.value = '';
      if (!name) return;
      if (page().statuses.some((s) => s.toLowerCase() === name.toLowerCase())) return;
      updatePage({ statuses: [...page().statuses, name], activePreset: null });
    }
  });
  $('enabled').addEventListener('click', () => updatePage({ enabled: !page().enabled }));
  $('days').addEventListener('input', (e) => updatePage({ days: Number((e.target as HTMLInputElement).value), activePreset: null }));
  shadow.querySelectorAll('#matchMode button').forEach((btn) => {
    btn.addEventListener('click', () => updatePage({ matchMode: ((btn as HTMLElement).dataset.mode || 'or') as MatchMode, activePreset: null }));
  });
  shadow.querySelectorAll('#moduleSeg button').forEach((btn) => {
    btn.addEventListener('click', () => updateRoot({ module: ((btn as HTMLElement).dataset.module || 'auto') as ModuleSetting }));
  });
  shadow.querySelectorAll('#sortDir button').forEach((btn) => {
    btn.addEventListener('click', () => updatePage({ sortDir: ((btn as HTMLElement).dataset.dir || 'asc') as SortDir }));
  });
  $('saveView').addEventListener('click', () => {
    const name = window.prompt('Name this view', `${getModuleId()} ${page().days}d`);
    if (!name) return;
    const preset: Preset = {
      id: `p-${Date.now()}`,
      name: name.replace(/\s+/g, ' ').trim().slice(0, 32),
      days: page().days,
      statuses: [...page().statuses],
      matchMode: page().matchMode,
      maxProgress: page().maxProgress,
      startWithin: page().startWithin,
      startDates: [...(page().startDates || [])],
    };
    updatePage({ presets: [...page().presets, preset], activePreset: preset.id });
  });
  $('deleteView').addEventListener('click', () => {
    const id = page().activePreset;
    if (!(page().presets || []).some((p) => p.id === id)) return;
    if (!confirm('Delete this saved view?')) return;
    updatePage({ presets: page().presets.filter((p) => p.id !== id), activePreset: null });
  });
  shadow.querySelectorAll<HTMLElement>('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => updatePage({ color: sw.dataset.color || page().color }));
  });
  $('customColor').addEventListener('input', (e) => updatePage({ color: (e.target as HTMLInputElement).value }));
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
    if (getSettings().collapsed) updateRoot({ collapsed: false });
    else syncUI();
    renderReport();
  });
  $('closeReport').addEventListener('click', (e) => {
    e.stopPropagation();
    reportOpen = false;
    syncUI();
  });
  $('saveSnap').addEventListener('click', () => {
    saveSnapshot(buildReport(collectRows(), getModuleId()));
    renderReport();
  });
  $('clearHist').addEventListener('click', () => {
    if (!confirm('Clear saved statistics snapshots?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderReport();
  });
  $('rescan').addEventListener('click', markTickets);

  document.addEventListener('click', (e) => {
    const th = (e.target as Element | null)?.closest?.('th[data-sth-col="start"]');
    if (!th) return;
    e.preventDefault();
    e.stopPropagation();
    const nextDir: SortDir = page().sortKey === 'start' && page().sortDir === 'asc' ? 'desc' : 'asc';
    updatePage({ sortKey: 'start', sortDir: nextDir });
  }, true);

  window.addEventListener('resize', () => {
    const settings = getSettings();
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y) && settings.x != null && settings.y != null) {
      const p = placeAt(settings.x, settings.y);
      patchRoot({ x: p.x, y: p.y });
    }
  });

  applyPageStyles();
  syncUI();
}
