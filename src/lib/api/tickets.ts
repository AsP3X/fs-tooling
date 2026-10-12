// Human: Tickets API — status field map, filter paging, and ID lookups.
// Agent: READS /api/v2/ticket_form_fields and /api/v2/tickets/filter. Caches maps for 10 minutes.

import { MS_DAY } from '../constants';
import { ageDays, dateKey, daysUntil } from '../dates';
import { employeeKind, sanitizeTitle } from '../text';
import { parsePriority, priorityLabel } from '../ticket-fields';
import type { TicketSample } from '../ops';
import { parseStatusActivities } from '../ops-timeline';
import type { PageSettings, Reportable } from '../types';
import { apiRequest, asArray, asRecord } from './http';
import { buildTicketFilterQuery, chunkIds, idsQuery } from './query';

export interface ApiTicket {
  id: number;
  status: number | string;
  created_at?: string;
  updated_at?: string;
  subject?: string;
  due_by?: string | null;
  is_escalated?: boolean;
  fr_escalated?: boolean;
  priority?: number | null;
  /** null = unassigned; undefined = field missing from the payload. */
  responderId?: number | null;
  requesterName?: string;
}

export interface StatusMaps {
  byId: Map<number, string>;
  byName: Map<string, number>;
}

const DEFAULT_STATUSES: Array<[number, string]> = [
  [2, 'Open'],
  [3, 'Pending'],
  [4, 'Resolved'],
  [5, 'Closed'],
];

let statusCache: { at: number; maps: StatusMaps } | null = null;
const STATUS_TTL = 10 * 60 * 1000;

export function parseIso(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function idleFromUpdated(updated: Date | null, created: Date | null, now: number): number | null {
  const src = updated || created;
  if (!src) return null;
  return (now - src.getTime()) / MS_DAY;
}

export function statusLabel(status: number | string, maps: StatusMaps): string {
  if (typeof status === 'string' && status.trim()) return status;
  const id = Number(status);
  return maps.byId.get(id) || String(status);
}

function parseChoices(raw: unknown): Array<[number, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[number, string]> = [];
  raw.forEach((choice) => {
    if (Array.isArray(choice) && choice.length >= 2) {
      const name = String(choice[0]);
      const id = Number(choice[1]);
      if (name && Number.isFinite(id)) out.push([id, name]);
      return;
    }
    if (choice && typeof choice === 'object') {
      const rec = choice as Record<string, unknown>;
      const id = Number(rec.id ?? rec.value ?? rec.status_id);
      const name = String(rec.value ?? rec.label ?? rec.name ?? rec.status_name ?? '');
      if (name && Number.isFinite(id)) out.push([id, name]);
    }
  });
  return out;
}

export async function getStatusMaps(force = false): Promise<StatusMaps> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL) return statusCache.maps;
  const maps: StatusMaps = { byId: new Map(), byName: new Map() };
  DEFAULT_STATUSES.forEach(([id, name]) => {
    maps.byId.set(id, name);
    maps.byName.set(name.toLowerCase(), id);
  });
  const res = await apiRequest('/api/v2/ticket_form_fields');
  const root = asRecord(res.json);
  const fields = asArray(root.ticket_fields || root.ticket_form_fields);
  fields.forEach((field) => {
    const rec = asRecord(field);
    const name = String(rec.name || rec.column_name || '').toLowerCase();
    if (name !== 'status') return;
    parseChoices(rec.choices).forEach(([id, label]) => {
      maps.byId.set(id, label);
      maps.byName.set(label.toLowerCase(), id);
    });
  });
  // Human: A 401 or network miss must not freeze the English defaults for 10 minutes.
  // Agent: WRITES statusCache only after HTTP 2xx. RETURNS the defaults uncached on failure.
  if (!res.ok) return maps;
  statusCache = { at: Date.now(), maps };
  return maps;
}

