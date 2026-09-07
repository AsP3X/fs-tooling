// Human: Ticket priority labels and DOM/API parsers for agent / unassigned.
// Agent: PURE. Freshservice priority ids are 1 Low … 4 Urgent. Missing agent cells stay unknown (null), not unassigned.

export const PRIORITIES = [
  { id: 1, label: 'Low' },
  { id: 2, label: 'Medium' },
  { id: 3, label: 'High' },
  { id: 4, label: 'Urgent' },
] as const;

export type PriorityId = (typeof PRIORITIES)[number]['id'];

export function parsePriority(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    return n >= 1 && n <= 4 ? n : null;
  }
  const s = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return null;
  if (s === '1' || /\blow\b/.test(s)) return 1;
  if (s === '2' || /\bmedium\b/.test(s) || s === 'med') return 2;
  if (s === '3' || /\bhigh\b/.test(s)) return 3;
  if (s === '4' || /\burgent\b/.test(s)) return 4;
  return null;
}

export function priorityLabel(id: number | null | undefined): string {
  const hit = PRIORITIES.find((p) => p.id === id);
  return hit ? hit.label : '—';
}

/**
 * Empty / em-dash / "Unassigned" in a present Agent cell → true.
 * No Agent column at all → null (unknown).
 */
export function agentCellUnassigned(raw: string | null | undefined, cellPresent: boolean): boolean | null {
  if (!cellPresent) return null;
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-' || /^unassigned$/i.test(s)) return true;
  return false;
}
