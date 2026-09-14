// Human: Ticket priority labels and DOM/API parsers for agent / unassigned.
// Agent: PURE. Freshservice priority ids are 1 Low … 4 Urgent. Missing agent cells stay unknown (null), not unassigned.

import { DEFAULT_PATTERNS, patternMatches, wholeWords } from './patterns';

export const PRIORITIES = [
  { id: 1, label: 'Low' },
  { id: 2, label: 'Medium' },
  { id: 3, label: 'High' },
  { id: 4, label: 'Urgent' },
] as const;

export type PriorityId = (typeof PRIORITIES)[number]['id'];

/** Unicode-aware stems. CSS `priority-N` / numeric ids stay language-independent. */
const PRIORITY_URGENT = new RegExp(wholeWords('urgent|dringend|kritisch|critique|urgente|critica'), 'iu');
const PRIORITY_HIGH = new RegExp(wholeWords('high|hoch|élevé|elevado|alta|alto'), 'iu');
const PRIORITY_MEDIUM = new RegExp(wholeWords('medium|mittel|moyen|media|medio|med'), 'iu');
const PRIORITY_LOW = new RegExp(wholeWords('low|niedrig|gering|faible|baja|basso|baixa'), 'iu');
const PRIORITY_CLASS = /(?:priority|prio)[\s_-]*([1-4])/iu;

export function parsePriority(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw);
    return n >= 1 && n <= 4 ? n : null;
  }
  const s = String(raw || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/^[1-4]$/.test(s)) return Number(s);
  const fromClass = s.match(PRIORITY_CLASS);
  if (fromClass) return Number(fromClass[1]);
  // Urgent before High so a combined label cannot collapse to High.
  if (PRIORITY_URGENT.test(s)) return 4;
  if (PRIORITY_HIGH.test(s)) return 3;
  if (PRIORITY_MEDIUM.test(s)) return 2;
  if (PRIORITY_LOW.test(s)) return 1;
  return null;
}

export function priorityLabel(id: number | null | undefined): string {
  const hit = PRIORITIES.find((p) => p.id === id);
  return hit ? hit.label : '—';
}

/**
 * Empty / em-dash / localized "Unassigned" in a present Agent cell → true.
 * No Agent column at all → null (unknown).
 */
export function agentCellUnassigned(raw: string | null | undefined, cellPresent: boolean): boolean | null {
  if (!cellPresent) return null;
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s || s === '—' || s === '-' || s === '–') return true;
  if (patternMatches(DEFAULT_PATTERNS.unassigned, s) === true) return true;
  return false;
}
