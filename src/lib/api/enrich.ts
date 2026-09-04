// Human: Overlay Freshservice API fields onto scraped rows; collect off-page matches for Open marked / stats.
// Agent: CALLS tickets/journeys APIs when a key works. Falls back to DOM on 401/empty. Caches ~30s unless force.

import { dateKey } from '../dates';
import { itemMatches } from '../match';
import { getModuleId, page } from '../state';
import type { PageSettings, Reportable, RowItem } from '../types';
import { journeyHrefFor, parseRecordRef, ticketHrefFor } from './ids';
import { fetchJourney, fetchOnboardingChildren, journeyToReportable, listJourneys, progressFromChildTickets, startFromCustomFields, type ApiJourney } from './journeys';
import { fetchTicket, fetchTicketsByIds, filterTickets, getStatusMaps, idleFromUpdated, parseIso, statusLabel, ticketToReportable, type ApiTicket, type StatusMaps } from './tickets';

const TTL = 30_000;
const ticketCache = new Map<number, { at: number; ticket: ApiTicket }>();
const journeyCache = new Map<number, { at: number; journey: ApiJourney; progressPct: number | null }>();
let filterCache: { key: string; at: number; tickets: ApiTicket[] } | null = null;
let journeyListCache: { at: number; rows: ApiJourney[] } | null = null;

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
  return {
    ...item,
    updated,
    created,
    status: statusLabel(ticket.status, maps) || item.status,
    idleDays: idleFromUpdated(updated, created, now) ?? item.idleDays,
    recordId: ticket.id,
    fromApi: true,
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
  return {
    ...item,
    start,
    startKey: dateKey(start) || item.startKey,
    startIn,
    updated,
    created,
    status,
    idleDays,
    progress,
    recordId: journey.id,
    fromApi: true,
  };
}

async function enrichTickets(items: RowItem[], force: boolean, now: number): Promise<{ items: RowItem[]; maps: StatusMaps; used: boolean }> {
  const maps = await getStatusMaps(force);
  const ids = items.map((i) => parseRecordRef(i.href)).filter((r): r is { kind: 'ticket'; id: number } => r?.kind === 'ticket').map((r) => r.id);
  const missing = ids.filter((id) => {
    const hit = ticketCache.get(id);
    return !hit || !cacheOk(hit.at, force);
  });
  if (missing.length) {
    const fetched = await fetchTicketsByIds(missing);
    fetched.forEach((ticket, id) => ticketCache.set(id, { at: Date.now(), ticket }));
    const still = missing.filter((id) => !ticketCache.has(id));
    await pool(still, 4, async (id) => {
      const ticket = await fetchTicket(id);
      if (ticket) ticketCache.set(id, { at: Date.now(), ticket });
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

async function enrichJourneys(items: RowItem[], force: boolean, now: number): Promise<{ items: RowItem[]; used: boolean }> {
  const refs = items.map((i) => parseRecordRef(i.href)).filter((r): r is { kind: 'journey'; id: number } => r?.kind === 'journey');
  const missing = refs.filter((r) => {
    const hit = journeyCache.get(r.id);
    return !hit || !cacheOk(hit.at, force);
  });
  await pool(missing, 4, async (ref) => {
    const journey = await fetchJourney(ref.id);
    if (!journey) return;
    const children = await fetchOnboardingChildren(ref.id);
    const progress = progressFromChildTickets(children);
    journeyCache.set(ref.id, { at: Date.now(), journey, progressPct: progress.pct });
  });
  const next = items.map((item) => {
    const ref = parseRecordRef(item.href);
    if (ref?.kind !== 'journey') return item;
    const hit = journeyCache.get(ref.id);
    return hit ? mergeJourneyRow(item, hit.journey, hit.progressPct, now) : item;
  });
  return { items: next, used: refs.some((r) => journeyCache.has(r.id)) };
}

async function offPageTickets(
  cfg: PageSettings,
  maps: StatusMaps,
  visibleIds: Set<number>,
  origin: string,
  sampleHref: string | null,
  force: boolean,
): Promise<{ urls: string[]; records: Reportable[]; truncated: boolean }> {
  const key = JSON.stringify({ d: cfg.days, s: cfg.statuses, m: cfg.matchMode });
  let tickets: ApiTicket[];
  if (filterCache && filterCache.key === key && cacheOk(filterCache.at, force)) {
    tickets = filterCache.tickets;
  } else {
    tickets = await filterTickets(cfg, maps, 5);
    filterCache = { key, at: Date.now(), tickets };
  }
  const extra = tickets.filter((t) => !visibleIds.has(t.id));
  const now = Date.now();
  return {
    urls: extra.map((t) => ticketHrefFor(origin, t.id, sampleHref)),
    records: extra.map((t) => ticketToReportable(t, maps, now)),
    truncated: tickets.length >= 500,
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
  let rows: ApiJourney[];
  if (journeyListCache && cacheOk(journeyListCache.at, force)) {
    rows = journeyListCache.rows;
  } else {
    rows = await listJourneys(5);
    journeyListCache = { at: Date.now(), rows };
  }
  const matched = rows.flatMap((j) => {
    if (visibleIds.has(j.id) || (j.display_id != null && visibleIds.has(j.display_id))) return [];
    const rec = journeyToReportable(j, now);
    return itemMatches(rec, cfg) ? [{ rec, url: journeyHrefFor(origin, j.display_id || j.id, sampleHref) }] : [];
  });
  return {
    urls: matched.map((m) => m.url),
    records: matched.map((m) => m.rec),
    truncated: rows.length >= 500,
  };
}

export async function enrichList(items: RowItem[], force = false): Promise<EnrichResult> {
  const now = Date.now();
  const origin = location.origin;
  const sample = items.find((i) => i.href)?.href || null;
  const moduleId = getModuleId();
  const cfg = page();
  const visibleIds = new Set(items.map((i) => parseRecordRef(i.href)?.id).filter((id): id is number => id != null));

  try {
    if (moduleId === 'journeys') {
      const { items: next, used } = await enrichJourneys(items, force, now);
      const off = used ? await offPageJourneys(cfg, visibleIds, origin, sample, force, now) : { urls: [], records: [], truncated: false };
      return {
        items: next,
        extraUrls: off.urls,
        extraMarked: off.urls.length,
        reportables: [...next, ...off.records],
        fromApi: used,
        truncated: off.truncated,
      };
    }
    const { items: next, maps, used } = await enrichTickets(items, force, now);
    const off = used ? await offPageTickets(cfg, maps, visibleIds, origin, sample, force) : { urls: [], records: [], truncated: false };
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
