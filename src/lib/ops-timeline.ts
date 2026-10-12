// Human: Build status dwell from Freshservice ticket activities. Only status labels and times are kept.
// Agent: PURE. CALLS opsStatusLabel. Never stores actor names, emails, or raw activity text.

function opsStatusLabel(raw: unknown): string {
  const s = String(raw || '').trim().slice(0, 40);
  if (!s || /@/.test(s)) return '';
  return s;
}

export interface StatusLogEvent {
  at: number;
  status: string;
}

export interface StatusDwell {
  statusMs: Record<string, number>;
  status: string;
  statusSince: number;
}

/** Pull the resulting status token from an activity sentence. Drops the rest of the line. */
export function statusFromActivity(content: string): string | null {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // Human: Stop at a comma or " and " so "Open and assigned to Jane Doe" does not store the name.
  const match = text.match(/\bstatus\b(?:.{0,80}?)(?:\bas\b|\bto\b)\s+["']?(\p{L}[\p{L}\p{N} /_-]{0,39})/iu);
  if (!match) return null;
  const token = match[1].split(/\s+and\s+|,/i)[0].trim();
  return opsStatusLabel(token);
}

export function parseStatusActivities(json: unknown): StatusLogEvent[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const list = Array.isArray(root.activities)
    ? root.activities
    : Array.isArray(root.ticket_activities)
      ? root.ticket_activities
      : [];
  const out: StatusLogEvent[] = [];
  list.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const at = Date.parse(String(rec.created_at || rec.performed_at || rec.updated_at || ''));
    if (!Number.isFinite(at) || at <= 0) return;
    const bits: unknown[] = [rec.content, rec.description, rec.sub_content, rec.action];
    if (Array.isArray(rec.sub_contents)) bits.push(...rec.sub_contents);
    let status = '';
    bits.forEach((bit) => {
      if (typeof bit !== 'string') return;
      const found = statusFromActivity(bit);
      if (found) status = found;
    });
    if (status) out.push({ at, status });
  });
  return out.sort((a, b) => a.at - b.at);
}

export function dwellFromLog(
  events: StatusLogEvent[],
  createdAt: number | null,
): StatusDwell | null {
  const cleaned = events
    .map((event) => ({ at: event.at, status: opsStatusLabel(event.status) }))
    .filter((event) => event.status && event.at > 0)
    .sort((a, b) => a.at - b.at);
  if (!cleaned.length) return null;
  const statusMs: Record<string, number> = {};
  // Human: The first event is the status the ticket changed TO. Time before that belongs to an earlier status we did not see.
  // Agent: Does not charge createdAt→first event to cleaned[0].status. createdAt is unused on purpose.
  let start = cleaned[0].at;
  let status = cleaned[0].status;
  void createdAt;
  cleaned.forEach((event) => {
    if (event.status.toLowerCase() === status.toLowerCase()) return;
    const dt = Math.max(0, event.at - start);
    statusMs[status] = (statusMs[status] || 0) + dt;
    status = event.status;
    start = event.at;
  });
  return { statusMs, status, statusSince: start };
}

/** Majority responder_id on "my open" tickets. Needs at least two tickets agreeing. */
export function majorityAgentId(ids: number[]): number | null {
  const counts = new Map<number, number>();
  ids.forEach((id) => {
    if (id > 0) counts.set(id, (counts.get(id) || 0) + 1);
  });
  if (!counts.size) return null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [best, n] = ranked[0];
  if (n < 2) return null;
  if (ranked[1] && ranked[1][1] === n) return null;
  return best;
}
