// Human: Overlay Freshservice API fields onto scraped rows; off-page matches for Open marked / stats; date-range overlay rows.
// Agent: CALLS tickets/journeys APIs when a key works. Falls back to DOM on 401/empty. Caches ~30s unless force. Range listing does not change highlight matching.

import { ageDays, dateKey, daysUntil } from '../dates';
import { itemMatches } from '../match';
import { rangeActive, rangeModeFor, selectRangeRows } from '../range';
import { getApiKey } from '../secrets';
import { getModuleId, page } from '../state';
import { employeeKind } from '../text';
import { priorityLabel } from '../ticket-fields';
import type { PageSettings, Reportable, RowItem } from '../types';
import { journeyHrefFor, parseRecordRef, ticketHrefFor } from './ids';
import { fetchJourney, fetchJourneyList, fetchOnboarding, fetchOnboardingChildren, journeyToReportable, progressFromChildTickets, startFromCustomFields, type ApiJourney } from './journeys';
import { buildTicketFilterQuery, buildUpdatedRangeQuery } from './query';
import { fetchTicket, fetchTicketsByIds, filterTicketsQuery, getStatusMaps, idleFromUpdated, parseIso, statusLabel, ticketEscalated, ticketToReportable, ticketUnassigned, type ApiTicket, type StatusMaps } from './tickets';

const TTL = 30_000;
const ticketCache = new Map<number, { at: number; ticket: ApiTicket }>();
const journeyCache = new Map<number, { at: number; journey: ApiJourney; progressPct: number | null }>();
let filterCache: { key: string; at: number; tickets: ApiTicket[] } | null = null;
let journeyListCache: { at: number; rows: ApiJourney[] } | null = null;
/** Bumped when a newer enrich or range load starts, so a slow response cannot refresh the cache. */
let enrichGen = 0;
let rangeGen = 0;
let journeyListGen = 0;

export interface EnrichResult {
  items: RowItem[];
  extraUrls: string[];
  extraMarked: number;
  reportables: Reportable[];
  fromApi: boolean;
  truncated: boolean;
}

