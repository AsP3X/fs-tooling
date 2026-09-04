// Human: Tickets API — status field map, filter paging, and ID lookups.
// Agent: READS /api/v2/ticket_form_fields and /api/v2/tickets/filter. Caches maps for 10 minutes.

import { MS_DAY } from '../constants';
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
  statusCache = { at: Date.now(), maps };
  return maps;
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
    is_escalated: Boolean(rec.is_escalated),
    fr_escalated: Boolean(rec.fr_escalated),
  };
}

export async function fetchTicket(id: number): Promise<ApiTicket | null> {
  const res = await apiRequest(`/api/v2/tickets/${id}`);
  if (!res.ok) return null;
  const root = asRecord(res.json);
  return asApiTicket(root.ticket || root);
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

export async function filterTickets(cfg: PageSettings, maps: StatusMaps, maxPages = 5): Promise<ApiTicket[]> {
  const query = buildTicketFilterQuery(cfg, maps.byName);
  const encoded = encodeURIComponent(`"${query}"`);
  const out: ApiTicket[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await apiRequest(`/api/v2/tickets/filter?query=${encoded}&page=${page}&per_page=100`);
    if (!res.ok) break;
    const batch = asArray(asRecord(res.json).tickets).map(asApiTicket).filter((t): t is ApiTicket => !!t);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export function ticketToReportable(ticket: ApiTicket, maps: StatusMaps, now: number): Reportable {
  const updated = parseIso(ticket.updated_at);
  const created = parseIso(ticket.created_at);
  return {
    status: statusLabel(ticket.status, maps),
    idleDays: idleFromUpdated(updated, created, now),
    startKey: null,
    startIn: null,
    progress: { pct: null },
    kind: '—',
  };
}
