// Human: Journey / onboarding API helpers — custom start dates and child-ticket progress.
// Agent: READS /api/v2/journeys/requests and /api/v2/onboarding_requests/{id}/tickets. Start prefers *date*/start/joining fields, then title.

import { ageDays, civilDate, dateKey, parseStartDate, parseStartInput } from '../dates';
import { MS_DAY } from '../constants';
import { employeeKind, sanitizeTitle } from '../text';
import type { Progress, Reportable } from '../types';
import { apiRequest, asArray, asRecord } from './http';

export interface ApiJourney {
  id: number;
  display_id?: number;
  status?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  initiatorName?: string;
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
  // Human: Onboarding custom fields often store joining day as DD-MM-YYYY, not ISO.
  const key = parseStartInput(s);
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  return civilDate(y, m, d);
}

function fieldRank(key: string): number {
  if (/start|joining/i.test(key)) return 0;
  if (/date/i.test(key) && !/end|birth|due|close|creat|updat/i.test(key)) return 1;
  if (/date/i.test(key)) return 2;
  return 3;
}

export function startFromCustomFields(fields: Record<string, unknown> | undefined): Date | null {
  if (!fields) return null;
  const entries = Object.entries(fields);
  const preferred = entries.filter(([k]) => fieldRank(k) < 3);
  const pool = (preferred.length ? preferred : entries).slice().sort((a, b) => fieldRank(a[0]) - fieldRank(b[0]));
  for (const [, value] of pool) {
    if (Array.isArray(value) || (value && typeof value === 'object')) continue;
    const d = coerceDate(value);
    if (d) return d;
  }
  return null;
}

/** Prefer initiator_data.name, then a string/object initiator field. */
function initiatorNameFrom(rec: Record<string, unknown>): string {
  const data = asRecord(rec.initiator_data);
  const fromData = String(data.name || data.full_name || data.display_name || '').trim();
  if (fromData) return fromData;
  if (typeof rec.initiator === 'string') return rec.initiator.trim();
  const obj = asRecord(rec.initiator);
  return String(obj.name || obj.full_name || obj.display_name || '').trim();
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
    // Human: Journey requests use title. Legacy onboarding requests use subject.
    title: rec.title != null ? String(rec.title) : rec.subject != null ? String(rec.subject) : undefined,
    created_at: rec.created_at as string | undefined,
    updated_at: rec.updated_at as string | undefined,
    initiatorName: initiatorNameFrom(rec) || undefined,
    initiator_data: {
      custom_fields: {
        ...(asRecord(rec.fields) as Record<string, unknown>),
        ...(asRecord(initiator.custom_fields) as Record<string, unknown>),
      },
    },
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

// Human: Legacy employee-onboarding record. Not the same id space as journeys/requests.
// Agent: CALLS GET /api/v2/onboarding_requests/{id}. RETURNS null on non-2xx.
export async function fetchOnboarding(id: number): Promise<ApiJourney | null> {
  const res = await apiRequest(`/api/v2/onboarding_requests/${id}`);
  if (!res.ok) return null;
  const root = asRecord(res.json);
  return asApiJourney(root.onboarding_request || root);
}

// Human: An empty later page is the end of one list. Falling through to the other API mixes the two.
// Agent: PURE. RETURNS true only for page 1 when that endpoint failed or returned no rows.
export function shouldFallbackJourneyList(page: number, ok: boolean, batchLength: number): boolean {
  return page === 1 && (!ok || batchLength === 0);
}

export async function fetchOnboardingChildren(id: number): Promise<unknown[]> {
  const res = await apiRequest(`/api/v2/onboarding_requests/${id}/tickets`);
  if (!res.ok) return [];
  const root = asRecord(res.json);
  return asArray(root.tickets || root.onboarding_tickets);
}

// Human: Page journey / onboarding requests. Tries journeys/requests then onboarding_requests.
// Agent: READS those list endpoints. ok is true if any page returned HTTP 2xx.
interface JourneyPage {
  rows: ApiJourney[];
  ok: boolean;
  /** A later page failed, or the scan hit maxPages with a full last page. */
  partial: boolean;
}

async function fetchJourneyPages(path: string, listKey: string, maxPages: number): Promise<JourneyPage> {
  const out: ApiJourney[] = [];
  let ok = false;
  let partial = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await apiRequest(`${path}?per_page=100&page=${page}`);
    if (!res.ok) {
      if (page === 1) return { rows: [], ok: false, partial: false };
      partial = true;
      break;
    }
    ok = true;
    const batch = asArray(asRecord(res.json)[listKey] || asRecord(res.json).requests);
    const rows = batch.map(asApiJourney).filter((j): j is ApiJourney => !!j);
    out.push(...rows);
    if (rows.length < 100) break;
    if (page === maxPages) partial = true;
  }
  return { rows: out, ok, partial };
}

export async function fetchJourneyList(maxPages = 5): Promise<{ rows: ApiJourney[]; ok: boolean; partial: boolean }> {
  const primary = await fetchJourneyPages('/api/v2/journeys/requests', 'journey_requests', maxPages);
  const firstBatch = primary.rows.length;
  if (!shouldFallbackJourneyList(1, primary.ok, firstBatch)) return primary;
  return fetchJourneyPages('/api/v2/onboarding_requests', 'onboarding_requests', maxPages);
}

export async function listJourneys(maxPages = 5): Promise<ApiJourney[]> {
  const { rows } = await fetchJourneyList(maxPages);
  return rows;
}

export function journeyToReportable(
  journey: ApiJourney,
  now: number,
  progress: Progress = { pct: null, done: null, total: null },
  href: string | null = null,
): Reportable {
  const updated = journey.updated_at ? new Date(journey.updated_at) : null;
  const created = journey.created_at ? new Date(journey.created_at) : null;
  const start = startFromCustomFields(journey.initiator_data?.custom_fields) || parseStartDate(journey.title);
  const idleSrc = updated && !Number.isNaN(updated.getTime()) ? updated : created;
  const idleDays = idleSrc && !Number.isNaN(idleSrc.getTime()) ? (now - idleSrc.getTime()) / MS_DAY : null;
  const startIn = start ? (start.getTime() - now) / MS_DAY : null;
  const status = journey.status ? String(journey.status).replace(/_/g, ' ') : '—';
  const title = journey.title || '';
  const createdOk = created && !Number.isNaN(created.getTime()) ? created : null;
  return {
    status,
    idleDays,
    startKey: dateKey(start),
    updatedKey: dateKey(idleSrc && !Number.isNaN(idleSrc.getTime()) ? idleSrc : null),
    startIn,
    progress,
    kind: employeeKind(title),
    href,
    label: sanitizeTitle(title) || `Journey #${journey.display_id || journey.id}`,
    subject: title,
    initiator: journey.initiatorName || '',
    createdDays: ageDays(createdOk, now),
  };
}