function cacheOk(at: number, force: boolean): boolean {
  return !force && Date.now() - at < TTL;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, Math.max(1, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

function mergeTicketRow(item: RowItem, ticket: ApiTicket, maps: StatusMaps, now: number): RowItem {
  const updated = parseIso(ticket.updated_at) || item.updated;
  const created = parseIso(ticket.created_at) || item.created;
  const due = parseIso(ticket.due_by);
  const assigned = ticketUnassigned(ticket);
  const hasEscalationFlag = ticket.is_escalated != null || ticket.fr_escalated != null;
  const escalated = hasEscalationFlag ? ticketEscalated(ticket) : item.escalated;
  const priority = ticket.priority ?? item.priority;
  const dueIn = daysUntil(due, now) ?? item.dueIn;
  const unassigned = assigned ?? item.unassigned;
  return {
    ...item,
    updated,
    created,
    status: statusLabel(ticket.status, maps) || item.status,
    updatedKey: dateKey(updated) || item.updatedKey,
    recordId: ticket.id,
    fromApi: true,
    subject: ticket.subject || item.subject,
    createdDays: ageDays(created, now) ?? item.createdDays,
    dueIn,
    priority,
    unassigned,
    escalated,
    // Human: "Open since N days" is time in status. updated_at moves when someone adds a note.
    idleDays: item.idleFromStatus && item.idleDays != null ? item.idleDays : (idleFromUpdated(updated, created, now) ?? item.idleDays),
    initiator: ticket.requesterName || item.initiator,
    priorityText: item.priorityText || (priority != null ? priorityLabel(priority) : null),
    agentText: item.agentText || (unassigned === true ? 'Unassigned' : null),
    escalatedText: item.escalatedText || (escalated === true ? 'Escalated' : null),
  };
}

function mergeJourneyRow(item: RowItem, journey: ApiJourney, progressPct: number | null, now: number): RowItem {
  const start = startFromCustomFields(journey.initiator_data?.custom_fields) || item.start;
  const updated = parseIso(journey.updated_at) || item.updated;
  const created = parseIso(journey.created_at) || item.created;
  const status = journey.status ? String(journey.status).replace(/_/g, ' ') : item.status;
  const idleDays = idleFromUpdated(updated, created, now) ?? item.idleDays;
  const startIn = start ? (start.getTime() - now) / 86400000 : item.startIn;
  const progress = progressPct != null
    ? { done: null, total: null, pct: progressPct }
    : item.progress;
  const title = journey.title || item.subject;
  return {
    ...item,
    start,
    startKey: dateKey(start) || item.startKey,
    updatedKey: dateKey(updated) || item.updatedKey,
    startIn,
    updated,
    created,
    status,
    idleDays,
    progress,
    recordId: journey.id,
    fromApi: true,
    subject: title || item.subject,
    initiator: item.initiator || journey.initiatorName || '',
    kind: item.kind !== '—' ? item.kind : employeeKind(title || ''),
    createdDays: ageDays(created, now) ?? item.createdDays,
  };
}

async function enrichTickets(
  items: RowItem[],
  force: boolean,
  now: number,
  current: () => boolean,
): Promise<{ items: RowItem[]; maps: StatusMaps; used: boolean }> {
  const maps = await getStatusMaps(force);
  const ids = items.map((i) => parseRecordRef(i.href)).filter((r): r is { kind: 'ticket'; id: number } => r?.kind === 'ticket').map((r) => r.id);
  const missing = ids.filter((id) => {
    const hit = ticketCache.get(id);
    return !hit || !cacheOk(hit.at, force);
  });
  if (missing.length) {
    const fetched = await fetchTicketsByIds(missing);
    if (current()) fetched.forEach((ticket, id) => ticketCache.set(id, { at: Date.now(), ticket }));
    const still = current() ? missing.filter((id) => !ticketCache.has(id)) : [];
    await pool(still, 4, async (id) => {
      const ticket = await fetchTicket(id);
      if (ticket && current()) ticketCache.set(id, { at: Date.now(), ticket });
    });
  }
  const next = items.map((item) => {
    const ref = parseRecordRef(item.href);
    if (ref?.kind !== 'ticket') return item;
    const hit = ticketCache.get(ref.id);
    return hit ? mergeTicketRow(item, hit.ticket, maps, now) : item;
  });
  return { items: next, maps, used: ids.some((id) => ticketCache.has(id)) };
}

async function enrichJourneys(
  items: RowItem[],
  force: boolean,
  now: number,
  current: () => boolean,
): Promise<{ items: RowItem[]; used: boolean }> {
  const refs = items.map((item) => ({ item, ref: parseRecordRef(item.href) }))
    .filter((row): row is { item: RowItem; ref: { kind: 'journey'; id: number } } => row.ref?.kind === 'journey');
  const missing = refs.filter((row) => {
    const hit = journeyCache.get(row.ref.id);
    return !hit || !cacheOk(hit.at, force);
  });
  await pool(missing, 4, async ({ item, ref }) => {
    // Human: /employee_onboarding/{id} and /journeys/requests/{id} are different resources. Child tickets exist on the onboarding id.
    const onboarding = /\/employee_onboarding\//i.test(item.href || '');
    const journey = onboarding ? await fetchOnboarding(ref.id) : await fetchJourney(ref.id);
    if (!journey || !current()) return;
    const progressPct = onboarding
      ? progressFromChildTickets(await fetchOnboardingChildren(ref.id)).pct
      : null;
    if (current()) journeyCache.set(ref.id, { at: Date.now(), journey, progressPct });
  });
  const next = items.map((item) => {
    const ref = parseRecordRef(item.href);
    if (ref?.kind !== 'journey') return item;
    const hit = journeyCache.get(ref.id);
    return hit ? mergeJourneyRow(item, hit.journey, hit.progressPct, now) : item;
  });
  return { items: next, used: refs.some((row) => journeyCache.has(row.ref.id)) };
}

async function loadJourneyRows(force: boolean): Promise<{ rows: ApiJourney[]; ok: boolean; partial: boolean }> {
  if (journeyListCache && cacheOk(journeyListCache.at, force)) {
    return { rows: journeyListCache.rows, ok: true, partial: false };
  }
  const gen = ++journeyListGen;
  const listed = await fetchJourneyList(5);
  if (gen === journeyListGen && listed.ok && !listed.partial) {
    journeyListCache = { at: Date.now(), rows: listed.rows };
  }
  return listed;
}

async function offPageTickets(
  cfg: PageSettings,
  maps: StatusMaps,
  visibleIds: Set<number>,
  origin: string,
  sampleHref: string | null,
  force: boolean,
  current: () => boolean = () => true,
): Promise<{ urls: string[]; records: Reportable[]; truncated: boolean }> {
  const key = JSON.stringify({
    d: cfg.days, s: cfg.statuses, m: cfg.matchMode,
    f: (cfg.filters || []).map((r) => [r.id, r.enabled, r.matchMode, r.invert, r.criteria]),
  });
  let tickets: ApiTicket[];
  let partial = false;
  if (filterCache && filterCache.key === key && cacheOk(filterCache.at, force)) {
    tickets = filterCache.tickets;
  } else {
    const listed = await filterTicketsQuery(buildTicketFilterQuery(cfg, maps.byName), 5);
    tickets = listed.ok ? listed.tickets : [];
    partial = listed.partial;
    if (listed.ok && !listed.partial && current()) filterCache = { key, at: Date.now(), tickets };
  }
  const extra = tickets.filter((t) => !visibleIds.has(t.id));
  const now = Date.now();
  const records = extra
    .map((t) => ticketToReportable(t, maps, now, ticketHrefFor(origin, t.id, sampleHref)))
    .filter((rec) => itemMatches(rec, cfg, 'tickets'));
  return {
    urls: records.map((r) => r.href).filter((href): href is string => !!href),
    records,
    truncated: partial || tickets.length >= 500,
  };
}

async function offPageJourneys(
  cfg: PageSettings,
  visibleIds: Set<number>,
  origin: string,
  sampleHref: string | null,
  force: boolean,
  now: number,
): Promise<{ urls: string[]; records: Reportable[]; truncated: boolean }> {
  const listed = await loadJourneyRows(force);
  const rows = listed.rows;
  const matched = rows.flatMap((j) => {
    if (visibleIds.has(j.id) || (j.display_id != null && visibleIds.has(j.display_id))) return [];
    const url = journeyHrefFor(origin, j.display_id || j.id, sampleHref);
    const rec = journeyToReportable(j, now, { pct: null, done: null, total: null }, url);
    return itemMatches(rec, cfg, getModuleId()) ? [{ rec, url }] : [];
  });
  return {
    urls: matched.map((m) => m.url),
    records: matched.map((m) => m.rec),
    truncated: listed.partial || rows.length >= 500,
  };
}

export async function enrichList(items: RowItem[], force = false): Promise<EnrichResult> {
  const gen = ++enrichGen;
  const current = (): boolean => gen === enrichGen;
  const now = Date.now();
  const origin = location.origin;
  const sample = items.find((i) => i.href)?.href || null;
  const moduleId = getModuleId();
  const cfg = page();
  const visibleIds = new Set(items.map((i) => parseRecordRef(i.href)?.id).filter((id): id is number => id != null));
  const stale = { items, extraUrls: [] as string[], extraMarked: 0, reportables: items, fromApi: false, truncated: false };

  try {
    if (moduleId === 'journeys') {
      const { items: next, used } = await enrichJourneys(items, force, now, current);
      if (!current()) return stale;
      const off = used ? await offPageJourneys(cfg, visibleIds, origin, sample, force, now) : { urls: [], records: [], truncated: false };
      if (!current()) return stale;
      return {
        items: next,
        extraUrls: off.urls,
        extraMarked: off.urls.length,
        reportables: [...next, ...off.records],
        fromApi: used,
        truncated: off.truncated,
      };
    }
    const { items: next, maps, used } = await enrichTickets(items, force, now, current);
    if (!current()) return stale;
    const off = used ? await offPageTickets(cfg, maps, visibleIds, origin, sample, force, current) : { urls: [], records: [], truncated: false };
    if (!current()) return stale;
    return {
      items: next,
      extraUrls: off.urls,
      extraMarked: off.urls.length,
      reportables: [...next, ...off.records],
      fromApi: used,
      truncated: off.truncated,
    };
  } catch {
    return { items, extraUrls: [], extraMarked: 0, reportables: items, fromApi: false, truncated: false };
  }
}

export interface RangeListResult {
  rows: Reportable[];
  fromApi: boolean;
  truncated: boolean;
}

let rangeCache: { key: string; at: number; result: RangeListResult } | null = null;

function dedupeByHref(rows: Reportable[]): Reportable[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const href = row.href || '';
    if (!href) return true;
    if (seen.has(href)) return false;
    seen.add(href);
    return true;
  });
}

