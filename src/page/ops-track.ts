// Human: Record a ticket-detail visit into the ops ledger. Safe to call on every SPA navigation.
// Agent: CALLS recordVisit on first open / true reopen. CALLS fetchTicketSample (+ activities once) when shouldRefreshOps. Serializes overlapping calls.

import { parseRecordRef } from '../lib/api/ids';
import { fetchTicketSample, fetchTicketStatusLog } from '../lib/api/tickets';
import { OPS_REOPEN_MS, OPS_SAMPLE_MS } from '../lib/constants';
import { applySample, getTicketOps, loadOps, recordVisit, setOpsSelfId } from '../lib/ops';
import { resolveSelfAgentId } from '../lib/self-agent';

function scrapeStatus(doc: Document): string {
  const el = doc.querySelector('[data-test-id="status"], [data-field-name="status"], .ticket-properties [data-name="status"]');
  const text = String(el?.textContent || '').replace(/\s+/g, ' ').trim().split('\n')[0].slice(0, 40);
  if (!text || /@/.test(text)) return '';
  return text;
}

async function sampleTicket(id: number, doc: Document, force: boolean): Promise<void> {
  const ledger = loadOps();
  if (!ledger.selfId) {
    try {
      const self = await resolveSelfAgentId();
      if (self) setOpsSelfId(self);
    } catch { /* ignore */ }
  }
  const row = getTicketOps(id);
  const wantLog = force || !row || Object.keys(row.statusMs).length === 0;
  try {
    const sample = await fetchTicketSample(id);
    const log = wantLog ? await fetchTicketStatusLog(id) : [];
    if (sample) {
      applySample(id, log.length ? { ...sample, statusLog: log } : sample);
      return;
    }
  } catch { /* no key / network */ }
  const status = scrapeStatus(doc);
  if (status) applySample(id, { status });
}

async function trackNow(
  loc: Pick<Location, 'pathname' | 'href'>,
  doc: Document,
  force: boolean,
): Promise<number | null> {
  const ref = parseRecordRef(loc.pathname);
  if (!ref || ref.kind !== 'ticket') return null;
  const now = Date.now();
  const existing = getTicketOps(ref.id);
  const leftAndReturned = !!existing
    && now - existing.lastOpenAt >= OPS_REOPEN_MS
    && now - existing.lastSeenAt >= OPS_REOPEN_MS;
  const needVisit = !existing || leftAndReturned;
  const needSample = force || !existing || now - existing.lastSeenAt >= OPS_SAMPLE_MS;
  if (needVisit) recordVisit(ref.id, now);
  if (needSample) await sampleTicket(ref.id, doc, force);
  return ref.id;
}

let queue: Promise<unknown> = Promise.resolve();

export async function trackCurrentTicket(
  loc: Pick<Location, 'pathname' | 'href'> = location,
  doc: Document = document,
  opts: { force?: boolean } = {},
): Promise<number | null> {
  const run = () => trackNow(loc, doc, !!opts.force);
  const op = queue.then(run, run);
  queue = op.catch(() => null);
  return op;
}