/** Filter payloads sometimes include requester_name; GET ticket may nest requester.name. */
function requesterNameFrom(rec: Record<string, unknown>): string {
  if (typeof rec.requester_name === 'string' && rec.requester_name.trim()) return rec.requester_name.trim();
  const requester = asRecord(rec.requester);
  return String(requester.name || requester.full_name || '').trim();
}

/** undefined = field absent; null = present but empty (unassigned). */
function optionalAgentId(rec: Record<string, unknown>): number | null | undefined {
  const key = 'responder_id' in rec ? 'responder_id' : 'agent_id' in rec ? 'agent_id' : null;
  if (!key) return undefined;
  const raw = rec[key];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function ticketUnassigned(ticket: ApiTicket): boolean | null {
  if (ticket.responderId === undefined) return null;
  return ticket.responderId == null;
}

export function ticketEscalated(ticket: ApiTicket): boolean {
  return !!(ticket.is_escalated || ticket.fr_escalated);
}

export function asApiTicket(raw: unknown): ApiTicket | null {
  const rec = asRecord(raw);
  const id = Number(rec.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    status: rec.status as number | string,
    created_at: rec.created_at as string | undefined,
    updated_at: rec.updated_at as string | undefined,
    subject: rec.subject as string | undefined,
    due_by: rec.due_by as string | null | undefined,
    is_escalated: rec.is_escalated == null ? undefined : Boolean(rec.is_escalated),
    fr_escalated: rec.fr_escalated == null ? undefined : Boolean(rec.fr_escalated),
    priority: parsePriority(rec.priority as string | number | null | undefined),
    responderId: optionalAgentId(rec),
    requesterName: requesterNameFrom(rec) || undefined,
  };
}

export async function fetchTicket(id: number): Promise<ApiTicket | null> {
  const res = await apiRequest(`/api/v2/tickets/${id}`);
  if (!res.ok) return null;
  const root = asRecord(res.json);
  return asApiTicket(root.ticket || root);
}

function isoMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Map a ticket JSON payload to ops fields. Drops subject, requester, and agent names. */
export function ticketSampleFromJson(raw: unknown, maps: StatusMaps): TicketSample | null {
  const ticket = asApiTicket(raw);
  if (!ticket) return null;
  const rec = asRecord(raw);
  const stats = asRecord(rec.stats);
  return {
    status: statusLabel(ticket.status, maps),
    createdAt: isoMs(ticket.created_at),
    resolvedAt: isoMs(stats.resolved_at || rec.resolved_at),
    closedAt: isoMs(stats.closed_at || rec.closed_at),
    firstRespondedAt: isoMs(stats.first_responded_at || rec.first_responded_at),
    responderId: ticket.responderId,
  };
}

// Human: One ticket + stats embed. Used by the ops ledger, never written as a name-bearing record.
// Agent: CALLS GET /api/v2/tickets/{id}?include=stats. RETURNS TicketSample without subject/requester.
export async function fetchTicketSample(id: number): Promise<TicketSample | null> {
  const res = await apiRequest(`/api/v2/tickets/${id}?include=stats`);
  if (!res.ok) return null;
  const root = asRecord(res.json);
  const maps = await getStatusMaps();
  return ticketSampleFromJson(root.ticket || root, maps);
}

// Human: Next activities page, only when it stays on /api/v2. Absolute URLs are reduced to path + query.
// Agent: PURE. RETURNS '' when the link is missing or not an API path.
function activitiesPath(next: unknown): string {
  if (typeof next !== 'string' || !next.trim()) return '';
  try {
    if (next.startsWith('/')) return next.startsWith('/api/v2/') ? next : '';
    const url = new URL(next);
    if (!url.pathname.startsWith('/api/v2/')) return '';
    return `${url.pathname}${url.search}`;
  } catch {
    return '';
  }
}

// Human: Status transitions from the activities feed. Follows up to two further pages so the oldest change is not missing.
// Agent: CALLS GET /api/v2/tickets/{id}/activities. RETURNS { at, status } only. Stops on a non-2xx page.
export async function fetchTicketStatusLog(id: number): Promise<NonNullable<TicketSample['statusLog']>> {
  const events: NonNullable<TicketSample['statusLog']> = [];
  let path = `/api/v2/tickets/${id}/activities`;
  const seen = new Set<string>();
  for (let page = 0; page < 3 && path; page += 1) {
    if (seen.has(path)) break;
    seen.add(path);
    const res = await apiRequest(path);
    if (!res.ok) break;
    events.push(...parseStatusActivities(res.json));
    const root = asRecord(res.json);
    path = activitiesPath(root.next_page_url || asRecord(root.meta).next_page);
  }
  return events;
}

export async function fetchTicketsByIds(ids: number[]): Promise<Map<number, ApiTicket>> {
  const out = new Map<number, ApiTicket>();
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id)))];
  for (const group of chunkIds(unique)) {
    const q = encodeURIComponent(`"${idsQuery(group)}"`);
    const res = await apiRequest(`/api/v2/tickets/filter?query=${q}&per_page=100`);
    const root = asRecord(res.json);
    asArray(root.tickets).forEach((row) => {
      const t = asApiTicket(row);
      if (t) out.set(t.id, t);
    });
  }
  return out;
}

