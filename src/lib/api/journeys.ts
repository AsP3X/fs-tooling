// Human: Journey / onboarding API helpers — custom start dates and child-ticket progress.
// Agent: READS /api/v2/journeys/requests and /api/v2/onboarding_requests/{id}/tickets. Date fields named *date* / start / joining win.

import { dateKey } from '../dates';
import { MS_DAY } from '../constants';
import type { Progress, Reportable } from '../types';
import { apiRequest, asArray, asRecord } from './http';

export interface ApiJourney {
  id: number;
  display_id?: number;
  status?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  initiator_data?: { custom_fields?: Record<string, unknown> };
}

function coerceDate(value: unknown): Date | null {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = value > 1e12 ? new Date(value) : new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function startFromCustomFields(fields: Record<string, unknown> | undefined): Date | null {
  if (!fields) return null;
  const entries = Object.entries(fields);
  const preferred = entries.filter(([k]) => /start|joining|date/i.test(k));
  const pool = preferred.length ? preferred : entries;
  for (const [, value] of pool) {
    if (Array.isArray(value) || (value && typeof value === 'object')) continue;
    const d = coerceDate(value);
    if (d) return d;
  }
  return null;
}

export function asApiJourney(raw: unknown): ApiJourney | null {
  const rec = asRecord(raw);
  const id = Number(rec.id ?? rec.display_id);
  if (!Number.isFinite(id)) return null;
  const initiator = asRecord(rec.initiator_data);
  return {
    id: Number(rec.id) || id,
    display_id: rec.display_id != null ? Number(rec.display_id) : undefined,
    status: rec.status != null ? String(rec.status) : undefined,
    title: rec.title != null ? String(rec.title) : undefined,
    created_at: rec.created_at as string | undefined,
    updated_at: rec.updated_at as string | undefined,
    initiator_data: { custom_fields: asRecord(initiator.custom_fields) as Record<string, unknown> },
  };
}

function isDoneStatus(status: unknown): boolean {
  if (typeof status === 'number') return status === 4 || status === 5;
  const s = String(status || '').toLowerCase();
  return /resolved|closed|completed|done/.test(s);
}

export function progressFromChildTickets(tickets: unknown[]): Progress {
  if (!tickets.length) return { done: null, total: null, pct: null };
  const done = tickets.filter((t) => isDoneStatus(asRecord(t).status)).length;
  return { done, total: tickets.length, pct: (done / tickets.length) * 100 };
}

export async function fetchJourney(id: number): Promise<ApiJourney | null> {
  const res = await apiRequest(`/api/v2/journeys/requests/${id}`);
  if (!res.ok) return null;
  const root = asRecord(res.json);
  return asApiJourney(root.journey_request || root);
}

export async function fetchOnboardingChildren(id: number): Promise<unknown[]> {
  const res = await apiRequest(`/api/v2/onboarding_requests/${id}/tickets`);
  if (!res.ok) return [];
  const root = asRecord(res.json);
  return asArray(root.tickets || root.onboarding_tickets);
}

export async function listJourneys(maxPages = 5): Promise<ApiJourney[]> {
  const out: ApiJourney[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    let res = await apiRequest(`/api/v2/journeys/requests?per_page=100&page=${page}`);
    let batch = asArray(asRecord(res.json).journey_requests || asRecord(res.json).requests);
    if (!res.ok || !batch.length) {
      res = await apiRequest(`/api/v2/onboarding_requests?per_page=100&page=${page}`);
      batch = asArray(asRecord(res.json).onboarding_requests);
    }
    const rows = batch.map(asApiJourney).filter((j): j is ApiJourney => !!j);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

export function journeyToReportable(journey: ApiJourney, now: number, progress: Progress = { pct: null, done: null, total: null }): Reportable {
  const updated = journey.updated_at ? new Date(journey.updated_at) : null;
  const created = journey.created_at ? new Date(journey.created_at) : null;
  const start = startFromCustomFields(journey.initiator_data?.custom_fields);
  const idleSrc = updated && !Number.isNaN(updated.getTime()) ? updated : created;
  const idleDays = idleSrc && !Number.isNaN(idleSrc.getTime()) ? (now - idleSrc.getTime()) / MS_DAY : null;
  const startIn = start ? (start.getTime() - now) / MS_DAY : null;
  const status = journey.status ? String(journey.status).replace(/_/g, ' ') : '—';
  return {
    status,
    idleDays,
    startKey: dateKey(start),
    startIn,
    progress,
    kind: '—',
  };
}
