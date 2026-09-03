// ==UserScript==
// @name         Freshservice Stale Tickets
// @namespace    sth
// @version      1.4
// @description  Highlight stale Freshservice tickets and open them in tabs
// @match        https://*.freshservice.com/*
// @match        https://*.myfreshworks.com/*
// @match        *://*/a/tickets*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  const NS = 'sth';
  const HOST_ID = `${NS}-host`;
  const STYLE_ID = `${NS}-page-style`;
  const ROW_MARK = `${NS}-row`;
  const CELL_MARK = `${NS}-cell`;
  const ROW_SEL = 'tr.et-tr';
  const DATE_SEL = 'td[data-name="updated_at_date"] [data-test-id="date-cell"]';
  const CREATED_SEL = 'td[data-name="created_at_date"] [data-test-id="date-cell"]';
  const TICKET_LINK_SEL = 'a.subject-cell[href], a[href*="/tickets/"]';
  const STORAGE_KEY = `${NS}-settings`;
  const HISTORY_KEY = `${NS}-history`;
  const MS_DAY = 24 * 60 * 60 * 1000;
  const MAX_SNAPS = 90;
  const BUCKETS = [
    { key: '<1d', test: (d) => d < 1 },
    { key: '1–3d', test: (d) => d >= 1 && d < 3 },
    { key: '3–7d', test: (d) => d >= 3 && d < 7 },
    { key: '7–14d', test: (d) => d >= 7 && d < 14 },
    { key: '14d+', test: (d) => d >= 14 }
  ];

  const DEFAULTS = {
    days: 6,
    color: '#e65100',
    enabled: true,
    collapsed: false,
    statuses: [],
    statusOpen: false,
    x: null,
    y: null
  };

  const loadSettings = () => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
      return { ...DEFAULTS };
    }
  };
  const saveSettings = (s) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  let settings = loadSettings();
  if (!Array.isArray(settings.statuses)) settings.statuses = [];
  if (settings.statusOpen == null) settings.statusOpen = false;

  document.getElementById(HOST_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  window.__staleTicketObserver?.disconnect();

  const pageStyle = document.createElement('style');
  pageStyle.id = STYLE_ID;
  document.head.appendChild(pageStyle);

  const hexToRgba = (hex, a) => {
    const h = hex.replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${a})`;
  };

  const applyPageStyles = () => {
    const c = settings.color;
    pageStyle.textContent = `
      .${ROW_MARK} {
        background-color: ${hexToRgba(c, 0.18)} !important;
        box-shadow: inset 4px 0 0 ${c} !important;
      }
      .${ROW_MARK} > td {
        background-color: ${hexToRgba(c, 0.18)} !important;
      }
      .${CELL_MARK} {
        background-color: ${hexToRgba(c, 0.35)} !important;
        outline: 2px solid ${c} !important;
        border-radius: 3px;
      }
    `;
  };

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };

  function parseTicketDate(raw) {
    if (!raw) return null;
    const str = String(raw).replace(/\s+/g, ' ').trim();
    let m = str.match(/(\d{1,2})\s+([A-Za-z]{3})\.?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m && MONTHS[m[2].toLowerCase()] != null) {
      return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0));
    }
    m = str.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    const native = new Date(str.replace(/,/g, ''));
    return Number.isNaN(native.getTime()) ? null : native;
  }

  function ticketHref(row) {
    const a = row.querySelector(TICKET_LINK_SEL);
    if (!a) return null;
    try {
      return new URL(a.getAttribute('href'), location.origin).href;
    } catch {
      return null;
    }
  }

  function rowStatus(row) {
    const el = row.querySelector('.status-result, td[data-name="status"] [title]');
    return String(el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function statusWanted(row) {
    const tags = (settings.statuses || []).map((s) => s.toLowerCase());
    if (!tags.length) return false;
    return tags.includes(rowStatus(row).toLowerCase());
  }

  function collectStaleRows() {
    const now = Date.now();
    const out = [];
    document.querySelectorAll(ROW_SEL).forEach((row) => {
      const cell = row.querySelector(DATE_SEL);
      const date = cell ? parseTicketDate(cell.getAttribute('title') || cell.textContent) : null;
      const stale = !!(date && (now - date.getTime()) / MS_DAY >= settings.days);
      const byStatus = statusWanted(row);
      if (!stale && !byStatus) return;
      out.push({ row, cell, href: ticketHref(row), date, stale, byStatus });
    });
    return out;
  }

  function clearMarks() {
    document.querySelectorAll(`.${ROW_MARK}`).forEach((el) => {
      el.classList.remove(ROW_MARK);
      el.removeAttribute('data-stale-days');
    });
    document.querySelectorAll(`.${CELL_MARK}`).forEach((el) => el.classList.remove(CELL_MARK));
  }

  let lastStats = { tickets: 0, marked: 0 };

  function markTickets() {
    clearMarks();
    const rows = document.querySelectorAll(ROW_SEL);
    const stale = collectStaleRows();
    if (settings.enabled) {
      const now = Date.now();
      stale.forEach(({ row, cell, date, byStatus }) => {
        row.classList.add(ROW_MARK);
        if (date) row.dataset.staleDays = String(Math.floor((now - date.getTime()) / MS_DAY));
        if (byStatus) row.dataset.statusMark = rowStatus(row);
        if (cell) cell.classList.add(CELL_MARK);
      });
    }
    lastStats = { tickets: rows.length, marked: stale.length };
    renderStats();
  }

  function cellText(row, sel) {
    const el = row.querySelector(sel);
    return String(el?.getAttribute('title') || el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function collectAllTickets() {
    const now = Date.now();
    return [...document.querySelectorAll(ROW_SEL)].map((row) => {
      const updated = parseTicketDate(cellText(row, DATE_SEL));
      const created = parseTicketDate(cellText(row, CREATED_SEL));
      return {
        status: rowStatus(row) || '—',
        priority: cellText(row, '.priority-result, td[data-name="priority"] [title]') || '—',
        owner: cellText(row, '.group-agent-result, td[data-name="assigned_to"]') || '—',
        idle: updated ? Math.max(0, (now - updated.getTime()) / MS_DAY) : null,
        cycle: created && updated ? Math.max(0, (updated.getTime() - created.getTime()) / MS_DAY) : null
      };
    });
  }

  function summarize(values) {
    const xs = values.filter((n) => n != null && Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    if (!xs.length) return { n: 0, avg: null, med: null, p90: null };
    const sum = xs.reduce((a, b) => a + b, 0);
    const at = (p) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1))];
    return { n: xs.length, avg: sum / xs.length, med: xs[Math.floor((xs.length - 1) / 2)], p90: at(90) };
  }

  function bucketize(values) {
    const xs = values.filter((n) => n != null && Number.isFinite(n) && n >= 0);
    return BUCKETS.map((b) => ({ key: b.key, n: xs.filter(b.test).length }));
  }

  function groupBy(rows, key, metric) {
    const map = new Map();
    rows.forEach((r) => {
      const k = r[key] || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r[metric]);
    });
    return [...map.entries()]
      .map(([name, vals]) => ({ name, ...summarize(vals) }))
      .sort((a, b) => b.n - a.n);
  }

  function fmtDur(d) {
    if (d == null || !Number.isFinite(d)) return '—';
    if (d < 1 / 24) return `${Math.max(1, Math.round(d * 24 * 60))}m`;
    if (d < 2) {
      const h = d * 24;
      return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
    }
    return `${d < 10 ? d.toFixed(1) : Math.round(d)}d`;
  }

  function buildReport() {
    const rows = collectAllTickets();
    const idle = rows.map((r) => r.idle);
    const cycle = rows.map((r) => r.cycle);
    return {
      n: rows.length,
      idle: summarize(idle),
      cycle: summarize(cycle),
      idleBuckets: bucketize(idle),
      cycleBuckets: bucketize(cycle),
      byStatusIdle: groupBy(rows, 'status', 'idle'),
      byStatusCycle: groupBy(rows, 'status', 'cycle'),
      byPriorityIdle: groupBy(rows, 'priority', 'idle'),
      byPriorityCycle: groupBy(rows, 'priority', 'cycle'),
      byOwnerIdle: groupBy(rows, 'owner', 'idle'),
      byOwnerCycle: groupBy(rows, 'owner', 'cycle')
    };
  }

  function loadHistory() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(h) ? h : [];
    } catch {
      return [];
    }
  }

  function saveSnapshot() {
    const r = buildReport();
    const hist = loadHistory();
    hist.push({
      t: Date.now(),
      n: r.n,
      idleAvg: r.idle.avg,
      cycleAvg: r.cycle.avg,
      idleP90: r.idle.p90,
      cycleP90: r.cycle.p90
    });
    while (hist.length > MAX_SNAPS) hist.shift();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
    return hist;
  }

  function openStaleTickets() {
    markTickets();
    const urls = [...new Set(collectStaleRows().map((x) => x.href).filter(Boolean))];
    if (!urls.length) {
      console.log('[stale-tickets] no stale ticket links on this page');
      return;
    }
    if (urls.length > 8 && !confirm(`Open ${urls.length} stale tickets in new tabs?`)) return;
    let opened = 0;
    urls.forEach((url) => {
      const win = window.open(url, '_blank', 'noopener');
      if (win) opened += 1;
    });
    if (opened < urls.length) {
      alert(`Opened ${opened} of ${urls.length} tabs. Allow pop-ups for this site to open the rest.`);
    }
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
        box-shadow: 0 18px 50px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.04) inset;
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      .fab {
        display: none; align-items: center; gap: 8px; height: 44px;
        padding: 0 14px 0 8px; border-radius: 999px;
        cursor: grab; user-select: none;
      }
      .fab.show { display: flex; }
      .fab:active, .fab.dragging { cursor: grabbing; }
      .fab .dot {
        width: 28px; height: 28px; border-radius: 50%;
        display: grid; place-items: center; pointer-events: none;
        background: var(--accent, #e65100); color: #fff; font-size: 12px; font-weight: 700;
      }
      .fab .label { font-size: 13px; font-weight: 600; pointer-events: none; }

      .panel { width: 288px; border-radius: 18px; overflow: hidden; }
      .panel.hide { display: none; }
      .panel.dragging, .fab.dragging { opacity: .92; }

      .head {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 14px 12px;
        border-bottom: 1px solid rgba(255,255,255,.07);
        cursor: grab; user-select: none;
      }
      .head:active { cursor: grabbing; }
      .logo {
        width: 32px; height: 32px; border-radius: 9px;
        display: grid; place-items: center; pointer-events: none;
        background: var(--accent, #e65100); color: #fff; flex: 0 0 auto;
      }
      .titles { flex: 1; min-width: 0; pointer-events: none; }
      .titles h1 { margin: 0; font-size: 13.5px; font-weight: 650; letter-spacing: -.01em; }
      .titles p { margin: 2px 0 0; font-size: 11px; color: #9aa3ad; }
      .grip { color: #6b7380; display: grid; place-items: center; pointer-events: none; }
      .icon-btn {
        width: 28px; height: 28px; border: 0; border-radius: 8px;
        background: transparent; color: #9aa3ad; cursor: pointer;
        display: grid; place-items: center;
      }
      .icon-btn:hover { background: rgba(255,255,255,.08); color: #fff; }

      .body { padding: 14px; display: grid; gap: 14px; }
      .row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #8b949e; }

      .toggle {
        width: 42px; height: 24px; border-radius: 999px; border: 0;
        background: #3a4048; position: relative; cursor: pointer; padding: 0;
      }
      .toggle.on { background: var(--accent, #e65100); }
      .toggle i {
        position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%;
        background: #fff; transition: left .16s ease; box-shadow: 0 1px 4px rgba(0,0,0,.3);
      }
      .toggle.on i { left: 21px; }

      .days-card {
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 14px; padding: 12px;
      }
      .days-top { display: flex; align-items: baseline; justify-content: space-between; }
      .days-val { font-size: 28px; font-weight: 700; letter-spacing: -.03em; line-height: 1; color: #fff; }
      .days-val span { font-size: 13px; font-weight: 600; color: #9aa3ad; margin-left: 4px; }

      input[type="range"] {
        -webkit-appearance: none; appearance: none; width: 100%; height: 4px; margin: 14px 0 8px;
        background: linear-gradient(90deg, var(--accent) var(--p, 20%), #3a4048 var(--p, 20%));
        border-radius: 99px; outline: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
        background: #fff; border: 3px solid var(--accent, #e65100); cursor: pointer;
      }

      .presets { display: flex; gap: 6px; }
      .chip {
        flex: 1; height: 28px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08);
        background: rgba(255,255,255,.03); color: #c5cbd3; font-size: 11px; font-weight: 650; cursor: pointer;
      }
      .chip:hover { background: rgba(255,255,255,.07); }
      .chip.on {
        background: color-mix(in srgb, var(--accent) 22%, transparent);
        border-color: color-mix(in srgb, var(--accent) 55%, transparent);
        color: #fff;
      }

      .tagbox {
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.06);
        border-radius: 14px; padding: 10px;
      }
      .tagbox-head {
        width: 100%; display: flex; align-items: center; justify-content: space-between;
        gap: 8px; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0;
      }
      .tagbox-head .chevron { color: #8b949e; transition: transform .16s ease; }
      .tagbox.open .chevron { transform: rotate(180deg); }
      .tagbox-body { display: none; margin-top: 8px; }
      .tagbox.open .tagbox-body { display: block; }
      .tag-count {
        font-size: 10px; font-weight: 700; color: #9aa3ad;
        background: rgba(255,255,255,.06); border-radius: 999px; padding: 2px 7px;
      }
      .tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .tag {
        display: inline-flex; align-items: center; gap: 6px;
        height: 24px; padding: 0 8px; border-radius: 999px;
        background: color-mix(in srgb, var(--accent) 22%, transparent);
        border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
        color: #fff; font-size: 11px; font-weight: 650;
      }
      .tag button {
        width: 14px; height: 14px; border: 0; padding: 0; border-radius: 50%;
        background: transparent; color: #fff; cursor: pointer; line-height: 1; font-size: 12px;
      }
      .tagbox input {
        width: 100%; height: 30px; margin-top: 8px; border-radius: 8px;
        border: 1px solid rgba(255,255,255,.10);
        background: rgba(255,255,255,.05); color: #f2f4f7;
        padding: 0 10px; font-size: 12px; outline: none;
      }
      .tagbox input::placeholder { color: #7d8692; }
      .hints { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .hint {
        height: 22px; padding: 0 8px; border-radius: 999px; cursor: pointer;
        border: 1px dashed rgba(255,255,255,.16);
        background: transparent; color: #9aa3ad; font-size: 11px; font-weight: 600;
      }
      .hint:hover { color: #fff; border-color: rgba(255,255,255,.35); }

      .color-row { display: flex; gap: 8px; }
      .swatch { width: 28px; height: 28px; border-radius: 8px; border: 2px solid transparent; cursor: pointer; padding: 0; }
      .swatch.on { border-color: #fff; }
      .picker-wrap {
        position: relative; width: 28px; height: 28px; border-radius: 8px; overflow: hidden;
        border: 1px dashed rgba(255,255,255,.25);
      }
      .picker-wrap input { position: absolute; inset: -4px; width: 36px; height: 36px; border: 0; padding: 0; cursor: pointer; background: none; }

      .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .stat { background: rgba(255,255,255,.04); border-radius: 12px; padding: 10px 12px; }
      .stat b { display: block; font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
      .stat span { font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }

      .foot { display: grid; grid-template-columns: 1fr; gap: 8px; padding: 0 14px 14px; }
      .ghost, .primary {
        height: 34px; border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer;
      }
      .ghost {
        border: 1px solid rgba(255,255,255,.08);
        background: transparent; color: #c5cbd3;
      }
      .ghost:hover { background: rgba(255,255,255,.06); color: #fff; }
      .danger:hover { color: #ff8a80; border-color: rgba(255,138,128,.35); }
      .primary {
        grid-column: 1 / -1;
        border: 0; color: #fff;
        background: var(--accent, #e65100);
      }
      .primary:hover { filter: brightness(1.08); }

      .report {
        display: none; width: min(560px, 92vw); max-height: 78vh; overflow: auto;
        border-radius: 18px;
      }
      .report.show { display: block; }
      .report .body { display: grid; gap: 14px; }
      .kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .kpi .stat b { font-size: 16px; }
      .section-title { margin: 2px 0 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8b949e; }
      .bars { display: grid; gap: 6px; }
      .bar-row { display: grid; grid-template-columns: 46px 1fr 28px; gap: 8px; align-items: center; font-size: 11px; color: #c5cbd3; }
      .bar-track { height: 8px; border-radius: 99px; background: #3a4048; overflow: hidden; }
      .bar-fill { height: 100%; border-radius: 99px; background: var(--accent, #e65100); }
      .split { width: 100%; border-collapse: collapse; font-size: 11px; }
      .split th { text-align: left; color: #8b949e; font-weight: 650; padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .split td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,.05); color: #e8eaed; }
      .split td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .split td.name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .spark { width: 100%; height: 64px; display: block; }
      .note { font-size: 11px; color: #8b949e; line-height: 1.4; }
    </style>

    <div class="fab" id="fab" title="Drag to move · click to open">
      <span class="dot" id="fabCount">0</span>
      <span class="label">Stale tickets</span>
    </div>

    <section class="panel" id="panel">
      <header class="head" id="dragHandle">
        <div class="logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5l3 2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.2"/>
          </svg>
        </div>
        <div class="titles">
          <h1>Stale tickets</h1>
          <p>Drag to move</p>
        </div>
        <span class="grip" aria-hidden="true">
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="3" cy="2" r="1.2"/><circle cx="9" cy="2" r="1.2"/>
            <circle cx="3" cy="8" r="1.2"/><circle cx="9" cy="8" r="1.2"/>
            <circle cx="3" cy="14" r="1.2"/><circle cx="9" cy="14" r="1.2"/>
          </svg>
        </span>
        <button class="icon-btn" id="collapse" title="Minimize to pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </button>
      </header>
      <div class="body">
        <div class="row-between">
          <span class="label">Highlight</span>
          <button class="toggle" id="enabled" aria-label="Toggle highlight"><i></i></button>
        </div>
        <div class="days-card">
          <div class="days-top">
            <span class="label">Updated older than</span>
            <div class="days-val" id="daysLabel">6<span>days</span></div>
          </div>
          <input type="range" id="days" min="1" max="30" step="1" />
          <div class="presets">
            <button class="chip" data-days="3">3d</button>
            <button class="chip" data-days="6">6d</button>
            <button class="chip" data-days="10">10d</button>
            <button class="chip" data-days="14">14d</button>
          </div>
        </div>
        <div class="tagbox" id="statusBox">
          <button type="button" class="tagbox-head" id="statusToggle">
            <span class="label">Also mark status</span>
            <span style="display:flex;align-items:center;gap:8px">
              <span class="tag-count" id="statusCount">0</span>
              <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </button>
          <div class="tagbox-body">
            <div class="tags" id="statusTags"></div>
            <input id="statusInput" type="text" placeholder="Type Open, Pending… Enter" autocomplete="off" spellcheck="false" />
            <div class="hints" id="statusHints"></div>
          </div>
        </div>
        <div>
          <div class="row-between" style="margin-bottom:8px"><span class="label">Color</span></div>
          <div class="color-row">
            <button class="swatch" data-color="#e65100" style="background:#e65100"></button>
            <button class="swatch" data-color="#c62828" style="background:#c62828"></button>
            <button class="swatch" data-color="#6a1b9a" style="background:#6a1b9a"></button>
            <button class="swatch" data-color="#1565c0" style="background:#1565c0"></button>
            <button class="swatch" data-color="#2e7d32" style="background:#2e7d32"></button>
            <label class="picker-wrap" title="Custom color">
              <input type="color" id="customColor" />
            </label>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><b id="statTickets">0</b><span>Scanned</span></div>
          <div class="stat"><b id="statMarked">0</b><span>Stale</span></div>
        </div>
      </div>
      <div class="foot">
        <button class="primary" id="openStale">Open stale in tabs</button>
        <button class="ghost" id="openStats">Statistics</button>
        <button class="ghost" id="rescan">Rescan</button>
      </div>
    </section>

    <section class="panel report" id="report">
      <header class="head" id="reportHandle">
        <div class="logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="titles">
          <h1>Ticket statistics</h1>
          <p id="reportSub">Live snapshot of this list</p>
        </div>
        <button class="icon-btn" id="closeReport" title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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

  function kpiCard(label, sum) {
    return `
      <div class="stat">
        <b>${fmtDur(sum.avg)}</b>
        <span>${label} · avg</span>
        <div class="note" style="margin-top:6px">med ${fmtDur(sum.med)} · p90 ${fmtDur(sum.p90)} · n ${sum.n}</div>
      </div>`;
  }

  function barsHtml(buckets) {
    const max = Math.max(1, ...buckets.map((b) => b.n));
    return `<div class="bars">${buckets.map((b) => `
      <div class="bar-row">
        <span>${b.key}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(b.n / max) * 100}%"></div></div>
        <span>${b.n}</span>
      </div>`).join('')}</div>`;
  }

  function tableHtml(idleRows, cycleRows) {
    const cycleMap = new Map(cycleRows.map((r) => [r.name, r]));
    const rows = idleRows.slice(0, 12);
    if (!rows.length) return '<p class="note">No rows on this list.</p>';
    return `<table class="split">
      <thead><tr><th>Group</th><th class="num">n</th><th class="num">Idle avg</th><th class="num">Cycle avg</th></tr></thead>
      <tbody>${rows.map((r) => {
        const c = cycleMap.get(r.name) || {};
        return `<tr>
          <td class="name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>
          <td class="num">${r.n}</td>
          <td class="num">${fmtDur(r.avg)}</td>
          <td class="num">${fmtDur(c.avg)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  function sparkHtml(hist, key, color) {
    const pts = hist.map((h) => h[key]).filter((n) => n != null);
    if (pts.length < 2) return '<p class="note">Save at least two snapshots for a trend.</p>';
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const w = 520;
    const h = 64;
    const d = pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * (w - 8) + 4;
      const y = h - 6 - ((v - min) / span) * (h - 12);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>
    </svg>
    <div class="note">idle avg ${fmtDur(hist[hist.length - 1].idleAvg)} · cycle avg ${fmtDur(hist[hist.length - 1].cycleAvg)} · ${hist.length} snapshots</div>`;
  }

  function renderReport() {
    const r = buildReport();
    const hist = loadHistory();
    $('reportSub').textContent = `${r.n} tickets on this list · ${hist.length} saved snapshots`;
    $('reportBody').innerHTML = `
      <div class="kpi">
        ${kpiCard('Idle (now − updated)', r.idle)}
        ${kpiCard('Cycle (updated − created)', r.cycle)}
      </div>
      <div class="section-title">Idle buckets</div>
      ${barsHtml(r.idleBuckets)}
      <div class="section-title">Cycle buckets</div>
      ${barsHtml(r.cycleBuckets)}
      <div class="section-title">By status</div>
      ${tableHtml(r.byStatusIdle, r.byStatusCycle)}
      <div class="section-title">By priority</div>
      ${tableHtml(r.byPriorityIdle, r.byPriorityCycle)}
      <div class="section-title">By group / agent</div>
      ${tableHtml(r.byOwnerIdle, r.byOwnerCycle)}
      <div class="section-title">Saved snapshots</div>
      ${sparkHtml(hist, 'idleAvg', settings.color)}
      <p class="note">Idle = time since last modification. Cycle = time from created to last modification. Only tickets currently in the list are included.</p>
    `;
  }

  function clampPos(x, y) {
    const rect = host.getBoundingClientRect();
    const pad = 8;
    return {
      x: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - rect.width - pad)),
      y: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - rect.height - pad))
    };
  }

  function placeDefault() {
    host.style.top = 'auto';
    host.style.left = 'auto';
    host.style.right = '20px';
    host.style.bottom = '20px';
  }

  function placeAt(x, y) {
    const p = clampPos(x, y);
    host.style.left = p.x + 'px';
    host.style.top = p.y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    return p;
  }

  function applySavedPosition() {
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
      requestAnimationFrame(() => placeAt(settings.x, settings.y));
    } else {
      placeDefault();
    }
  }

  function renderStats() {
    if (!$('statTickets')) return;
    $('statTickets').textContent = String(lastStats.tickets);
    $('statMarked').textContent = String(lastStats.marked);
    $('fabCount').textContent = String(lastStats.marked);
    const btn = $('openStale');
    if (btn) btn.textContent = lastStats.marked
      ? `Open ${lastStats.marked} stale tab${lastStats.marked === 1 ? '' : 's'}`
      : 'Open stale in tabs';
    const badge = document.querySelector('#sth-nav-item [data-sth-badge]');
    if (badge) badge.textContent = String(lastStats.marked || 0);
  }

  function syncUI() {
    shadow.querySelectorAll('.panel, .fab, .logo, .toggle, input[type="range"], .primary').forEach((el) => {
      el.style.setProperty('--accent', settings.color);
    });
    $('enabled').classList.toggle('on', settings.enabled);
    $('days').value = String(settings.days);
    $('days').style.setProperty('--p', ((settings.days - 1) / 29) * 100 + '%');
    $('daysLabel').innerHTML = `${settings.days}<span>day${settings.days === 1 ? '' : 's'}</span>`;
    $('customColor').value = settings.color;
    shadow.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('on', Number(chip.dataset.days) === settings.days);
    });
    shadow.querySelectorAll('.swatch').forEach((sw) => {
      sw.classList.toggle('on', sw.dataset.color.toLowerCase() === settings.color.toLowerCase());
    });
    panel.classList.toggle('hide', settings.collapsed || reportOpen);
    fab.classList.toggle('show', settings.collapsed && !reportOpen);
    report.classList.toggle('show', reportOpen && !settings.collapsed);
    applyPageStyles();
    applySavedPosition();
    renderStatusTags();
    const box = $('statusBox');
    if (box) box.classList.toggle('open', !!settings.statusOpen);
    const count = $('statusCount');
    if (count) count.textContent = String((settings.statuses || []).length);
  }

  function discoveredStatuses() {
    const set = new Set();
    document.querySelectorAll(ROW_SEL).forEach((row) => {
      const s = rowStatus(row);
      if (s) set.add(s);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  function addStatus(raw) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const exists = settings.statuses.some((s) => s.toLowerCase() === name.toLowerCase());
    if (exists) return;
    update({ statuses: [...settings.statuses, name] });
  }

  function removeStatus(name) {
    update({
      statuses: settings.statuses.filter((s) => s.toLowerCase() !== String(name).toLowerCase())
    });
  }

  function renderStatusTags() {
    const wrap = $('statusTags');
    const hints = $('statusHints');
    if (!wrap || !hints) return;
    wrap.innerHTML = settings.statuses.map((s) =>
      `<span class="tag">${s}<button type="button" data-remove="${s}" aria-label="Remove ${s}">×</button></span>`
    ).join('');
    wrap.querySelectorAll('button[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeStatus(btn.dataset.remove));
    });
    const selected = new Set(settings.statuses.map((s) => s.toLowerCase()));
    hints.innerHTML = discoveredStatuses()
      .filter((s) => !selected.has(s.toLowerCase()))
      .map((s) => `<button type="button" class="hint" data-add="${s}">${s}</button>`)
      .join('');
    hints.querySelectorAll('button[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => addStatus(btn.dataset.add));
    });
  }

  function update(partial) {
    settings = { ...settings, ...partial };
    saveSettings(settings);
    syncUI();
    if (!('x' in partial || 'y' in partial)) markTickets();
  }

  const didDrag = { current: false };

  function makeDraggable(handle, visual) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (handle !== fab && e.target.closest('#collapse, .icon-btn, button, input, label')) return;
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const origX = rect.left;
      const origY = rect.top;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      didDrag.current = false;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        didDrag.current = true;
        visual.classList.add('dragging');
        const p = placeAt(origX + dx, origY + dy);
        settings.x = p.x;
        settings.y = p.y;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        visual.classList.remove('dragging');
        if (moved) saveSettings(settings);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  makeDraggable($('dragHandle'), panel);
  makeDraggable($('reportHandle'), report);
  makeDraggable(fab, fab);

  $('statusToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    update({ statusOpen: !settings.statusOpen });
  });

  const statusInput = $('statusInput');
  const commitStatusInput = () => {
    addStatus(statusInput.value);
    statusInput.value = '';
  };
  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    statusInput.addEventListener(type, (e) => e.stopPropagation());
  });
  statusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitStatusInput();
    } else if (e.key === 'Backspace' && !statusInput.value && settings.statuses.length) {
      removeStatus(settings.statuses[settings.statuses.length - 1]);
    }
  });
  statusInput.addEventListener('blur', () => {
    if (statusInput.value.trim()) commitStatusInput();
  });

  $('enabled').addEventListener('click', () => update({ enabled: !settings.enabled }));
  $('days').addEventListener('input', (e) => update({ days: Number(e.target.value) }));
  shadow.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => update({ days: Number(chip.dataset.days) }));
  });
  shadow.querySelectorAll('.swatch').forEach((sw) => {
    sw.addEventListener('click', () => update({ color: sw.dataset.color }));
  });
  $('customColor').addEventListener('input', (e) => update({ color: e.target.value }));
  $('collapse').addEventListener('click', (e) => {
    e.stopPropagation();
    update({ collapsed: true });
  });
  fab.addEventListener('click', () => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    update({ collapsed: false });
  });
  $('openStale').addEventListener('click', openStaleTickets);
  $('openStats').addEventListener('click', () => {
    reportOpen = true;
    if (settings.collapsed) update({ collapsed: false });
    else syncUI();
    renderReport();
  });
  $('closeReport').addEventListener('click', (e) => {
    e.stopPropagation();
    reportOpen = false;
    syncUI();
  });
  $('saveSnap').addEventListener('click', () => {
    saveSnapshot();
    renderReport();
  });
  $('clearHist').addEventListener('click', () => {
    if (!confirm('Clear all saved statistics snapshots?')) return;
    localStorage.removeItem(HISTORY_KEY);
    renderReport();
  });
  $('rescan').addEventListener('click', markTickets);

  window.addEventListener('resize', () => {
    if (Number.isFinite(settings.x) && Number.isFinite(settings.y)) {
      const p = placeAt(settings.x, settings.y);
      settings.x = p.x;
      settings.y = p.y;
      saveSettings(settings);
    }
  });

  applyPageStyles();
  syncUI();
  markTickets();

  let timer;
  window.__staleTicketObserver = new MutationObserver((muts) => {
    if (muts.every((m) => host.contains(m.target) || m.target.closest?.(`#${HOST_ID}`))) return;
    clearTimeout(timer);
    timer = setTimeout(markTickets, 300);
  });
  window.__staleTicketObserver.observe(document.body, { childList: true, subtree: true });
})();