// Human: Page a /tickets/filter query. ok is false when the first page fails (no key, 401, bad query).
// Agent: READS /api/v2/tickets/filter. Caps at maxPages × 100.
export async function filterTicketsQuery(
  query: string,
  maxPages = 5,
): Promise<{ tickets: ApiTicket[]; ok: boolean; partial: boolean }> {
  if (!query.trim()) return { tickets: [], ok: false, partial: false };
  const encoded = encodeURIComponent(`"${query}"`);
  const out: ApiTicket[] = [];
  let ok = false;
  let partial = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await apiRequest(`/api/v2/tickets/filter?query=${encoded}&page=${page}&per_page=100`);
    if (!res.ok) {
      // Human: Page 1 down means there is no list. A later 429 still returns what we have, marked partial.
      if (page === 1) return { tickets: [], ok: false, partial: false };
      partial = true;
      break;
    }
    ok = true;
    const batch = asArray(asRecord(res.json).tickets).map(asApiTicket).filter((t): t is ApiTicket => !!t);
    out.push(...batch);
    if (batch.length < 100) break;
    if (page === maxPages) partial = true;
  }
  return { tickets: out, ok, partial };
}

export async function filterTickets(cfg: PageSettings, maps: StatusMaps, maxPages = 5): Promise<ApiTicket[]> {
  const { tickets } = await filterTicketsQuery(buildTicketFilterQuery(cfg, maps.byName), maxPages);
  return tickets;
}

export function ticketToReportable(
  ticket: ApiTicket,
  maps: StatusMaps,
  now: number,
  href: string | null = null,
): Reportable {
  const updated = parseIso(ticket.updated_at);
  const created = parseIso(ticket.created_at);
  const due = parseIso(ticket.due_by);
  const subject = ticket.subject || '';
  const dueIn = daysUntil(due, now);
  const unassigned = ticketUnassigned(ticket);
  const escalated = ticketEscalated(ticket);
  return {
    status: statusLabel(ticket.status, maps),
    idleDays: idleFromUpdated(updated, created, now),
    startKey: null,
    updatedKey: dateKey(updated),
    startIn: null,
    progress: { pct: null },
    kind: employeeKind(subject),
    href,
    label: sanitizeTitle(subject) || `Ticket #${ticket.id}`,
    subject,
    createdDays: ageDays(created, now),
    dueIn,
    priority: ticket.priority ?? null,
    unassigned,
    escalated,
    initiator: ticket.requesterName || '',
    priorityText: ticket.priority != null ? priorityLabel(ticket.priority) : null,
    agentText: unassigned === true ? 'Unassigned' : null,
    escalatedText: escalated ? 'Escalated' : null,
  };
}
