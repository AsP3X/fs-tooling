// ==UserScript==
// @name         Freshservice Ops Panel
// @namespace    sth
// @version      2.3.1
// @description  Tickets + Journeys filters, highlighting, and statistics
// @match        https://*.freshservice.com/*
// @match        https://*.myfreshworks.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  const NS = 'sth';
  const HOST_ID = `${NS}-host`;
  const STYLE_ID = `${NS}-page-style`;
  const ROW_MARK = `${NS}-row`;
  const CELL_MARK = `${NS}-cell`;
  const HIDE_MARK = `${NS}-hide`;
  const RANGE_POP_ID = `${NS}-range-pop`;
  const RANGE_TABLE_ID = `${NS}-static-table`;
  const RANGE_BANNER_ID = `${NS}-range-banner`;
  const HIDE_ATTR = `data-${NS}-hidden`;
  const SRC_ATTR = `data-${NS}-src`;
  const MAX_HARVEST_PAGES = 40;
  const STORAGE_KEY = `${NS}-settings-v2`;
  const HISTORY_KEY = `${NS}-history-v2`;
  const MS_DAY = 86400000;
  const MAX_SNAPS = 90;

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  const BUCKETS = [
    { key: '<1d', test: (d) => d < 1 },
    { key: '1–3d', test: (d) => d >= 1 && d < 3 },
    { key: '3–7d', test: (d) => d >= 3 && d < 7 },
    { key: '7–14d', test: (d) => d >= 7 && d < 14 },
    { key: '14d+', test: (d) => d >= 14 }
  ];

  const PROG_BUCKETS = [
    { key: '0%', test: (p) => p === 0 },
    { key: '1–25%', test: (p) => p > 0 && p < 25 },
    { key: '25–50%', test: (p) => p >= 25 && p < 50 },
    { key: '50–75%', test: (p) => p >= 50 && p < 75 },
    { key: '75–99%', test: (p) => p >= 75 && p < 100 },
    { key: '100%', test: (p) => p >= 100 }
  ];

  const TICKET_PRESETS = [
    { id: 'idle-6', name: 'Idle 6d', days: 6, statuses: [], matchMode: 'or' },
    { id: 'open-idle', name: 'Open + idle', days: 6, statuses: ['Open'], matchMode: 'and' },
    { id: 'pending-3', name: 'Pending 3d', days: 3, statuses: ['Pending'], matchMode: 'and' },
    { id: 'w3p', name: '3rd party', days: 3, statuses: ['Waiting for third party'], matchMode: 'and' }
  ];

  const JOURNEY_PRESETS = [
    { id: 'await-3', name: 'Awaiting 3d', days: 3, statuses: ['Awaiting Information'], matchMode: 'and' },
    { id: 'proc-14', name: 'Processing 14d', days: 14, statuses: ['Being Processed'], matchMode: 'and' },
    { id: 'low-prog', name: 'Low progress', days: 7, statuses: [], matchMode: 'or', maxProgress: 40 },
    { id: 'start-soon', name: 'Start ≤7d', days: 1, statuses: [], matchMode: 'or', startWithin: 7 }
  ];

  const PAGE_DEFAULT = {
    days: 6,
    color: '#e65100',
    enabled: true,
    statuses: [],
    statusOpen: false,
    matchMode: 'or',
    presets: [],
    activePreset: null,
    maxProgress: null,
    startWithin: null,
    startDates: [],
    startFrom: null,
    startTo: null,
    startOpen: false,
    sortKey: 'default',
    sortDir: 'asc'
  };

  const DEFAULTS = {
    module: 'auto',
    collapsed: false,
    x: null,
    y: null,
    uiOpen: {},
    tickets: { ...PAGE_DEFAULT },
    journeys: { ...PAGE_DEFAULT, days: 7, color: '#1565c0' }
  };

  const loadSettings = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        ...DEFAULTS,
        ...raw,
        tickets: { ...DEFAULTS.tickets, ...(raw.tickets || {}) },
        journeys: { ...DEFAULTS.journeys, ...(raw.journeys || {}) },
        uiOpen: { ...(raw.uiOpen || {}) }
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  };
  const saveSettings = (s) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  let settings = loadSettings();
  ['tickets', 'journeys'].forEach((k) => {
    if (!Array.isArray(settings[k].statuses)) settings[k].statuses = [];
    if (!Array.isArray(settings[k].presets)) settings[k].presets = [];
    if (!Array.isArray(settings[k].startDates)) settings[k].startDates = [];
    settings[k].startFrom = validDateKey(settings[k].startFrom);
    settings[k].startTo = validDateKey(settings[k].startTo);
    if (settings[k].matchMode !== 'and') settings[k].matchMode = 'or';
    if (!settings[k].sortKey) settings[k].sortKey = 'default';
    if (settings[k].sortDir !== 'desc') settings[k].sortDir = 'asc';
  });

  document.getElementById(HOST_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(RANGE_POP_ID)?.remove();
  window.__staleTicketObserver?.disconnect();

  const pageStyle = document.createElement('style');
  pageStyle.id = STYLE_ID;
  document.head.appendChild(pageStyle);

  const hexToRgba = (hex, a) => {
    const h = String(hex || '#e65100').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${a})`;
  };

  function parseTicketDate(raw) {
    if (!raw) return null;
    const str = String(raw).replace(/\s+/g, ' ').trim();
    let m = str.match(/(\d{1,2})\s+([A-Za-z]{3})\.?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m && MONTHS[m[2].toLowerCase()] != null) {
      return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0));
    }
    m = str.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const d = +m[1];
      const mo = +m[2];
      return new Date(+m[3], mo - 1, d, +(m[4] || 0), +(m[5] || 0));
    }
    const native = new Date(str.replace(/,/g, ''));
    return Number.isNaN(native.getTime()) ? null : native;
  }

  function dateKey(d) {
    if (!d || Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatStart(key) {
    const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : key;
  }

  function parseStartDate(title) {
    const m = String(title || '').match(/Start\s+(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  function parseStartInput(raw) {
    const str = String(raw || '').replace(/^start\s+/i, '').replace(/\s+/g, ' ').trim();
    if (!str) return null;
    let m = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return dateKey(new Date(+m[3], +m[2] - 1, +m[1]));
    m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return dateKey(new Date(+m[1], +m[2] - 1, +m[3]));
    m = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\.?\s+(\d{4})$/);
    if (m && MONTHS[m[2].toLowerCase()] != null) return dateKey(new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
    return dateKey(parseStartDate('Start ' + str));
  }

  function validDateKey(v) {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  function normalizeRange(from, to) {
    let startFrom = validDateKey(from);
    let startTo = validDateKey(to);
    if (startFrom && startTo && startFrom > startTo) {
      const tmp = startFrom;
      startFrom = startTo;
      startTo = tmp;
    }
    return { startFrom, startTo };
  }

  function rangeActive() {
    const cfg = page();
    return !!(cfg.startFrom || cfg.startTo);
  }

  function formatRangeLabel(from, to) {
    if (!from && !to) return '';
    if (from && to && from === to) return formatStart(from);
    if (from && to) return `${formatStart(from)} – ${formatStart(to)}`;
    if (from) return `from ${formatStart(from)}`;
    return `until ${formatStart(to)}`;
  }

  function startInRange(item) {
    const { startFrom, startTo } = page();
    if (!startFrom && !startTo) return true;
    if (!item.startKey) return false;
    if (startFrom && item.startKey < startFrom) return false;
    if (startTo && item.startKey > startTo) return false;
    return true;
  }

  function parseRangeInput(raw) {
    const str = String(raw || '').trim();
    const m = str.match(/^(.+?)\s+(?:to|–|—)\s+(.+)$/i);
    if (!m) return null;
    const from = parseStartInput(m[1]);
    const to = parseStartInput(m[2]);
    if (!from && !to) return null;
    return normalizeRange(from, to);
  }

  function employeeKind(title) {
    const m = String(title || '').match(/\((Internal|External)\s+employee\)/i);
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : '—';
  }

  function sanitizeTitle(title) {
    return String(title || '')
      .replace(/Employee Onboarding Request\s*-\s*[^-]+-\s*/i, 'Onboarding · ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function detectModule() {
    if (settings.module === 'tickets' || settings.module === 'journeys') return settings.module;
    const journeyHeader = document.querySelector('th[data-name="initiator"], th[data-name="child_ticket_progress"], td[data-name="child_ticket_progress"]');
    const path = `${location.pathname} ${location.href}`;
    if (journeyHeader || /employee_onboarding|\/journeys|onboarding/i.test(path)) return 'journeys';
    return 'tickets';
  }

  let moduleId = detectModule();
  const page = () => settings[moduleId] || settings.tickets;

  function applyPageStyles() {
    const c = page().color;
    pageStyle.textContent = `
      .${ROW_MARK} {
        background-color: ${hexToRgba(c, 0.18)} !important;
        box-shadow: inset 4px 0 0 ${c} !important;
      }
      .${ROW_MARK} > td { background-color: ${hexToRgba(c, 0.18)} !important; }
      .${CELL_MARK} {
        background-color: ${hexToRgba(c, 0.35)} !important;
        outline: 2px solid ${c} !important;
        border-radius: 3px;
      }
      th[data-sth-col="start"], td[data-sth-col="start"] {
        width: 148px !important;
        min-width: 148px !important;
        max-width: 148px !important;
        box-sizing: border-box;
        vertical-align: middle;
        padding: 8px 12px !important;
        font-size: 13px;
      }
      th[data-sth-col="start"] {
        position: sticky;
        top: 0;
        z-index: 3;
        cursor: pointer;
        user-select: none;
        font-weight: 650;
        background: inherit !important;
        border-bottom: 1px solid var(--color-boundary-border-0-3, rgba(0,0,0,.08));
      }
      th[data-sth-col="start"]:hover { color: ${c}; }
      th[data-sth-col="start"] .sth-sort { margin-left: 6px; opacity: .45; font-size: 11px; }
      th[data-sth-col="start"].sth-on .sth-sort { opacity: 1; color: ${c}; }
      td[data-sth-col="start"] {
        color: inherit;
        white-space: nowrap;
      }
      td[data-sth-col="start"] .sth-empty { opacity: .35; }
      tr.${HIDE_MARK} { display: none !important; }
      [${HIDE_ATTR}="1"] { display: none !important; }
      #${RANGE_TABLE_ID} {
        width: 100%;
        border-collapse: separate;
        background: inherit;
      }
      #${RANGE_BANNER_ID} {
        margin: 8px 0;
        padding: 8px 12px;
        border-radius: 8px;
        font: 600 12px Inter, ui-sans-serif, system-ui, sans-serif;
        color: ${c};
        background: ${hexToRgba(c, 0.12)};
        border: 1px solid ${hexToRgba(c, 0.35)};
      }
      th[data-sth-col="start"].sth-filtered { color: ${c}; }
      th[data-sth-col="start"] .sth-range-badge {
        display: block;
        margin-top: 2px;
        font-size: 10px;
        font-weight: 650;
        letter-spacing: .02em;
        color: ${c};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
        cursor: pointer;
      }
      th[data-sth-col="start"]:not(.sth-filtered) .sth-range-badge {
        color: inherit;
        opacity: .55;
        text-transform: uppercase;
        letter-spacing: .06em;
      }
      th[data-sth-col="start"]:not(.sth-filtered) .sth-range-badge:hover {
        opacity: 1;
        color: ${c};
      }
      th[data-sth-col="start"] .sth-range-clear {
        margin-left: 4px;
        border: 0;
        padding: 0 3px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        opacity: .7;
      }
      th[data-sth-col="start"] .sth-range-clear:hover { opacity: 1; }
      #${RANGE_POP_ID} {
        position: fixed;
        z-index: 2147483646;
        width: 268px;
        padding: 12px;
        border-radius: 14px;
        color: #e8eaed;
        background: linear-gradient(180deg, rgba(28,32,38,.96), rgba(18,20,24,.98));
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 18px 50px rgba(0,0,0,.35);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
        box-sizing: border-box;
      }
      #${RANGE_POP_ID} * { box-sizing: border-box; }
      #${RANGE_POP_ID} h4 { margin: 0 0 10px; font-size: 12.5px; font-weight: 650; }
      #${RANGE_POP_ID} .sth-range-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      #${RANGE_POP_ID} label {
        display: grid;
        gap: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: #8b949e;
      }
      #${RANGE_POP_ID} input[type="date"] {
        height: 30px;
        width: 100%;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.05);
        color: #f2f4f7;
        padding: 0 8px;
        font-size: 12px;
        color-scheme: dark;
        outline: none;
      }
      #${RANGE_POP_ID} .sth-range-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
      #${RANGE_POP_ID} .sth-range-actions button {
        height: 30px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      #${RANGE_POP_ID} .sth-apply { border: 0; color: #fff; background: ${c}; }
      #${RANGE_POP_ID} .sth-clear {
        border: 1px solid rgba(255,255,255,.08);
        background: transparent;
        color: #c5cbd3;
      }
      #${RANGE_POP_ID} .sth-quick { display: grid; gap: 4px; margin-top: 8px; }
      #${RANGE_POP_ID} .sth-quick button {
        height: 26px;
        border: 0;
        border-radius: 7px;
        background: rgba(255,255,255,.04);
        color: #c5cbd3;
        text-align: left;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      #${RANGE_POP_ID} .sth-quick button:hover { background: rgba(255,255,255,.08); color: #fff; }
    `;
  }

  function prettyStart(d) {
    if (!d || Number.isNaN(d.getTime())) return null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }

  function removeStartColumn() {
    document.querySelectorAll('[data-sth-col="start"]').forEach((el) => el.remove());
  }

  function visibleJourneyTable() {
    return document.getElementById(RANGE_TABLE_ID)
      || document.querySelector(`table[${SRC_ATTR}="1"]`)
      || document.querySelector('thead th[data-name="subject"]')?.closest('table')
      || document;
  }

  function injectStartColumn(items) {
    if (moduleId !== 'journeys') {
      removeStartColumn();
      return;
    }
    const table = visibleJourneyTable();
    const subjectTh = table.querySelector?.('thead th[data-name="subject"]') || document.querySelector('thead th[data-name="subject"]');
    if (!subjectTh) return;
    let th = table.querySelector?.('thead th[data-sth-col="start"]') || subjectTh.parentElement.querySelector('th[data-sth-col="start"]');
    if (!th) {
      th = document.createElement('th');
      th.dataset.sthCol = 'start';
      th.className = 'ember-view ellipsis is-resizable sth-start-header';
      th.setAttribute('role', 'columnheader');
      subjectTh.after(th);
    }
    const cfg = page();
    const on = cfg.sortKey === 'start';
    const rangeOn = !!(cfg.startFrom || cfg.startTo);
    const rangeText = formatRangeLabel(cfg.startFrom, cfg.startTo);
    th.classList.toggle('sth-on', on);
    th.classList.toggle('sth-filtered', rangeOn);
    th.innerHTML = `Start date<span class="sth-sort">${on ? (cfg.sortDir === 'desc' ? '↓' : '↑') : '↕'}</span><span class="sth-range-badge" title="${
      rangeOn
        ? `Showing ${escapeHtml(rangeText)}. Click to edit, × to clear.`
        : 'Filter by from–to start dates'
    }">${
      rangeOn
        ? `${escapeHtml(rangeText)}<button type="button" class="sth-range-clear" title="Clear start date range">×</button>`
        : 'Filter'
    }</span>`;
    th.title = rangeOn
      ? `Showing ${rangeText}. Click to sort · Filter or right-click to change the from–to range`
      : 'Click to sort · Filter or right-click for from–to dates';
    items.forEach((item) => {
      const subjectTd = item.row.querySelector('td[data-name="subject"]');
      if (!subjectTd) return;
      let td = item.row.querySelector('td[data-sth-col="start"]');
      if (!td) {
        td = document.createElement('td');
        td.dataset.sthCol = 'start';
        td.className = 'ember-view sth-start-cell';
        subjectTd.after(td);
      }
      if (item.startKey) td.dataset.startKey = item.startKey;
      else delete td.dataset.startKey;
      const label = prettyStart(item.start);
      td.innerHTML = label
        ? `<span title="Start ${formatStart(item.startKey)} · Right-click to filter from–to">${label}</span>`
        : '<span class="sth-empty">—</span>';
    });
  }

  function cellText(row, sel) {
    const el = row.querySelector(sel);
    return String(el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function ticketHref(row) {
    const a = row.querySelector('a.subject-cell[href], a[href*="/tickets/"], a[href*="/employee_onboarding/"]');
    if (!a) return null;
    try { return new URL(a.getAttribute('href'), location.origin).href; } catch { return null; }
  }

  function rowStatus(row) {
    const badge = row.querySelector('[data-test-id="state-cell"] span, .status-result, td[data-name="status"] [title]');
    if (badge) return String(badge.getAttribute('title') || badge.textContent || '').replace(/\s+/g, ' ').trim();
    return '';
  }

  function rowStatusAge(row) {
    const trigger = row.querySelector('.status-list-trigger, [data-ebd-id$="-trigger"]');
    const label = trigger?.getAttribute('aria-label') || '';
    const m = label.match(/since\s+(\d+)\s+days?/i);
    return m ? Number(m[1]) : null;
  }

  function rowProgress(row) {
    const raw = row.querySelector('.progress-counts')?.textContent || '';
    const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return { done: null, total: null, pct: null };
    const done = +m[1];
    const total = +m[2];
    return { done, total, pct: total ? (done / total) * 100 : null };
  }

  function initiatorName(row) {
    const el = row.querySelector('.requester-cell-name, td[data-name="initiator"] a, td[data-name="initiator"]');
    return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function rowTbody(row) {
    return row.closest('tbody');
  }

  function collectRows(root) {
    const now = Date.now();
    const out = [];
    const scope = root || document.getElementById(RANGE_TABLE_ID) || document;
    scope.querySelectorAll('tr.et-tr').forEach((row, idx) => {
      if (row.closest('thead')) return;
      if (row.classList.contains(HIDE_MARK)) return;
      if (!row.dataset.sthOrd) row.dataset.sthOrd = String(idx);
      const updatedEl = row.querySelector('td[data-name="updated_at_date"] [data-test-id="date-cell"]');
      const createdEl = row.querySelector('td[data-name="created_at_date"] [data-test-id="date-cell"], td[data-name="created_at"] [data-test-id="date-cell"]');
      const titleEl = row.querySelector('td[data-name="subject"] [title], td[data-name="ticket_subject"] [title], a.subject-cell [title]');
      const title = titleEl?.getAttribute('title') || cellText(row, 'a.subject-cell');
      const updated = parseTicketDate(updatedEl?.getAttribute('title') || updatedEl?.textContent);
      const created = parseTicketDate(createdEl?.getAttribute('title') || createdEl?.textContent);
      const statusAge = rowStatusAge(row);
      const start = parseStartDate(title);
      const progress = rowProgress(row);
      const idleDays = statusAge != null
        ? statusAge
        : updated
          ? (now - updated.getTime()) / MS_DAY
          : created
            ? (now - created.getTime()) / MS_DAY
            : null;
      const startIn = start ? (start.getTime() - now) / MS_DAY : null;
      out.push({
        row,
        cell: updatedEl || createdEl,
        href: ticketHref(row),
        status: rowStatus(row) || '—',
        idleDays,
        created,
        updated,
        start,
        startIn,
        kind: employeeKind(title),
        progress,
        startKey: dateKey(start),
        initiator: initiatorName(row),
        ord: Number(row.dataset.sthOrd || idx),
        label: sanitizeTitle(title)
      });
    });
    return out;
  }

  function statusWanted(item) {
    const tags = (page().statuses || []).map((s) => s.toLowerCase());
    if (!tags.length) return false;
    return tags.includes(String(item.status).toLowerCase());
  }

  function startWanted(item) {
    const tags = page().startDates || [];
    if (!tags.length) return false;
    return !!(item.startKey && tags.includes(item.startKey));
  }

  function itemMatches(item) {
    const cfg = page();
    const stale = item.idleDays != null && item.idleDays >= cfg.days;
    const byStatus = statusWanted(item);
    const byStart = startWanted(item);
    const andMode = cfg.matchMode === 'and';
    let match = andMode
      ? (stale && (!cfg.statuses.length || byStatus) && (!cfg.startDates.length || byStart))
      : (stale || byStatus || byStart);
    if (cfg.maxProgress != null && item.progress.pct != null) {
      const low = item.progress.pct <= cfg.maxProgress;
      match = andMode ? (match && low) : (match || low);
    }
    if (cfg.startWithin != null && item.startIn != null) {
      const soon = item.startIn <= cfg.startWithin;
      match = andMode ? (match && soon) : (match || soon);
    }
    return match;
  }

  const ONBOARD_STATUS = {
    1: 'Awaiting Information',
    2: 'Cancelled',
    3: 'Being Processed',
    4: 'Closed'
  };

  let rangeToken = 0;
  let rangeBusy = false;
  let rangeComplete = false;
  let rangeViewKey = '';
  let rangeScanned = 0;
  let didWalkPages = false;
  let lastStats = { tickets: 0, marked: 0, hidden: 0 };
  let livePageId = '';
  let livePageHrefs = new Set();
  let liveFingerprint = '';
  let pendingPageChange = false;

  function rangeKey() {
    return `${page().startFrom || ''}|${page().startTo || ''}`;
  }

  function sourceTable() {
    return document.querySelector(`table[${SRC_ATTR}="1"]`)
      || document.querySelector('thead th[data-name="subject"]')?.closest('table');
  }

  function rowHrefOf(row) {
    return ticketHref(row) || '';
  }

  function sanitizeClone(tr) {
    tr.removeAttribute('id');
    tr.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    tr.classList.remove(HIDE_MARK, ROW_MARK);
    tr.removeAttribute('data-stale-days');
    return tr;
  }

  function waitFor(pred, timeout = 8000) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (pred()) return resolve(true);
        if (Date.now() - t0 > timeout) return resolve(false);
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  function pageCountInfo() {
    const re = /(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/i;
    const nodes = document.querySelectorAll('span, div, p, label');
    for (const el of nodes) {
      if (el.children.length) continue;
      const raw = el.dataset.sthCountOrig || el.textContent || '';
      const m = String(raw).match(re);
      if (m) return { from: +m[1], to: +m[2], total: +m[3], el };
    }
    return null;
  }

  function liveJourneyTable() {
    const staticTbl = document.getElementById(RANGE_TABLE_ID);
    const src = document.querySelector(`table[${SRC_ATTR}="1"]`)
      || document.querySelector('thead th[data-name="subject"]')?.closest('table');
    if (!src || src === staticTbl) return null;
    return src;
  }

  function currentPageId() {
    const info = pageCountInfo();
    const pager = info ? `${info.from}-${info.to}/${info.total}` : '';
    return `${location.pathname}${location.search}|${pager}`;
  }

  function dropStaleLiveRows() {
    const table = liveJourneyTable() || (
      document.getElementById(RANGE_TABLE_ID)
        ? null
        : document.querySelector('thead th[data-name="subject"]')?.closest('table')
    );
    if (!table || table.id === RANGE_TABLE_ID) return;
    const fp = fingerprint(table);
    if (pendingPageChange && liveFingerprint && fp === liveFingerprint) return;
    const id = currentPageId();
    const rows = [...table.querySelectorAll('tbody tr.et-tr')];
    const pageChanged = pendingPageChange || (livePageId && id !== livePageId);
    if (pageChanged && livePageHrefs.size) {
      rows.forEach((row) => {
        const href = ticketHref(row);
        if (href && livePageHrefs.has(href)) row.remove();
      });
      table.querySelectorAll('tbody tr.et-tr').forEach((row) => {
        delete row.dataset.sthOrd;
      });
      pendingPageChange = false;
    }
    const kept = [...table.querySelectorAll('tbody tr.et-tr')];
    livePageId = id;
    livePageHrefs = new Set(kept.map(ticketHref).filter(Boolean));
    liveFingerprint = fingerprint(table);
  }

  function rewriteCountLabels(shown) {
    const re = /^\s*\d+\s*[–-]\s*\d+\s+of\s+\d+\s*$/;
    document.querySelectorAll('span, div, p, label').forEach((el) => {
      if (el.children.length) return;
      if (!re.test(el.textContent || '')) return;
      if (el.dataset.sthCountOrig == null) el.dataset.sthCountOrig = el.textContent;
      el.textContent = shown ? `1–${shown} of ${shown}` : '0 of 0';
    });
  }

  function restoreCountLabels() {
    document.querySelectorAll('[data-sth-count-orig]').forEach((el) => {
      el.textContent = el.dataset.sthCountOrig;
      delete el.dataset.sthCountOrig;
    });
  }

  function pagerRoots() {
    const roots = new Set();
    document.querySelectorAll('.pagination, [data-test-id="pagination"], .pagination-container, .list-pagination, nav[aria-label*="agination" i]').forEach((el) => roots.add(el));
    const next = document.querySelector('[aria-label="Next"], [aria-label="Next page"], [rel="next"], [data-test-id="next-page"]');
    if (next) roots.add(next.closest('nav, .pagination, [class*="pag"]') || next.parentElement);
    return [...roots].filter((el) => el && !el.closest?.(`#${HOST_ID}`) && el.id !== RANGE_BANNER_ID);
  }

  function nextPageButton() {
    const el = document.querySelector('[aria-label="Next page"], [aria-label="Next"], [rel="next"], [data-test-id="next-page"], .pagination .next, .pagination [class*="next"]');
    if (!el || el.closest?.(`#${HOST_ID}`)) return null;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled')) return null;
    return el;
  }

  function firstPageButton() {
    return document.querySelector('[aria-label="First page"], [aria-label="First"], .pagination .first, [data-test-id="first-page"]');
  }

  function hasNextPage() {
    const info = pageCountInfo();
    if (info && info.to >= info.total) return false;
    return !!nextPageButton();
  }

  function setHiddenFlag(el, on) {
    if (!el) return;
    if (on) el.setAttribute(HIDE_ATTR, '1');
    else el.removeAttribute(HIDE_ATTR);
  }

  function hideSourceChrome(on) {
    const src = sourceTable();
    if (src) {
      src.setAttribute(SRC_ATTR, '1');
      setHiddenFlag(src, on);
    }
    pagerRoots().forEach((el) => setHiddenFlag(el, on));
    document.querySelectorAll('occluded-content').forEach((el) => setHiddenFlag(el, on));
  }

  function setRangeBanner(text) {
    let el = document.getElementById(RANGE_BANNER_ID);
    if (!text) {
      el?.remove();
      return;
    }
    const src = sourceTable();
    if (!el) {
      el = document.createElement('div');
      el.id = RANGE_BANNER_ID;
      (src?.parentNode || document.body).insertBefore(el, src || null);
    }
    el.textContent = text;
  }

  function mountStaticRows(rowEls) {
    const src = sourceTable();
    if (!src) return null;
    let table = document.getElementById(RANGE_TABLE_ID);
    if (!table) {
      table = src.cloneNode(false);
      table.id = RANGE_TABLE_ID;
      table.removeAttribute(HIDE_ATTR);
      table.removeAttribute(SRC_ATTR);
      const thead = src.querySelector('thead');
      if (thead) table.appendChild(thead.cloneNode(true));
      table.appendChild(document.createElement('tbody'));
      src.parentNode.insertBefore(table, src);
    }
    const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
    tbody.replaceChildren();
    rowEls.forEach((row, i) => {
      const tr = row.cloneNode(true);
      sanitizeClone(tr);
      tr.dataset.sthOrd = String(i);
      tbody.appendChild(tr);
    });
    hideSourceChrome(true);
    rewriteCountLabels(rowEls.length);
    return table;
  }

  function teardownRangeView() {
    const hadView = !!(document.getElementById(RANGE_TABLE_ID) || rangeViewKey);
    if (!hadView && !didWalkPages) return;
    rangeToken += 1;
    rangeBusy = false;
    rangeComplete = false;
    rangeViewKey = '';
    rangeScanned = 0;
    document.getElementById(RANGE_TABLE_ID)?.remove();
    setRangeBanner('');
    restoreCountLabels();
    hideSourceChrome(false);
    document.querySelectorAll(`[${HIDE_ATTR}="1"]`).forEach((el) => el.removeAttribute(HIDE_ATTR));
    document.querySelectorAll(`tr.${HIDE_MARK}`).forEach((el) => el.classList.remove(HIDE_MARK));
    if (didWalkPages) {
      didWalkPages = false;
      pendingPageChange = true;
      firstPageButton()?.click();
    }
  }

  function recordSubject(rec) {
    return rec.subject || rec.title || rec.ticket_subject || rec.name || rec.attributes?.subject || '';
  }

  function recordStartKey(rec) {
    const subject = recordSubject(rec);
    let key = dateKey(parseStartDate(subject));
    if (key) return key;
    const fields = rec.fields || rec.custom_fields || rec.attributes || {};
    for (const k of Object.keys(fields)) {
      if (!/join|start|date/i.test(k)) continue;
      key = parseStartInput(fields[k]) || dateKey(parseTicketDate(String(fields[k] || '')));
      if (key) return key;
    }
    return parseStartInput(rec.start_date || rec.date_of_joining || rec.joining_date);
  }

  function recordInRange(rec) {
    return startInRange({ startKey: recordStartKey(rec) });
  }

  function recordHref(rec) {
    if (rec.ticket_id) return new URL(`/a/tickets/${rec.ticket_id}`, location.origin).href;
    if (rec.id && /onboarding/i.test(location.pathname)) return new URL(`/a/employee_onboarding/${rec.id}`, location.origin).href;
    return '';
  }

  function fillRowFromRecord(tr, rec) {
    const subject = recordSubject(rec);
    const href = recordHref(rec);
    const a = tr.querySelector('a.subject-cell[href], a[href*="/tickets/"], a[href*="/employee_onboarding/"], a[href*="/journeys/"]');
    if (a) {
      const label = sanitizeTitle(subject) || subject;
      a.textContent = label;
      a.setAttribute('title', subject || label);
      if (href) a.setAttribute('href', href);
    }
    const titleHolders = tr.querySelectorAll('td[data-name="subject"] [title], td[data-name="ticket_subject"] [title]');
    titleHolders.forEach((el) => el.setAttribute('title', subject));
    const statusName = ONBOARD_STATUS[rec.status] || rec.status_name || rec.request_status || (typeof rec.status === 'string' ? rec.status : '');
    if (statusName) {
      const badge = tr.querySelector('[data-test-id="state-cell"] span, .status-result, td[data-name="status"] [title], td[data-name="status"]');
      if (badge) {
        badge.textContent = statusName;
        if (badge.hasAttribute('title')) badge.setAttribute('title', statusName);
      }
    }
    const created = rec.created_at ? prettyStart(new Date(rec.created_at)) : '';
    if (created) {
      const cell = tr.querySelector('td[data-name="created_at_date"] [data-test-id="date-cell"], td[data-name="created_at"] [data-test-id="date-cell"]');
      if (cell) {
        cell.textContent = created;
        cell.setAttribute('title', created);
      }
    }
    const initiator = rec.initiator_name || rec.requester_name || rec.actors && Object.values(rec.actors)[0]?.name || '';
    if (initiator) {
      const cell = tr.querySelector('.requester-cell-name, td[data-name="initiator"] a, td[data-name="initiator"]');
      if (cell) cell.textContent = initiator;
    }
    return tr;
  }

  function extractList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data !== 'object') return [];
    for (const k of ['onboarding_requests', 'journey_requests', 'tickets', 'requests', 'items', 'records']) {
      if (Array.isArray(data[k])) return data[k];
    }
    if (Array.isArray(data.data)) {
      return data.data.map((x) => (x && x.attributes ? { id: x.id, ...x.attributes } : x));
    }
    return [];
  }

  function listUrlCandidates() {
    const out = [];
    for (const e of performance.getEntriesByType('resource')) {
      const n = e.name;
      if (!/onboarding_requests|journeys\/requests/i.test(n)) continue;
      if (/\/form\b|\/configs\b/.test(n)) continue;
      try {
        const u = new URL(n, location.origin);
        u.searchParams.delete('page');
        u.searchParams.delete('per_page');
        out.push(u.toString());
      } catch { /* ignore */ }
    }
    return [...new Set(out)];
  }

  async function fetchJson(url) {
    const headers = { Accept: 'application/json' };
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(url, { credentials: 'include', headers });
    if (!res.ok) throw new Error(String(res.status));
    const ct = res.headers.get('content-type') || '';
    if (!/json/i.test(ct)) throw new Error('not-json');
    return res.json();
  }

  async function fetchAllPages(base) {
    const out = [];
    const origin = new URL(base, location.origin);
    for (let p = 1; p <= MAX_HARVEST_PAGES; p++) {
      origin.searchParams.set('page', String(p));
      origin.searchParams.set('per_page', '100');
      const data = await fetchJson(origin.toString());
      const list = extractList(data);
      if (!list.length) break;
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  async function harvestByApi(token, template) {
    if (!template) return null;
    const urls = listUrlCandidates();
    for (const base of urls) {
      if (token !== rangeToken) return null;
      try {
        const records = await fetchAllPages(base);
        if (!records.length) continue;
        const rows = records.filter(recordInRange).map((rec) => sanitizeClone(fillRowFromRecord(template.cloneNode(true), rec)));
        return { rows, scanned: records.length, complete: true };
      } catch {
        continue;
      }
    }
    return null;
  }

  function fingerprint(root) {
    return [...(root || document).querySelectorAll('tr.et-tr a[href]')].map((a) => a.getAttribute('href')).join('|');
  }

  async function harvestByPager(token, map) {
    const src = () => document.querySelector(`table[${SRC_ATTR}="1"]`) || sourceTable();
    let scanned = collectRows(src() || document).length;
    let pages = 1;
    while (pages < MAX_HARVEST_PAGES) {
      if (token !== rangeToken) return { scanned, complete: false };
      const btn = nextPageButton();
      if (!btn) break;
      const before = fingerprint(src());
      pendingPageChange = true;
      btn.click();
      didWalkPages = true;
      const moved = await waitFor(() => fingerprint(src()) !== before, 10000);
      if (!moved) break;
      dropStaleLiveRows();
      pages += 1;
      const items = collectRows(src() || document);
      scanned += items.length;
      items.filter(startInRange).forEach((item) => {
        const k = item.href || `${item.startKey}|${item.label}`;
        if (!map.has(k)) map.set(k, sanitizeClone(item.row.cloneNode(true)));
      });
      setRangeBanner(`Scanning page ${pages}… ${map.size} in range so far`);
    }
    const complete = !nextPageButton();
    const first = firstPageButton();
    if (didWalkPages && first && !first.disabled && first.getAttribute('aria-disabled') !== 'true') {
      const before = fingerprint(src());
      pendingPageChange = true;
      first.click();
      await waitFor(() => fingerprint(src()) !== before, 8000);
      dropStaleLiveRows();
    }
    return { scanned, complete };
  }

  function bannerText(shown, scanned, complete) {
    const range = formatRangeLabel(page().startFrom, page().startTo);
    if (!shown) return `No requests with start date ${range}.`;
    if (complete) return `Showing ${shown} request${shown === 1 ? '' : 's'} with start date ${range}. Pagination off.`;
    return `Showing ${shown} in range on scanned pages (${scanned} scanned).`;
  }

  async function harvestAndFill(initialItems) {
    if (rangeBusy) return;
    rangeBusy = true;
    const token = ++rangeToken;
    const map = new Map();
    initialItems.filter(startInRange).forEach((item) => {
      const k = item.href || `${item.startKey}|${item.label}`;
      map.set(k, sanitizeClone(item.row.cloneNode(true)));
    });
    setRangeBanner(`Loading start dates ${formatRangeLabel(page().startFrom, page().startTo)}…`);
    let scanned = initialItems.length;
    let complete = !hasNextPage();
    try {
      const template = initialItems[0]?.row || sourceTable()?.querySelector('tr.et-tr');
      const api = await harvestByApi(token, template);
      if (api) {
        scanned = Math.max(scanned, api.scanned);
        api.rows.forEach((row) => {
          const k = rowHrefOf(row) || row.textContent.replace(/\s+/g, ' ').trim().slice(0, 120);
          if (k && !map.has(k)) map.set(k, row);
        });
        complete = api.complete;
      }
      if (!complete && hasNextPage()) {
        const walked = await harvestByPager(token, map);
        scanned = Math.max(scanned, walked.scanned);
        complete = walked.complete;
      }
    } catch {
      complete = false;
    }
    if (token !== rangeToken) {
      rangeBusy = false;
      return;
    }
    rangeComplete = complete;
    rangeScanned = scanned;
    mountStaticRows([...map.values()]);
    setRangeBanner(bannerText(map.size, scanned, complete));
    rangeBusy = false;
    paintList();
  }

  function listedRows() {
    const items = collectRows();
    if (moduleId !== 'journeys' || !rangeActive()) return items;
    return items.filter(startInRange);
  }

  function clearMarks() {
    document.querySelectorAll(`.${ROW_MARK}`).forEach((el) => {
      el.classList.remove(ROW_MARK);
      el.removeAttribute('data-stale-days');
    });
    document.querySelectorAll(`.${CELL_MARK}`).forEach((el) => el.classList.remove(CELL_MARK));
  }

  function paintList() {
    clearMarks();
    const items = collectRows();
    const hits = items.filter(itemMatches);
    if (page().enabled) {
      hits.forEach((item) => {
        item.row.classList.add(ROW_MARK);
        if (item.idleDays != null) item.row.dataset.staleDays = String(Math.floor(item.idleDays));
        if (item.cell) item.cell.classList.add(CELL_MARK);
      });
    }
    const hidden = Math.max(0, rangeScanned - items.length);
    lastStats = { tickets: items.length, marked: hits.length, hidden };
    injectStartColumn(items);
    sortTableRows(items);
    renderStats();
  }

  function markTickets() {
    moduleId = detectModule();
    dropStaleLiveRows();
    if (moduleId !== 'journeys' || !rangeActive()) {
      teardownRangeView();
      rangeScanned = 0;
      paintList();
      return;
    }
    const key = rangeKey();
    const staticTable = document.getElementById(RANGE_TABLE_ID);
    if (staticTable && rangeViewKey === key) {
      paintList();
      return;
    }
    const src = sourceTable();
    const sourceItems = collectRows(src || document);
    rangeViewKey = key;
    rangeComplete = false;
    rangeScanned = sourceItems.length;
    const kept = sourceItems.filter(startInRange);
    mountStaticRows(kept.map((item) => sanitizeClone(item.row.cloneNode(true))));
    if (!document.getElementById(RANGE_TABLE_ID)) {
      sourceItems.forEach((item) => item.row.classList.toggle(HIDE_MARK, !startInRange(item)));
    }
    paintList();
    void harvestAndFill(sourceItems);
  }

  function sortValue(item, key) {
    if (key === 'start') return item.start ? item.start.getTime() : null;
    if (key === 'created') return item.created ? item.created.getTime() : null;
    if (key === 'status') return (item.status || '').toLowerCase();
    if (key === 'initiator') return (item.initiator || '').toLowerCase();
    if (key === 'progress') return item.progress.pct == null ? null : item.progress.pct;
    return item.ord;
  }

  function sortTableRows(items) {
    const cfg = page();
    const key = cfg.sortKey || 'default';
    const dir = cfg.sortDir === 'desc' ? -1 : 1;
    const groups = new Map();
    items.forEach((item) => {
      const body = rowTbody(item.row);
      if (!body) return;
      const inStatic = !!body.closest(`#${RANGE_TABLE_ID}`);
      if (!inStatic) {
        if (key === 'default') return;
        if (rangeBusy) return;
      }
      if (!groups.has(body)) groups.set(body, []);
      groups.get(body).push(item);
    });
    groups.forEach((list, body) => {
      list.sort((a, b) => {
        if (key === 'default') return (a.ord - b.ord);
        const va = sortValue(a, key);
        const vb = sortValue(b, key);
        if (va == null && vb == null) return a.ord - b.ord;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'string') {
          const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
          return cmp ? cmp * dir : a.ord - b.ord;
        }
        if (va === vb) return a.ord - b.ord;
        return va < vb ? -1 * dir : 1 * dir;
      });
      const occ = [...body.querySelectorAll('occluded-content')];
      list.forEach((item) => body.appendChild(item.row));
      occ.forEach((el) => body.appendChild(el));
    });
  }

  function summarize(values) {
    const xs = values.filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
    if (!xs.length) return { n: 0, avg: null, med: null, p90: null };
    const sum = xs.reduce((a, b) => a + b, 0);
    const at = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
    return { n: xs.length, avg: sum / xs.length, med: xs[Math.floor((xs.length - 1) / 2)], p90: at(90) };
  }

  function bucketize(values, buckets) {
    const xs = values.filter((n) => n != null && Number.isFinite(n));
    return buckets.map((b) => ({ key: b.key, n: xs.filter(b.test).length }));
  }

  function groupCount(items, key) {
    const map = new Map();
    items.forEach((r) => {
      const k = r[key] || '—';
      map.set(k, (map.get(k) || 0) + 1);
    });
    return [...map.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  }

  function fmtDur(d) {
    if (d == null || !Number.isFinite(d)) return '—';
    if (Math.abs(d) < 1 / 24) return `${Math.max(1, Math.round(Math.abs(d) * 1440))}m`;
    if (Math.abs(d) < 2) {
      const h = Math.abs(d) * 24;
      return `${d < 0 ? '−' : ''}${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
    }
    const v = Math.abs(d);
    return `${d < 0 ? '−' : ''}${v < 10 ? v.toFixed(1) : Math.round(v)}d`;
  }

  function buildReport() {
    const items = listedRows();
    const idle = items.map((r) => r.idleDays);
    const prog = items.map((r) => r.progress.pct);
    const startIn = items.map((r) => r.startIn);
    return {
      module: moduleId,
      n: items.length,
      idle: summarize(idle),
      progress: summarize(prog),
      startIn: summarize(startIn),
      idleBuckets: bucketize(idle.filter((n) => n != null && n >= 0), BUCKETS),
      progBuckets: bucketize(prog, PROG_BUCKETS),
      byStatus: groupCount(items, 'status'),
      byKind: groupCount(items, 'kind'),
      awaiting: items.filter((r) => /await/i.test(r.status)).length,
      processing: items.filter((r) => /process/i.test(r.status)).length,
      startPast: items.filter((r) => r.startIn != null && r.startIn < 0).length,
      startWeek: items.filter((r) => r.startIn != null && r.startIn >= 0 && r.startIn <= 7).length
    };
  }

  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(h) ? h : [];
    } catch { return []; }
  }

  function saveSnapshot() {
    const r = buildReport();
    const hist = loadHistory();
    hist.push({
      t: Date.now(),
      module: r.module,
      n: r.n,
      idleAvg: r.idle.avg,
      progAvg: r.progress.avg,
      awaiting: r.awaiting,
      processing: r.processing
    });
    while (hist.length > MAX_SNAPS) hist.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    return hist;
  }

  function openMarked() {
    markTickets();
    const urls = [...new Set(listedRows().filter(itemMatches).map((x) => x.href).filter(Boolean))];
    if (!urls.length) return;
    if (urls.length > 8 && !confirm(`Open ${urls.length} marked items in new tabs?`)) return;
    let opened = 0;
    urls.forEach((url) => { if (window.open(url, '_blank', 'noopener')) opened += 1; });
    if (opened < urls.length) alert(`Opened ${opened} of ${urls.length} tabs. Allow pop-ups for this site.`);
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:20px;right:20px;top:auto;left:auto;touch-action:none;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
      .fab, .panel {
        color: #e8eaed;
        background: linear-gradient(180deg, rgba(28,32,38,.92), rgba(18,20,24,.94));
        border: 1px solid rgba(255,255,255,.10);
        box-shadow: 0 18px 50px rgba(0,0,0,.35);
        backdrop-filter: blur(18px);
      }
      .fab { display: none; align-items: center; gap: 8px; height: 44px; padding: 0 14px 0 8px; border-radius: 999px; cursor: grab; user-select: none; }
      .fab.show { display: flex; }
      .fab .dot { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--accent, #e65100); color: #fff; font-size: 12px; font-weight: 700; pointer-events: none; }
      .fab .label { font-size: 13px; font-weight: 600; pointer-events: none; }
      .panel { width: 320px; border-radius: 18px; overflow: hidden; }
      .panel.hide { display: none; }
      .head { display: flex; align-items: center; gap: 10px; padding: 14px; border-bottom: 1px solid rgba(255,255,255,.07); cursor: grab; user-select: none; }
      .logo { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--accent, #e65100); color: #fff; flex: 0 0 auto; pointer-events: none; }
      .titles { flex: 1; min-width: 0; pointer-events: none; }
      .titles h1 { margin: 0; font-size: 13.5px; font-weight: 650; }
      .titles p { margin: 2px 0 0; font-size: 11px; color: #9aa3ad; }
      .icon-btn { width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: #9aa3ad; cursor: pointer; display: grid; place-items: center; }
      .icon-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
      .body { padding: 10px 12px; display: grid; gap: 6px; }
      .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8b949e; }
      .toggle { width: 42px; height: 24px; border-radius: 999px; border: 0; background: #3a4048; position: relative; cursor: pointer; padding: 0; }
      .toggle.on { background: var(--accent, #e65100); }
      .toggle i { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; }
      .toggle.on i { left: 21px; }
      .card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 8px 10px; display: grid; gap: 8px; }
      .tagbox-head .chev { color: #8b949e; font-size: 10px; width: 12px; text-align: center; }
      .tagbox.open .tagbox-head .chev { transform: rotate(90deg); }
      .days-val { font-size: 26px; font-weight: 700; color: #fff; }
      .days-val span { font-size: 13px; font-weight: 600; color: #9aa3ad; margin-left: 4px; }
      input[type="range"] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; background: linear-gradient(90deg, var(--accent) var(--p, 20%), #3a4048 var(--p, 20%)); border-radius: 99px; outline: none; }
      input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 3px solid var(--accent, #e65100); }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.03); color: #c5cbd3; font-size: 11px; font-weight: 650; cursor: pointer; }
      .chip.on { background: color-mix(in srgb, var(--accent) 22%, transparent); border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: #fff; }
      .seg { display: flex; padding: 2px; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); }
      .seg button { height: 24px; padding: 0 9px; border: 0; border-radius: 7px; background: transparent; color: #9aa3ad; font-size: 11px; font-weight: 650; cursor: pointer; }
      .seg button.on { background: var(--accent, #e65100); color: #fff; }
      .hint { margin: 0; font-size: 11px; color: #8b949e; line-height: 1.35; }
      .tagbox-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 2px 0; min-height: 24px; }
      .tagbox-body { display: none; }
      .tagbox.open .tagbox-body { display: grid; gap: 8px; }
      .tag-count { font-size: 10px; font-weight: 700; color: #9aa3ad; background: rgba(255,255,255,.06); border-radius: 999px; padding: 2px 7px; }
      .tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .tag { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 22%, transparent); color: #fff; font-size: 11px; font-weight: 650; }
      .tag button { width: 14px; height: 14px; border: 0; padding: 0; background: transparent; color: #fff; cursor: pointer; }
      .tagbox input { width: 100%; height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05); color: #f2f4f7; padding: 0 10px; font-size: 12px; outline: none; }
      .tagbox input[type="date"] { color-scheme: dark; padding: 0 8px; }
      .range-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .range-field { display: grid; gap: 4px; }
      .range-field span { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8b949e; }
      .swatch { width: 26px; height: 26px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .swatch.on { border-color: #fff; }
      .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .stat { background: rgba(255,255,255,.04); border-radius: 12px; padding: 10px 12px; }
      .stat b { display: block; font-size: 18px; font-weight: 700; }
      .stat span { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
      .foot { display: grid; gap: 6px; padding: 0 12px 12px; }
      .foot-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .ghost, .primary { height: 34px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
      .ghost { border: 1px solid rgba(255,255,255,.08); background: transparent; color: #c5cbd3; }
      .primary { border: 0; color: #fff; background: var(--accent, #e65100); }
      .report { display: none; width: min(620px, 94vw); max-height: 80vh; overflow: auto; border-radius: 18px; }
      .report.show { display: block; }
      .kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .section-title { margin: 4px 0 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8b949e; }
      .bars { display: grid; gap: 6px; }
      .bar-row { display: grid; grid-template-columns: 64px 1fr 28px; gap: 8px; align-items: center; font-size: 11px; color: #c5cbd3; }
      .bar-track { height: 8px; border-radius: 99px; background: #3a4048; overflow: hidden; }
      .bar-fill { height: 100%; border-radius: 99px; background: var(--accent, #e65100); }
      .split { width: 100%; border-collapse: collapse; font-size: 11px; }
      .split th, .split td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,.06); }
      .split th { text-align: left; color: #8b949e; }
      .split td.num { text-align: right; }
      .note { font-size: 11px; color: #8b949e; line-height: 1.4; }
    </style>
    <div class="fab" id="fab"><span class="dot" id="fabCount">0</span><span class="label" id="fabLabel">Ops panel</span></div>
    <section class="panel" id="panel">
      <header class="head" id="dragHandle">
        <div class="logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/><path d="M12 8v5l3 2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
        <div class="titles"><h1 id="panelTitle">Ops panel</h1><p id="panelSub">Detecting list…</p></div>
        <button class="icon-btn" id="collapse" title="Minimize"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
      </header>
      <div class="body">
        <div class="row-between"><span class="label">Page</span>
          <div class="seg" id="moduleSeg">
            <button type="button" data-module="auto">Auto</button>
            <button type="button" data-module="tickets">Tickets</button>
            <button type="button" data-module="journeys">Journeys</button>
          </div>
        </div>
        <div class="row-between"><span class="label">Highlight</span><button class="toggle" id="enabled"><i></i></button></div>
        <div class="card tagbox" data-sec="age">
          <button type="button" class="tagbox-head" data-toggle="age">
            <span class="label" id="daysCaption">Age</span>
            <span style="display:flex;align-items:center;gap:6px"><span class="tag-count" id="daysLabel">6d</span><span class="chev">▸</span></span>
          </button>
          <div class="tagbox-body">
            <input type="range" id="days" min="1" max="45" step="1" />
            <div class="chips" id="dayChips"></div>
          </div>
        </div>
        <div class="card tagbox" data-sec="match">
          <button type="button" class="tagbox-head" data-toggle="match">
            <span class="label">Match & views</span>
            <span class="chev">▸</span>
          </button>
          <div class="tagbox-body">
            <div class="row-between"><span class="label">Match</span>
              <div class="seg" id="matchMode">
                <button type="button" data-mode="and">All</button>
                <button type="button" data-mode="or">Any</button>
              </div>
            </div>
            <p class="hint" id="matchHint"></p>
            <div class="chips" id="viewPresets"></div>
            <div class="chips">
              <button class="ghost" id="saveView" type="button" style="height:28px;flex:1">Save</button>
              <button class="ghost" id="deleteView" type="button" style="height:28px;flex:1">Delete</button>
            </div>
          </div>
        </div>
        <div class="card tagbox" id="extraFilters" data-sec="extra"></div>
        <div class="card tagbox" id="sortBox" data-sec="sort">
          <button type="button" class="tagbox-head" data-toggle="sort">
            <span class="label">Sort</span>
            <span style="display:flex;align-items:center;gap:6px"><span class="tag-count" id="sortBadge">Default</span><span class="chev">▸</span></span>
          </button>
          <div class="tagbox-body">
            <div class="seg" id="sortDir">
              <button type="button" data-dir="asc">A→Z</button>
              <button type="button" data-dir="desc">Z→A</button>
            </div>
            <div class="chips" id="sortKeys"></div>
            <p class="hint" id="sortHint">Reorders rows on this page only.</p>
          </div>
        </div>
        <div class="card tagbox" id="statusBox" data-sec="status">
          <button type="button" class="tagbox-head" data-toggle="status">
            <span class="label" id="statusLabel">Status</span>
            <span style="display:flex;align-items:center;gap:6px"><span class="tag-count" id="statusCount">0</span><span class="chev">▸</span></span>
          </button>
          <div class="tagbox-body">
            <div class="tags" id="statusTags"></div>
            <input id="statusInput" type="text" placeholder="Add status · Enter" autocomplete="off" spellcheck="false" />
            <div class="chips" id="statusHints"></div>
          </div>
        </div>
        <div class="card tagbox" id="startBox" data-sec="start">
          <button type="button" class="tagbox-head" data-toggle="start">
            <span class="label" id="startLabel">Start date</span>
            <span style="display:flex;align-items:center;gap:6px"><span class="tag-count" id="startCount">0</span><span class="chev">▸</span></span>
          </button>
          <div class="tagbox-body">
            <p class="hint">From / to rebuilds the list to only those start dates. Extra pages are scanned so pagination can turn off when everything fits. Same control: Filter on the column, or right-click a start date.</p>
            <div class="range-row">
              <label class="range-field"><span>From</span><input id="startFrom" type="date" /></label>
              <label class="range-field"><span>To</span><input id="startTo" type="date" /></label>
            </div>
            <button class="ghost" id="clearStartRange" type="button" style="height:28px">Clear range</button>
            <p class="hint">Highlight specific dates from the title (Start DD-MM-YYYY):</p>
            <div class="tags" id="startTags"></div>
            <input id="startInput" type="text" placeholder="14-09-2026 · Enter" autocomplete="off" spellcheck="false" />
            <div class="chips" id="startHints"></div>
          </div>
        </div>
        <div class="card tagbox" data-sec="color">
          <button type="button" class="tagbox-head" data-toggle="color">
            <span class="label">Color</span>
            <span class="chev">▸</span>
          </button>
          <div class="tagbox-body">
            <div class="chips">
              <button class="swatch" data-color="#e65100" style="background:#e65100"></button>
              <button class="swatch" data-color="#c62828" style="background:#c62828"></button>
              <button class="swatch" data-color="#6a1b9a" style="background:#6a1b9a"></button>
              <button class="swatch" data-color="#1565c0" style="background:#1565c0"></button>
              <button class="swatch" data-color="#2e7d32" style="background:#2e7d32"></button>
              <input type="color" id="customColor" style="width:26px;height:26px;border:0;padding:0;background:none;cursor:pointer" />
            </div>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="primary" id="openStale">Open marked tabs</button>
        <div class="foot-row">
          <button class="ghost" id="openStats">Statistics</button>
          <button class="ghost" id="rescan">Rescan</button>
        </div>
      </div>
    </section>
    <section class="panel report" id="report">
      <header class="head" id="reportHandle">
        <div class="logo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
        <div class="titles"><h1 id="reportTitle">Statistics</h1><p id="reportSub">Live snapshot</p></div>
        <button class="icon-btn" id="closeReport"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </header>
      <div class="body" id="reportBody"></div>
      <div class="foot">
        <button class="primary" id="saveSnap">Save snapshot</button>
        <button class="ghost" id="clearHist">Clear history</button>
      </div>
    </section>
  `;

  const $ = (id) => shadow.getElementById(id);
  const panel = $('panel');
  const fab = $('fab');
  const report = $('report');
  let reportOpen = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function builtinPresets() { return moduleId === 'journeys' ? JOURNEY_PRESETS : TICKET_PRESETS; }
  function allPresets() { return [...builtinPresets(), ...(page().presets || [])]; }

  function barsHtml(buckets) {
    const max = Math.max(1, ...buckets.map((b) => b.n));
    return `<div class="bars">${buckets.map((b) => `<div class="bar-row"><span>${escapeHtml(b.key)}</span><div class="bar-track"><div class="bar-fill" style="width:${(b.n / max) * 100}%"></div></div><span>${b.n}</span></div>`).join('')}</div>`;
  }
  function tableHtml(rows) {
    if (!rows.length) return '<p class="note">No groups on this list.</p>';
    return `<table class="split"><thead><tr><th>Group</th><th class="num">n</th></tr></thead><tbody>${rows.slice(0, 12).map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderReport() {
    const r = buildReport();
    const hist = loadHistory().filter((h) => h.module === r.module);
    $('reportTitle').textContent = r.module === 'journeys' ? 'Journey statistics' : 'Ticket statistics';
    const rangeBit = r.module === 'journeys' && rangeActive() ? ` · start ${formatRangeLabel(page().startFrom, page().startTo)}` : '';
    $('reportSub').textContent = `${r.n} rows${rangeBit} · ${hist.length} snapshots · names not stored`;
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

  function clampPos(x, y) {
    const rect = host.getBoundingClientRect();
    const pad = 8;
    return {
      x: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - rect.width - pad)),
      y: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - rect.height - pad))
    };
  }
  function placeDefault() { host.style.top = 'auto'; host.style.left = 'auto'; host.style.right = '20px'; host.style.bottom = '20px'; }
  function placeAt(x, y) {
    const p = clampPos(x, y);
    host.style.left = p.x + 'px'; host.style.top = p.y + 'px'; host.style.right = 'auto'; host.style.bottom = 'auto';
    return p;
  }
  function applySavedPosition() {
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) requestAnimationFrame(() => placeAt(settings.x, settings.y));
    else placeDefault();
  }
  function renderStats() {
    $('fabCount').textContent = String(lastStats.marked);
    const name = moduleId === 'journeys' ? 'Journeys' : 'Tickets';
    const prefix = settings.module === 'auto' ? `Auto · ${name}` : name;
    const hiddenBit = lastStats.hidden ? ` · ${lastStats.hidden} hidden` : '';
    $('panelSub').textContent = `${prefix} · ${lastStats.marked}/${lastStats.tickets}${hiddenBit}`;
    $('openStale').textContent = lastStats.marked ? `Open ${lastStats.marked} marked` : 'Open marked tabs';
  }
  function discoveredStatuses() {
    return [...new Set(collectRows().map((r) => r.status).filter((s) => s && s !== '—'))].sort((a, b) => a.localeCompare(b));
  }
  function discoveredStarts() {
    return [...new Set(collectRows().map((r) => r.startKey).filter(Boolean))].sort();
  }
  function renderStatusTags() {
    const wrap = $('statusTags');
    const hints = $('statusHints');
    const cfg = page();
    wrap.innerHTML = cfg.statuses.map((s) => `<span class="tag">${escapeHtml(s)}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`).join('');
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => updatePage({ statuses: cfg.statuses.filter((s) => s.toLowerCase() !== btn.dataset.remove.toLowerCase()), activePreset: null }));
    });
    const selected = new Set(cfg.statuses.map((s) => s.toLowerCase()));
    hints.innerHTML = discoveredStatuses().filter((s) => !selected.has(s.toLowerCase()))
      .map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
    hints.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (cfg.statuses.some((s) => s.toLowerCase() === btn.dataset.add.toLowerCase())) return;
        updatePage({ statuses: [...cfg.statuses, btn.dataset.add], activePreset: null });
      });
    });
  }
  function addStartDate(raw) {
    const key = parseStartInput(raw);
    if (!key) return;
    if ((page().startDates || []).includes(key)) return;
    updatePage({ startDates: [...(page().startDates || []), key], activePreset: null });
  }
  function renderStartTags() {
    const wrap = $('startTags');
    const hints = $('startHints');
    const cfg = page();
    wrap.innerHTML = (cfg.startDates || []).map((s) =>
      `<span class="tag">${escapeHtml(formatStart(s))}<button type="button" data-remove="${escapeHtml(s)}">×</button></span>`
    ).join('');
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => updatePage({ startDates: cfg.startDates.filter((s) => s !== btn.dataset.remove), activePreset: null }));
    });
    const selected = new Set(cfg.startDates || []);
    hints.innerHTML = discoveredStarts().filter((s) => !selected.has(s))
      .map((s) => `<button type="button" class="chip" data-add="${escapeHtml(s)}">${escapeHtml(formatStart(s))}</button>`).join('');
    hints.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => addStartDate(btn.dataset.add));
    });
  }
  function renderViewPresets() {
    const wrap = $('viewPresets');
    const cfg = page();
    wrap.innerHTML = allPresets().map((p) => `<button type="button" class="chip${cfg.activePreset === p.id ? ' on' : ''}" data-preset="${p.id}">${escapeHtml(p.name)}</button>`).join('');
    wrap.querySelectorAll('button[data-preset]').forEach((btn) => btn.addEventListener('click', () => applyPreset(btn.dataset.preset)));
  }
  function applyPreset(id) {
    const p = allPresets().find((x) => x.id === id);
    if (!p) return;
    updatePage({
      days: p.days,
      statuses: [...(p.statuses || [])],
      matchMode: p.matchMode === 'and' ? 'and' : 'or',
      maxProgress: p.maxProgress ?? null,
      startWithin: p.startWithin ?? null,
      startDates: [...(p.startDates || [])],
      startFrom: validDateKey(p.startFrom),
      startTo: validDateKey(p.startTo),
      activePreset: p.id,
    });
  }
  function renderExtraFilters() {
    const box = $('extraFilters');
    if (moduleId !== 'journeys') { box.style.display = 'none'; box.innerHTML = ''; return; }
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
    box.querySelectorAll('[data-prog]').forEach((btn) => btn.addEventListener('click', () => updatePage({ maxProgress: btn.dataset.prog === '' ? null : Number(btn.dataset.prog), activePreset: null })));
    box.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', () => updatePage({ startWithin: btn.dataset.start === '' ? null : Number(btn.dataset.start), activePreset: null })));
    box.querySelector('#maxProgress')?.addEventListener('input', (e) => updatePage({ maxProgress: Number(e.target.value), activePreset: null }));
  }

  function sortOptions() {
    if (moduleId === 'journeys') {
      return [
        { id: 'default', name: 'Default' },
        { id: 'start', name: 'Start date' },
        { id: 'created', name: 'Created On' },
        { id: 'initiator', name: 'Initiator' },
        { id: 'status', name: 'Request Status' },
        { id: 'progress', name: 'Child progress' }
      ];
    }
    return [
      { id: 'default', name: 'Default' },
      { id: 'created', name: 'Created' },
      { id: 'status', name: 'Status' }
    ];
  }

  function renderSortKeys() {
    const wrap = $('sortKeys');
    const cfg = page();
    wrap.innerHTML = sortOptions().map((opt) =>
      `<button type="button" class="chip${cfg.sortKey === opt.id ? ' on' : ''}" data-sort="${opt.id}">${escapeHtml(opt.name)}</button>`
    ).join('');
    wrap.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (page().sortKey === btn.dataset.sort && btn.dataset.sort !== 'default') {
          updatePage({ sortDir: page().sortDir === 'asc' ? 'desc' : 'asc' });
        } else {
          updatePage({ sortKey: btn.dataset.sort });
        }
      });
    });
    shadow.querySelectorAll('#sortDir button').forEach((btn) => btn.classList.toggle('on', btn.dataset.dir === cfg.sortDir));
    const label = sortOptions().find((o) => o.id === cfg.sortKey)?.name || 'Default';
    if ($('sortBadge')) $('sortBadge').textContent = label;
    $('sortHint').textContent = cfg.sortKey === 'default'
      ? 'Table order from Freshservice.'
      : `Sorted by ${label}, ${cfg.sortDir === 'desc' ? 'newest / Z first' : 'oldest / A first'}.`;
  }

  function syncUI() {
    moduleId = detectModule();
    const cfg = page();
    const name = moduleId === 'journeys' ? 'Journeys' : 'Tickets';
    shadow.querySelectorAll('.panel, .fab, .logo, .toggle, input[type="range"], .primary').forEach((el) => el.style.setProperty('--accent', cfg.color));
    $('panelTitle').textContent = name;
    $('panelSub').textContent = settings.module === 'auto' ? `Auto · ${name}` : name;
    $('fabLabel').textContent = name;
    $('daysCaption').textContent = moduleId === 'journeys' ? 'Age' : 'Idle age';
    $('enabled').classList.toggle('on', cfg.enabled);
    $('days').value = String(cfg.days);
    $('days').style.setProperty('--p', ((cfg.days - 1) / 44) * 100 + '%');
    $('daysLabel').textContent = `${cfg.days}d`;
    $('customColor').value = cfg.color;
    $('dayChips').innerHTML = [3, 6, 10, 14, 21, 30].map((d) => `<button type="button" class="chip${d === cfg.days ? ' on' : ''}" data-days="${d}">${d}d</button>`).join('');
    $('dayChips').querySelectorAll('[data-days]').forEach((btn) => btn.addEventListener('click', () => updatePage({ days: Number(btn.dataset.days), activePreset: null })));
    shadow.querySelectorAll('#matchMode button').forEach((btn) => btn.classList.toggle('on', btn.dataset.mode === cfg.matchMode));
    shadow.querySelectorAll('#moduleSeg button').forEach((btn) => btn.classList.toggle('on', btn.dataset.module === settings.module));
    $('matchHint').textContent = cfg.matchMode === 'and'
      ? `Mark only if every selected filter matches (age, status, start).`
      : `Mark if age, status, or start date matches.`;
    $('statusLabel').textContent = cfg.matchMode === 'and' ? 'Limit to status' : 'Also mark status';
    $('statusCount').textContent = String(cfg.statuses.length);
    $('startLabel').textContent = cfg.matchMode === 'and' ? 'Limit to start date' : 'Start date';
    const rangeText = formatRangeLabel(cfg.startFrom, cfg.startTo);
    const startN = (cfg.startDates || []).length;
    $('startCount').textContent = rangeText ? (startN ? `${rangeText} · ${startN}` : rangeText) : String(startN);
    $('startFrom').value = cfg.startFrom || '';
    $('startTo').value = cfg.startTo || '';
    $('clearStartRange').style.display = (cfg.startFrom || cfg.startTo) ? '' : 'none';
    $('startBox').style.display = moduleId === 'journeys' ? '' : 'none';
    const open = settings.uiOpen || {};
    shadow.querySelectorAll('[data-sec]').forEach((el) => el.classList.toggle('open', !!open[el.dataset.sec]));
    $('deleteView').style.visibility = (cfg.presets || []).some((p) => p.id === cfg.activePreset) ? 'visible' : 'hidden';
    shadow.querySelectorAll('.swatch').forEach((sw) => sw.classList.toggle('on', sw.dataset.color.toLowerCase() === cfg.color.toLowerCase()));
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

  function updateRoot(partial) {
    settings = { ...settings, ...partial };
    saveSettings(settings);
    syncUI();
    if (!('x' in partial || 'y' in partial || 'collapsed' in partial)) markTickets();
  }
  function updatePage(partial) {
    settings[moduleId] = { ...page(), ...partial };
    saveSettings(settings);
    syncUI();
    markTickets();
  }

  const didDrag = { current: false };
  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (handle !== fab && e.target.closest('#collapse, .icon-btn, button, input, label')) return;
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const origX = rect.left; const origY = rect.top;
      const startX = e.clientX; const startY = e.clientY;
      let moved = false; didDrag.current = false;
      const onMove = (ev) => {
        const dx = ev.clientX - startX; const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true; didDrag.current = true;
        const p = placeAt(origX + dx, origY + dy);
        settings.x = p.x; settings.y = p.y;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) saveSettings(settings);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
  makeDraggable($('dragHandle'));
  makeDraggable($('reportHandle'));
  makeDraggable(fab);

  shadow.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-toggle]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const id = btn.dataset.toggle;
    const open = { ...(settings.uiOpen || {}) };
    open[id] = !open[id];
    updateRoot({ uiOpen: open });
  });
  const statusInput = $('statusInput');
  const startInput = $('startInput');
  const startFromInput = $('startFrom');
  const startToInput = $('startTo');
  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    statusInput.addEventListener(type, (e) => e.stopPropagation());
    startInput.addEventListener(type, (e) => e.stopPropagation());
    startFromInput.addEventListener(type, (e) => e.stopPropagation());
    startToInput.addEventListener(type, (e) => e.stopPropagation());
  });
  startInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const raw = startInput.value;
      startInput.value = '';
      const range = parseRangeInput(raw);
      if (range && (range.startFrom || range.startTo)) {
        setStartRange(range.startFrom, range.startTo);
        return;
      }
      addStartDate(raw);
    }
  });
  function readPanelRange() {
    setStartRange(startFromInput.value, startToInput.value);
  }
  startFromInput.addEventListener('change', readPanelRange);
  startToInput.addEventListener('change', readPanelRange);
  $('clearStartRange').addEventListener('click', () => clearStartRange());
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
  $('days').addEventListener('input', (e) => updatePage({ days: Number(e.target.value), activePreset: null }));
  shadow.querySelectorAll('#matchMode button').forEach((btn) => btn.addEventListener('click', () => updatePage({ matchMode: btn.dataset.mode, activePreset: null })));
  shadow.querySelectorAll('#moduleSeg button').forEach((btn) => btn.addEventListener('click', () => updateRoot({ module: btn.dataset.module })));
  shadow.querySelectorAll('#sortDir button').forEach((btn) => btn.addEventListener('click', () => updatePage({ sortDir: btn.dataset.dir })));
  $('saveView').addEventListener('click', () => {
    const name = window.prompt('Name this view', `${moduleId} ${page().days}d`);
    if (!name) return;
    const preset = {
      id: `p-${Date.now()}`,
      name: name.replace(/\s+/g, ' ').trim().slice(0, 32),
      days: page().days,
      statuses: [...page().statuses],
      matchMode: page().matchMode,
      maxProgress: page().maxProgress,
      startWithin: page().startWithin,
      startDates: [...(page().startDates || [])],
      startFrom: page().startFrom || null,
      startTo: page().startTo || null
    };
    updatePage({ presets: [...page().presets, preset], activePreset: preset.id });
  });
  $('deleteView').addEventListener('click', () => {
    const id = page().activePreset;
    if (!(page().presets || []).some((p) => p.id === id)) return;
    if (!confirm('Delete this saved view?')) return;
    updatePage({ presets: page().presets.filter((p) => p.id !== id), activePreset: null });
  });
  shadow.querySelectorAll('.swatch').forEach((sw) => sw.addEventListener('click', () => updatePage({ color: sw.dataset.color })));
  $('customColor').addEventListener('input', (e) => updatePage({ color: e.target.value }));
  $('collapse').addEventListener('click', (e) => { e.stopPropagation(); updateRoot({ collapsed: true }); });
  fab.addEventListener('click', () => { if (didDrag.current) { didDrag.current = false; return; } updateRoot({ collapsed: false }); });
  $('openStale').addEventListener('click', openMarked);
  $('openStats').addEventListener('click', () => {
    reportOpen = true;
    if (settings.collapsed) updateRoot({ collapsed: false });
    else syncUI();
    renderReport();
  });
  $('closeReport').addEventListener('click', (e) => { e.stopPropagation(); reportOpen = false; syncUI(); });
  $('saveSnap').addEventListener('click', () => { saveSnapshot(); renderReport(); });
  $('clearHist').addEventListener('click', () => {
    if (!confirm('Clear saved statistics snapshots?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderReport();
  });
  $('rescan').addEventListener('click', () => {
    rangeViewKey = '';
    rangeComplete = false;
    document.getElementById(RANGE_TABLE_ID)?.remove();
    markTickets();
  });

  function setStartRange(from, to, opts = {}) {
    const range = normalizeRange(from, to);
    if (opts.open) settings.uiOpen = { ...(settings.uiOpen || {}), start: true };
    updatePage({ ...range, activePreset: null });
  }
  function clearStartRange() {
    updatePage({ startFrom: null, startTo: null, activePreset: null });
  }

  let rangePopCloser = null;
  let rangePopEsc = null;
  function hideRangePop() {
    document.getElementById(RANGE_POP_ID)?.remove();
    if (rangePopCloser) {
      document.removeEventListener('mousedown', rangePopCloser, true);
      rangePopCloser = null;
    }
    if (rangePopEsc) {
      document.removeEventListener('keydown', rangePopEsc, true);
      rangePopEsc = null;
    }
  }
  function placeRangePop(pop, clientX, clientY) {
    const r = pop.getBoundingClientRect();
    const pad = 8;
    let x = clientX;
    let y = clientY;
    if (x + r.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - r.width - pad);
    if (y + r.height > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - r.height - pad);
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  }
  function showRangePop(clientX, clientY, seedKey) {
    hideRangePop();
    moduleId = detectModule();
    if (moduleId !== 'journeys') return;
    const cfg = page();
    const pop = document.createElement('div');
    pop.id = RANGE_POP_ID;
    const seedLabel = seedKey ? formatStart(seedKey) : '';
    const quick = seedKey ? `
      <div class="sth-quick">
        <button type="button" data-quick="from">From ${escapeHtml(seedLabel)}</button>
        <button type="button" data-quick="to">Until ${escapeHtml(seedLabel)}</button>
        <button type="button" data-quick="only">Only ${escapeHtml(seedLabel)}</button>
      </div>` : '';
    pop.innerHTML = `
      <h4>Filter start dates</h4>
      <div class="sth-range-grid">
        <label>From<input type="date" data-from value="${cfg.startFrom || ''}"></label>
        <label>To<input type="date" data-to value="${cfg.startTo || ''}"></label>
      </div>
      <div class="sth-range-actions">
        <button type="button" class="sth-apply">Show range</button>
        <button type="button" class="sth-clear">Clear</button>
      </div>
      ${quick}`;
    document.body.appendChild(pop);
    placeRangePop(pop, clientX, clientY);
    const apply = () => {
      setStartRange(pop.querySelector('[data-from]')?.value, pop.querySelector('[data-to]')?.value, { open: true });
      hideRangePop();
    };
    pop.querySelector('.sth-apply').addEventListener('click', apply);
    pop.querySelector('.sth-clear').addEventListener('click', () => {
      clearStartRange();
      hideRangePop();
    });
    pop.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.quick;
        if (kind === 'from') setStartRange(seedKey, page().startTo, { open: true });
        else if (kind === 'to') setStartRange(page().startFrom, seedKey, { open: true });
        else setStartRange(seedKey, seedKey, { open: true });
        hideRangePop();
      });
    });
    pop.querySelectorAll('input[type="date"]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          apply();
        }
      });
    });
    ['mousedown', 'click', 'pointerdown'].forEach((type) => {
      pop.addEventListener(type, (e) => e.stopPropagation());
    });
    pop.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    rangePopEsc = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      hideRangePop();
    };
    document.addEventListener('keydown', rangePopEsc, true);
    setTimeout(() => {
      rangePopCloser = (ev) => {
        const live = document.getElementById(RANGE_POP_ID);
        if (!live) return;
        if (live.contains(ev.target)) return;
        if (live.querySelector('input[type="date"]:focus')) return;
        hideRangePop();
      };
      document.addEventListener('mousedown', rangePopCloser, true);
    }, 0);
  }

  document.addEventListener('click', (e) => {
    const pager = e.target.closest?.('.pagination, [data-test-id="pagination"], [aria-label="Next"], [aria-label="Previous"], [aria-label="Next page"], [aria-label="Previous page"], [rel="next"], [rel="prev"], [data-test-id="next-page"], [data-test-id="prev-page"]');
    if (pager && !pager.closest(`#${HOST_ID}`) && !pager.closest(`#${RANGE_POP_ID}`)) {
      pendingPageChange = true;
    }
    const th = e.target.closest?.('th[data-sth-col="start"]');
    if (!th) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.target.closest('.sth-range-clear')) {
      clearStartRange();
      return;
    }
    if (e.target.closest('.sth-range-badge')) {
      const r = e.target.closest('.sth-range-badge').getBoundingClientRect();
      showRangePop(r.left, r.bottom + 4, null);
      return;
    }
    const nextDir = page().sortKey === 'start' && page().sortDir === 'asc' ? 'desc' : 'asc';
    updatePage({ sortKey: 'start', sortDir: nextDir });
  }, true);

  document.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest?.('[data-sth-col="start"]');
    if (!cell) return;
    moduleId = detectModule();
    if (moduleId !== 'journeys') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const seed = cell.matches('td') || cell.closest('td[data-sth-col="start"]')
      ? (cell.dataset.startKey || cell.closest('td[data-sth-col="start"]')?.dataset.startKey || null)
      : null;
    showRangePop(e.clientX, e.clientY, seed);
  }, true);

  window.addEventListener('resize', () => {
    hideRangePop();
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
      const p = placeAt(settings.x, settings.y);
      settings.x = p.x; settings.y = p.y; saveSettings(settings);
    }
  });

  applyPageStyles();
  syncUI();
  markTickets();

  let timer;
  window.__staleTicketObserver = new MutationObserver((muts) => {
    if (muts.every((m) => host.contains(m.target) || m.target.closest?.(`#${HOST_ID}, #${RANGE_POP_ID}, #${RANGE_TABLE_ID}, #${RANGE_BANNER_ID}`))) return;
    clearTimeout(timer);
    timer = setTimeout(markTickets, 300);
  });
  window.__staleTicketObserver.observe(document.body, { childList: true, subtree: true });
})();
