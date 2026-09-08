// Human: Side statistics panel — list overview of this agent's tracked tickets, or one ticket on detail.
// Agent: READS OPS_KEY via loadOps. WRITES only on Clear. Renders IDs/status/times; never names or subjects.

import { parseRecordRef } from '../lib/api/ids';
import { detectContext } from '../lib/context';
import { buildOpsOverview, clearOps, getTicketOps, liveStatusMs, loadOps } from '../lib/ops';
import { getSettings } from '../lib/state';
import { escapeHtml, fmtMs } from '../lib/text';

function barsHtml(rows: Array<{ key: string; n: number }>, format: (n: number) => string): string {
  if (!rows.length) return '<p class="note">Nothing tracked yet.</p>';
  const max = Math.max(1, ...rows.map((row) => row.n));
  return `<div class="bars">${rows.map((row) => `
    <div class="bar-row">
      <span>${escapeHtml(row.key)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(row.n / max) * 100}%"></div></div>
      <span>${escapeHtml(format(row.n))}</span>
    </div>`).join('')}</div>`;
}

function sparkline(values: number[]): string {
  const width = 240;
  const height = 40;
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length);
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = height - (v / max) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts}"/></svg>`;
}

function kpi(value: string, label: string): string {
  return `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`;
}

function renderOverview(now: number): string {
  const overview = buildOpsOverview(loadOps(), now);
  const selfKnown = loadOps().selfId != null;
  return `
    <p class="hint">Tickets you open in this browser. IDs, status, and times only — no names or subjects.</p>
    <div class="kpi">
      ${kpi(String(overview.tracked), 'Tracked')}
      ${kpi(String(overview.openedWeek), 'Touched in 7d')}
      ${kpi(String(overview.resolved), 'Resolved')}
      ${kpi(String(overview.returned), 'Returned to you')}
    </div>
    <div class="kpi">
      ${kpi(fmtMs(overview.medianHandleMs), 'Median time to resolve')}
      ${kpi(fmtMs(overview.medianAgeMs), 'Median age at resolve')}
      ${kpi(selfKnown ? String(overview.assignedToSelf) : '—', 'Assigned to you now')}
    </div>
    <div class="section-title">Opens · last 14 days</div>
    ${sparkline(overview.opensByDay)}
    <div class="section-title">Time in status</div>
    ${barsHtml(overview.statusDwell, (n) => fmtMs(n))}
    <p class="note">${selfKnown ? 'Returned to you counts tickets that left this agent and came back.' : 'Save an API key so assignment bounce-back can be detected without storing who else had the ticket.'}</p>`;
}

function renderTicket(id: number, now: number): string {
  const row = getTicketOps(id);
  if (!row) {
    return `<p class="hint">Ticket #${id} is not in the local ledger yet. Stay on this page a moment.</p>`;
  }
  const dwell = Object.entries(liveStatusMs(row, now))
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n);
  const done = row.resolvedAt || row.closedAt;
  const returned = row.returnedCount > 0
    ? `Yes · ${row.returnedCount}`
    : row.assignedToSelf == null
      ? 'Unknown'
      : 'No';
  const assigned = row.assignedToSelf == null ? 'Unknown' : row.assignedToSelf ? 'Yes' : 'No';
  return `
    <p class="hint">Ticket #${id}. No subject or people are stored.</p>
    <div class="kpi">
      ${kpi(String(row.openCount), 'Times opened')}
      ${kpi(fmtMs(now - row.firstOpenAt), 'Since first open')}
      ${kpi(fmtMs(row.createdAt ? now - row.createdAt : null), 'Age')}
      ${kpi(row.status || '—', 'Status')}
    </div>
    <div class="kpi">
      ${kpi(fmtMs(row.status ? now - row.statusSince : null), 'In this status')}
      ${kpi(fmtMs(row.firstRespondedAt && row.createdAt ? row.firstRespondedAt - row.createdAt : null), 'First response')}
      ${kpi(fmtMs(done && row.firstOpenAt && done >= row.firstOpenAt ? done - row.firstOpenAt : null), 'Your time to resolve')}
      ${kpi(fmtMs(done && row.createdAt && done >= row.createdAt ? done - row.createdAt : null), 'Age at resolve')}
    </div>
    <div class="row-between"><span class="label">Assigned to you</span><span class="tag-count">${escapeHtml(assigned)}</span></div>
    <div class="row-between"><span class="label">Returned after reassignment</span><span class="tag-count">${escapeHtml(returned)}</span></div>
    <div class="section-title">Time in each status</div>
    ${barsHtml(dwell, (n) => fmtMs(n))}`;
}

export function initStats(
  shadow: ShadowRoot,
  hooks: { onLayout?: () => void; onRefresh?: () => Promise<unknown> },
): { sync: () => void } {
  const title = shadow.getElementById('statsTitle');
  const sub = shadow.getElementById('statsSub');
  const body = shadow.getElementById('statsBody');
  if (!title || !sub || !body) return { sync: () => {} };

  const sync = (): void => {
    const ctx = detectContext(getSettings().module);
    const now = Date.now();
    const ref = parseRecordRef(location.pathname);
    const onTicket = ctx.surface === 'detail' && ref?.kind === 'ticket';
    title.textContent = onTicket ? `Ticket #${ref.id}` : 'Ticket ops';
    sub.textContent = onTicket ? 'This ticket' : 'Your tracked tickets';
    body.innerHTML = onTicket ? renderTicket(ref.id, now) : renderOverview(now);
    requestAnimationFrame(() => hooks.onLayout?.());
  };

  shadow.getElementById('refreshStats')?.addEventListener('click', () => {
    void Promise.resolve(hooks.onRefresh?.()).then(() => sync());
  });
  shadow.getElementById('clearOps')?.addEventListener('click', () => {
    if (!confirm('Clear locally tracked ticket times? This does not change Freshservice.')) return;
    clearOps();
    sync();
  });

  return { sync };
}