function visibleRangeRows(items: RowItem[], mode: 'start' | 'updated', from: string | null, to: string | null): Reportable[] {
  return selectRangeRows(items, mode, from, to).map((item) => ({
    status: item.status,
    idleDays: item.idleDays,
    startKey: item.startKey,
    updatedKey: item.updatedKey,
    startIn: item.startIn,
    progress: item.progress,
    kind: item.kind,
    href: item.href,
    label: item.label,
  }));
}

// Human: Date-range overlay rows. Independent of idle/status highlighting. Cap 5×100.
// Agent: CALLS tickets/filter or journeys list when a key is saved. No key → empty (control is disabled in the panel).
export async function listRangeResults(visible: RowItem[], force = false): Promise<RangeListResult> {
  const gen = ++rangeGen;
  const cfg = page();
  const from = cfg.startFrom;
  const to = cfg.startTo;
  const moduleId = getModuleId();
  const mode = rangeModeFor(moduleId);
  if (!rangeActive(from, to)) return { rows: [], fromApi: false, truncated: false };

  const key = await getApiKey();
  if (!key) return { rows: [], fromApi: false, truncated: false };

  const cacheKey = JSON.stringify({ moduleId, from, to });
  if (rangeCache && rangeCache.key === cacheKey && cacheOk(rangeCache.at, force)) return rangeCache.result;

  const now = Date.now();
  const origin = location.origin;
  const sample = visible.find((i) => i.href)?.href || null;
  const fallback: RangeListResult = {
    rows: dedupeByHref(visibleRangeRows(visible, mode, from, to)),
    fromApi: false,
    truncated: false,
  };

  try {
    let result: RangeListResult;
    if (moduleId === 'journeys') {
      const listed = await loadJourneyRows(force);
      const rows = listed.rows;
      const ok = listed.ok;
      if (!ok) return fallback;
      const fromApi = rows.map((j) => {
        const href = journeyHrefFor(origin, j.display_id || j.id, sample);
        return journeyToReportable(j, now, { pct: null, done: null, total: null }, href);
      });
      result = {
        rows: dedupeByHref([...selectRangeRows(fromApi, mode, from, to), ...fallback.rows]),
        fromApi: true,
        truncated: listed.partial || rows.length >= 500,
      };
    } else {
      const maps = await getStatusMaps(force);
      const query = buildUpdatedRangeQuery(from, to);
      const { tickets, ok, partial } = await filterTicketsQuery(query, 5);
      if (!ok) return fallback;
      const fromApi = tickets.map((t) => ticketToReportable(t, maps, now, ticketHrefFor(origin, t.id, sample)));
      result = {
        rows: dedupeByHref([...selectRangeRows(fromApi, mode, from, to), ...fallback.rows]),
        fromApi: true,
        truncated: partial || tickets.length >= 500,
      };
    }
    // Human: A newer range load owns the cache. This call still returns the rows it fetched.
    if (gen === rangeGen) rangeCache = { key: cacheKey, at: Date.now(), result };
    return result;
  } catch {
    return fallback;
  }
}
