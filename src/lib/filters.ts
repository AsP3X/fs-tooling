// Human: Ordered, colored highlight filters. First enabled match wins. Criteria are registered so new pages/dimensions can plug in.
// Agent: PURE. mergeFilterList READS builtins + stored rules. ruleMatches CALLS registered criterion.evaluate. Empty/unknown criteria are skipped. invert flips a hit after at least one dimension is active.

import { DEFAULT_PATTERNS, patternMatches, patternMatchesField } from './patterns';
import { priorityMatchFallback } from './ticket-fields';
import type { FilterCriteria, FilterRule, Matchable, MatchMode, ModuleId, PageSettings, Preset } from './types';

export type FilterModule = ModuleId | 'global';
export type CriterionGroupId = 'age' | 'status' | 'priority' | 'people' | 'ticket' | 'schedule' | 'text';

export interface CriterionDef {
  id: string;
  modules: FilterModule[];
  group: CriterionGroupId;
  evaluate: (item: Matchable, criteria: FilterCriteria) => boolean | null;
}

export interface FilterPageDef {
  id: ModuleId;
  label: string;
  defaultColor: string;
  builtins: () => FilterRule[];
}

export const CRITERION_GROUPS: Array<{ id: CriterionGroupId; label: string; hint?: string }> = [
  { id: 'age', label: 'Age' },
  { id: 'status', label: 'Status', hint: 'Exact tags still work. A Unicode regex matches German, English, and other locales.' },
  { id: 'priority', label: 'Priority', hint: 'Needs the Priority column on the list, or an API key. Columns can be reordered or hidden.' },
  { id: 'people', label: 'People' },
  { id: 'ticket', label: 'Due & SLA', hint: 'Uses list columns when visible, or the API when a key is saved. Hidden columns warn when you turn the filter on.' },
  { id: 'schedule', label: 'Start & progress' },
  { id: 'text', label: 'Subject', hint: 'Phrase tags or a Unicode regex against the subject.' },
];

const criteria: CriterionDef[] = [];
const pages = new Map<ModuleId, FilterPageDef>();

export function registerCriterion(def: CriterionDef): void {
  const i = criteria.findIndex((c) => c.id === def.id);
  if (i >= 0) criteria[i] = def;
  else criteria.push(def);
}

export function registerFilterPage(def: FilterPageDef): void {
  pages.set(def.id, def);
}

export function filterPages(): FilterPageDef[] {
  return [...pages.values()];
}

export function criteriaFor(moduleId: ModuleId): CriterionDef[] {
  return criteria.filter((c) => c.modules.includes('global') || c.modules.includes(moduleId));
}

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

export function asNumberList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((n) => Number.isFinite(n))
    : [];
}

function asMatchMode(value: unknown): MatchMode {
  return value === 'and' ? 'and' : 'or';
}

/** Inclusive min/max. Swaps inverted bounds. Null/empty bounds skip the dimension. */
export function inBand(value: number | null | undefined, min: unknown, max: unknown): boolean | null {
  let lo = asFiniteNumber(min);
  let hi = asFiniteNumber(max);
  if (lo == null && hi == null) return null;
  if (value == null || !Number.isFinite(value)) return false;
  if (lo != null && hi != null && lo > hi) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  if (lo != null && value < lo) return false;
  if (hi != null && value > hi) return false;
  return true;
}

function textHasPhrase(item: Matchable, phrase: string): boolean {
  const p = phrase.toLowerCase();
  return String(item.subject || '').toLowerCase().includes(p)
    || String(item.label || '').toLowerCase().includes(p);
}

/** True when the editor should treat this dimension as on (badge + open group). */
export function criterionActive(id: string, c: FilterCriteria): boolean {
  switch (id) {
    case 'idleDays': return c.idleDays != null || c.idleDaysMax != null;
    case 'createdDays': return c.createdDays != null || c.createdDaysMax != null;
    case 'statuses': return asStringList(c.statuses).length > 0;
    case 'excludeStatuses': return asStringList(c.excludeStatuses).length > 0;
    case 'kinds': return asStringList(c.kinds).length > 0;
    case 'initiators': return asStringList(c.initiators).length > 0;
    case 'unassigned': return c.unassigned === true;
    case 'unassignedPattern': return String(c.unassignedPattern || '').trim().length > 0;
    case 'priorities': return asNumberList(c.priorities).length > 0;
    case 'priorityPattern': return String(c.priorityPattern || '').trim().length > 0;
    case 'dueWithin': return asFiniteNumber(c.dueWithin) != null;
    case 'duePattern': return String(c.duePattern || '').trim().length > 0;
    case 'escalated': return c.escalated === true;
    case 'escalatedPattern': return String(c.escalatedPattern || '').trim().length > 0;
    case 'startDates': return asStringList(c.startDates).length > 0;
    case 'startWithin': return c.startPassed === true || asFiniteNumber(c.startWithin) != null;
    case 'maxProgress': return asFiniteNumber(c.maxProgress) != null || asFiniteNumber(c.minProgress) != null;
    case 'subjectIncludes': return asStringList(c.subjectIncludes).length > 0;
    case 'statusPattern': return String(c.statusPattern || '').trim().length > 0;
    case 'subjectPattern': return String(c.subjectPattern || '').trim().length > 0;
    default: return false;
  }
}

export function asColor(value: unknown, fallback: string): string {
  const raw = String(value || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return fallback;
}

registerCriterion({
  id: 'idleDays',
  modules: ['tickets', 'journeys'],
  group: 'age',
  evaluate: (item, c) => inBand(item.idleDays, c.idleDays, c.idleDaysMax),
});

registerCriterion({
  id: 'createdDays',
  modules: ['tickets', 'journeys'],
  group: 'age',
  evaluate: (item, c) => inBand(item.createdDays ?? null, c.createdDays, c.createdDaysMax),
});

registerCriterion({
  id: 'statusPattern',
  modules: ['tickets', 'journeys'],
  group: 'status',
  evaluate: (item, c) => patternMatches(c.statusPattern, item.status),
});

registerCriterion({
  id: 'statuses',
  modules: ['tickets', 'journeys'],
  group: 'status',
  evaluate: (item, c) => {
    const tags = asStringList(c.statuses).map((s) => s.toLowerCase());
    if (!tags.length) return null;
    return tags.includes(String(item.status).toLowerCase());
  },
});

registerCriterion({
  id: 'excludeStatuses',
  modules: ['tickets', 'journeys'],
  group: 'status',
  evaluate: (item, c) => {
    const tags = asStringList(c.excludeStatuses).map((s) => s.toLowerCase());
    if (!tags.length) return null;
    return !tags.includes(String(item.status).toLowerCase());
  },
});

registerCriterion({
  id: 'kinds',
  modules: ['journeys'],
  group: 'people',
  evaluate: (item, c) => {
    const tags = asStringList(c.kinds).map((s) => s.toLowerCase());
    if (!tags.length) return null;
    return tags.includes(String(item.kind || '').toLowerCase());
  },
});

registerCriterion({
  id: 'initiators',
  modules: ['tickets', 'journeys'],
  group: 'people',
  evaluate: (item, c) => {
    const tags = asStringList(c.initiators).map((s) => s.toLowerCase());
    if (!tags.length) return null;
    return tags.includes(String(item.initiator || '').toLowerCase());
  },
});

registerCriterion({
  id: 'unassigned',
  modules: ['tickets'],
  group: 'people',
  evaluate: (item, c) => {
    if (c.unassigned !== true) return null;
    return item.unassigned === true;
  },
});

// Human: Identification regex for Agent / Priority / Due / Escalated cells. Empty source is off.
// Agent: CALLS patternMatchesField. Falls back to an English label when API rows have no cell text.
registerCriterion({
  id: 'unassignedPattern',
  modules: ['tickets'],
  group: 'people',
  evaluate: (item, c) => patternMatchesField(
    c.unassignedPattern,
    item.agentText,
    item.unassigned === true ? 'Unassigned' : '',
  ),
});

registerCriterion({
  id: 'priorities',
  modules: ['tickets'],
  group: 'priority',
  evaluate: (item, c) => {
    const ids = asNumberList(c.priorities);
    if (!ids.length) return null;
    return item.priority != null && ids.includes(item.priority);
  },
});

registerCriterion({
  id: 'priorityPattern',
  modules: ['tickets'],
  group: 'priority',
  evaluate: (item, c) => patternMatchesField(
    c.priorityPattern,
    item.priorityText,
    priorityMatchFallback(item.priority),
  ),
});

registerCriterion({
  id: 'dueWithin',
  modules: ['tickets'],
  group: 'ticket',
  evaluate: (item, c) => {
    const within = asFiniteNumber(c.dueWithin);
    if (within == null) return null;
    if (item.dueIn == null) return false;
    if (within <= 0) return item.dueIn < 0;
    return item.dueIn <= within;
  },
});

registerCriterion({
  id: 'duePattern',
  modules: ['tickets'],
  group: 'ticket',
  evaluate: (item, c) => patternMatchesField(c.duePattern, item.dueText),
});

registerCriterion({
  id: 'escalated',
  modules: ['tickets'],
  group: 'ticket',
  evaluate: (item, c) => {
    if (c.escalated !== true) return null;
    return item.escalated === true;
  },
});

registerCriterion({
  id: 'escalatedPattern',
  modules: ['tickets'],
  group: 'ticket',
  evaluate: (item, c) => patternMatchesField(
    c.escalatedPattern,
    item.escalatedText,
    item.escalated === true ? 'Escalated' : '',
  ),
});

registerCriterion({
  id: 'startDates',
  modules: ['journeys'],
  group: 'schedule',
  evaluate: (item, c) => {
    const tags = asStringList(c.startDates);
    if (!tags.length) return null;
    return !!(item.startKey && tags.includes(item.startKey));
  },
});

registerCriterion({
  id: 'startWithin',
  modules: ['journeys'],
  group: 'schedule',
  // Human: "Started" is any start date already reached. "Nd" is the next N days, not every journey that started last year.
  // Agent: startPassed short-circuits and clears the window. A negative startIn fails the Nd check. PURE.
  evaluate: (item, c) => {
    if (c.startPassed === true) return item.startIn != null && item.startIn <= 0;
    const within = asFiniteNumber(c.startWithin);
    if (within == null) return null;
    return item.startIn != null && item.startIn >= 0 && item.startIn <= within;
  },
});

registerCriterion({
  id: 'maxProgress',
  modules: ['journeys'],
  group: 'schedule',
  evaluate: (item, c) => inBand(item.progress.pct, c.minProgress, c.maxProgress),
});

registerCriterion({
  id: 'subjectIncludes',
  modules: ['tickets', 'journeys'],
  group: 'text',
  evaluate: (item, c) => {
    const phrases = asStringList(c.subjectIncludes).map((s) => s.toLowerCase());
    if (!phrases.length) return null;
    return phrases.some((p) => textHasPhrase(item, p));
  },
});

registerCriterion({
  id: 'subjectPattern',
  modules: ['tickets', 'journeys'],
  group: 'text',
  evaluate: (item, c) => {
    const src = String(c.subjectPattern || '').trim();
    if (!src) return null;
    // Test fields separately so ^ / $ anchors still work (do not join with a newline).
    return patternMatches(src, item.subject) === true || patternMatches(src, item.label) === true;
  },
});

function makeRule(partial: Omit<FilterRule, 'builtin' | 'enabled' | 'invert'> & {
  builtin?: boolean;
  enabled?: boolean;
  invert?: boolean;
}): FilterRule {
  return {
    builtin: false,
    enabled: false,
    ...partial,
    invert: partial.invert === true,
    matchMode: asMatchMode(partial.matchMode),
    color: asColor(partial.color, '#e65100'),
    criteria: { ...(partial.criteria || {}) },
  };
}

registerFilterPage({
  id: 'tickets',
  label: 'Tickets',
  defaultColor: '#e65100',
  builtins: () => [
    // Human: Structured field (id/flag/date) OR locale regex so the identification pattern is editable in Manage.
    // Agent: WRITES both the structured criterion and the matching DEFAULT_PATTERNS.* source. matchMode stays 'or'.
    makeRule({
      id: 'urgent', name: 'Urgent', builtin: true, color: '#c62828', matchMode: 'or',
      criteria: { priorities: [4], priorityPattern: DEFAULT_PATTERNS.priorityUrgent },
    }),
    makeRule({
      id: 'escalated', name: 'Escalated', builtin: true, color: '#e65100', matchMode: 'or',
      criteria: { escalated: true, escalatedPattern: DEFAULT_PATTERNS.escalated },
    }),
    makeRule({
      id: 'overdue', name: 'Overdue', builtin: true, color: '#c62828', matchMode: 'or',
      criteria: { dueWithin: 0, duePattern: DEFAULT_PATTERNS.overdue },
    }),
    makeRule({
      id: 'unassigned', name: 'Unassigned', builtin: true, color: '#6a1b9a', matchMode: 'or',
      criteria: { unassigned: true, unassignedPattern: DEFAULT_PATTERNS.unassigned },
    }),
    makeRule({
      id: 'high', name: 'High', builtin: true, color: '#e65100', matchMode: 'or',
      criteria: { priorities: [3], priorityPattern: DEFAULT_PATTERNS.priorityHigh },
    }),
    // Human: Idle 6d is Open (locale regex) AND idle ≥6d. Sits above Open so stale Open is not swallowed.
    // Agent: WRITES statusPattern from DEFAULT_PATTERNS.statusOpen. matchMode must stay 'and'.
    makeRule({
      id: 'idle-6', name: 'Idle 6d', builtin: true, enabled: true, color: '#e65100', matchMode: 'and',
      criteria: { idleDays: 6, statusPattern: DEFAULT_PATTERNS.statusOpen },
    }),
    makeRule({
      id: 'open-idle', name: 'Open', builtin: true, color: '#c62828', matchMode: 'or',
      criteria: { statusPattern: DEFAULT_PATTERNS.statusOpen },
    }),
    makeRule({
      id: 'w3p', name: '3rd party', builtin: true, color: '#1565c0', matchMode: 'and',
      criteria: { idleDays: 3, statusPattern: DEFAULT_PATTERNS.statusThirdParty },
    }),
    makeRule({
      id: 'pending-3', name: 'Pending 3d', builtin: true, color: '#6a1b9a', matchMode: 'and',
      criteria: { idleDays: 3, statusPattern: DEFAULT_PATTERNS.statusPending },
    }),
  ],
});

registerFilterPage({
  id: 'journeys',
  label: 'Journeys',
  defaultColor: '#1565c0',
  builtins: () => [
    makeRule({
      id: 'started', name: 'Started', builtin: true, color: '#2e7d32', matchMode: 'or',
      criteria: { startPassed: true },
    }),
    // Human: "Start ≤7d" is the upcoming window only. Idle ≥1 with Any matched almost every journey.
    // Agent: matchMode is unused while a single dimension is set. startWithin itself requires 0..N days.
    makeRule({
      id: 'start-soon', name: 'Start ≤7d', builtin: true, color: '#2e7d32', matchMode: 'and',
      criteria: { startWithin: 7 },
    }),
    // Human: Low progress is idle ≥7 AND progress ≤40. Any made a finished 7-day journey match.
    makeRule({
      id: 'low-prog', name: 'Low progress', builtin: true, color: '#c62828', matchMode: 'and',
      criteria: { idleDays: 7, maxProgress: 40 },
    }),
    makeRule({
      id: 'internal', name: 'Internal', builtin: true, color: '#1565c0', matchMode: 'or',
      criteria: { kinds: ['Internal'] },
    }),
    makeRule({
      id: 'await-3', name: 'Awaiting 3d', builtin: true, color: '#e65100', matchMode: 'and',
      criteria: { idleDays: 3, statusPattern: DEFAULT_PATTERNS.statusAwaitingInfo },
    }),
    makeRule({
      id: 'proc-14', name: 'Processing 14d', builtin: true, color: '#6a1b9a', matchMode: 'and',
      criteria: { idleDays: 14, statusPattern: DEFAULT_PATTERNS.statusBeingProcessed },
    }),
    makeRule({
      id: 'idle-7', name: 'Idle 7d', builtin: true, enabled: true, color: '#1565c0', matchMode: 'or',
      criteria: { idleDays: 7 },
    }),
  ],
});

export function builtinFilters(moduleId: ModuleId): FilterRule[] {
  return (pages.get(moduleId)?.builtins() || []).map((r) => ({ ...r, criteria: { ...r.criteria } }));
}

export function pageDefaultColor(moduleId: ModuleId): string {
  return pages.get(moduleId)?.defaultColor || '#e65100';
}

export type FilterPatternField =
  | 'statusPattern'
  | 'priorityPattern'
  | 'unassignedPattern'
  | 'escalatedPattern'
  | 'duePattern';

export interface FilterPatternSpec {
  field: FilterPatternField;
  source: string;
  label: string;
  hint: string;
  group: CriterionGroupId;
}

const PATTERN_HINT =
  'Prefilled for defaults. Unicode, case-insensitive. Tweaking a default saves a restorable copy. Empty turns this dimension off.';

const BUILTIN_FIELD_PATTERNS: Record<string, FilterPatternSpec> = {
  'open-idle': { field: 'statusPattern', source: DEFAULT_PATTERNS.statusOpen, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  'idle-6': { field: 'statusPattern', source: DEFAULT_PATTERNS.statusOpen, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  'pending-3': { field: 'statusPattern', source: DEFAULT_PATTERNS.statusPending, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  w3p: { field: 'statusPattern', source: DEFAULT_PATTERNS.statusThirdParty, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  'await-3': { field: 'statusPattern', source: DEFAULT_PATTERNS.statusAwaitingInfo, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  'proc-14': { field: 'statusPattern', source: DEFAULT_PATTERNS.statusBeingProcessed, label: 'Status regex', hint: PATTERN_HINT, group: 'status' },
  urgent: { field: 'priorityPattern', source: DEFAULT_PATTERNS.priorityUrgent, label: 'Priority regex', hint: PATTERN_HINT, group: 'priority' },
  high: { field: 'priorityPattern', source: DEFAULT_PATTERNS.priorityHigh, label: 'Priority regex', hint: PATTERN_HINT, group: 'priority' },
  unassigned: { field: 'unassignedPattern', source: DEFAULT_PATTERNS.unassigned, label: 'Unassigned regex', hint: PATTERN_HINT, group: 'people' },
  escalated: { field: 'escalatedPattern', source: DEFAULT_PATTERNS.escalated, label: 'Escalated regex', hint: PATTERN_HINT, group: 'ticket' },
  overdue: { field: 'duePattern', source: DEFAULT_PATTERNS.overdue, label: 'Overdue regex', hint: PATTERN_HINT, group: 'ticket' },
};

/** Stock identification regex for a builtin or a fork of one. Null when the rule has no stock pattern. */
// Agent: READS BUILTIN_FIELD_PATTERNS by builtin id or sourceId.
export function builtinFilterPattern(rule: FilterRule): FilterPatternSpec | null {
  const id = rule.builtin ? rule.id : (rule.sourceId || '');
  return BUILTIN_FIELD_PATTERNS[id] || null;
}

/** Which criteria key the top regex editor writes. Custom rules default to status. */
export function primaryPatternField(rule: FilterRule): FilterPatternField {
  return builtinFilterPattern(rule)?.field || 'statusPattern';
}

/** Editor value: stored pattern, else the stock regex on an untouched default. Cleared forks stay empty. */
// Agent: READS rule.criteria[field]. RETURNS '' on a cleared fork so we do not refill.
export function prefilledFilterPattern(rule: FilterRule): string {
  const spec = builtinFilterPattern(rule);
  const field = spec?.field || 'statusPattern';
  const own = String(rule.criteria?.[field] || '').trim();
  if (own) return own;
  if (!rule.builtin) return '';
  return spec?.source || '';
}

export function builtinStatusPattern(rule: FilterRule): string | null {
  const spec = builtinFilterPattern(rule);
  return spec?.source || null;
}

export function prefilledStatusPattern(rule: FilterRule): string {
  return prefilledFilterPattern(rule);
}

/** First enabled match wins — Idle 6d (Open AND stale) sits above Open so it is not swallowed. */
export const CANONICAL_TICKET_FILTERS = [
  'urgent', 'escalated', 'overdue', 'unassigned', 'high',
  'idle-6', 'open-idle', 'w3p', 'pending-3',
] as const;

export const CANONICAL_JOURNEY_FILTERS = [
  'started', 'start-soon', 'low-prog', 'internal', 'await-3', 'proc-14', 'idle-7',
] as const;

const LEGACY_TICKET_FILTERS = [
  'idle-6', 'open-idle', 'pending-3', 'w3p', 'overdue', 'unassigned', 'high', 'urgent', 'escalated',
] as const;

/** Previous canonical: Open above Idle 6d, which swallowed stale Open once Idle required Open. */
const PREV_CANONICAL_TICKET_FILTERS = [
  'urgent', 'escalated', 'overdue', 'unassigned', 'high',
  'open-idle', 'w3p', 'pending-3', 'idle-6',
] as const;

const LEGACY_JOURNEY_FILTERS = [
  'idle-7', 'await-3', 'proc-14', 'low-prog', 'start-soon', 'internal', 'started',
] as const;

function sameIdSeq(ids: string[], expected: readonly string[]): boolean {
  return ids.length === expected.length && ids.every((id, i) => id === expected[i]);
}

/** Reorder a known all-default list to canonical importance. Custom order is left alone. */
// Agent: READS LEGACY_* and PREV_CANONICAL_TICKET_FILTERS. RETURNS list unchanged when a custom rule is present.
export function applyCanonicalFilterOrder(list: FilterRule[], moduleId: ModuleId): FilterRule[] {
  if (list.some((r) => !r.builtin)) return list;
  const canonical = moduleId === 'journeys' ? CANONICAL_JOURNEY_FILTERS : CANONICAL_TICKET_FILTERS;
  const legacy = moduleId === 'journeys' ? LEGACY_JOURNEY_FILTERS : LEGACY_TICKET_FILTERS;
  const ids = list.map((r) => r.id);
  if (sameIdSeq(ids, canonical)) return list;
  const prior = moduleId === 'journeys'
    ? [legacy]
    : [legacy, PREV_CANONICAL_TICKET_FILTERS];
  if (!prior.some((seq) => sameIdSeq(ids, seq))) return list;
  const byId = new Map(list.map((r) => [r.id, r]));
  return canonical.map((id) => byId.get(id)).filter((r): r is FilterRule => !!r);
}

export function ruleMatches(
  item: Matchable,
  rule: FilterRule,
  moduleId: ModuleId,
  specs: CriterionDef[] = criteriaFor(moduleId),
): boolean {
  const bag = rule.criteria || {};
  const andMode = rule.matchMode === 'and';
  let active = false;
  let matched = andMode;
  for (let i = 0; i < specs.length; i += 1) {
    // Exclude is a hard cut, not an Any dimension (OR + "not Closed" would mark almost everything).
    if (specs[i].id === 'excludeStatuses') continue;
    const result = specs[i].evaluate(item, bag);
    if (result == null) continue;
    active = true;
    if (andMode) {
      if (!result) {
        matched = false;
        break;
      }
    } else if (result) {
      matched = true;
      break;
    }
  }
  const excluded = asStringList(bag.excludeStatuses).map((s) => s.toLowerCase());
  if (excluded.length) {
    const allowed = !excluded.includes(String(item.status).toLowerCase());
    if (!active) {
      active = true;
      matched = allowed;
    } else {
      matched = matched && allowed;
    }
  }
  if (!active) return false;
  return rule.invert ? !matched : matched;
}

// Human: Which criteria of a matched rule actually hold for this row, so the page can emphasise the
// cell that explains the highlight (Priority for "Urgent", Updated for "Idle", …).
// Agent: PURE. RETURNS criterion ids whose evaluate() is true, in registry order. Empty for inverted
// rules (the row is painted because the rule failed, so no cell explains it) and for exclude-only rules.
export function passingCriteria(
  item: Matchable,
  rule: FilterRule,
  moduleId: ModuleId,
  specs: CriterionDef[] = criteriaFor(moduleId),
): string[] {
  if (rule.invert) return [];
  const bag = rule.criteria || {};
  const ids: string[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    if (specs[i].id === 'excludeStatuses') continue;
    if (specs[i].evaluate(item, bag) === true) ids.push(specs[i].id);
  }
  return ids;
}

export function enabledFilters(page: PageSettings): FilterRule[] {
  return (page.filters || []).filter((f) => f && f.enabled);
}

/** Walk enabled rules in list order. First match wins (color + mark). */
export function firstMatchingFilter(item: Matchable, page: PageSettings, moduleId: ModuleId): FilterRule | null {
  const specs = criteriaFor(moduleId);
  const rules = page.filters || [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule?.enabled) continue;
    if (ruleMatches(item, rule, moduleId, specs)) return rule;
  }
  return null;
}

export function accentColor(page: PageSettings, moduleId: ModuleId): string {
  const on = enabledFilters(page)[0];
  return on ? asColor(on.color, pageDefaultColor(moduleId)) : asColor(page.color, pageDefaultColor(moduleId));
}

function normalizeRule(raw: unknown, fallbackColor: string): FilterRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id || '').trim();
  const name = String(rec.name || '').trim();
  if (!id || !name) return null;
  const criteriaRaw = rec.criteria && typeof rec.criteria === 'object' ? rec.criteria as FilterCriteria : {};
  return {
    id,
    name: name.slice(0, 40),
    builtin: rec.builtin === true,
    enabled: rec.enabled === true,
    invert: rec.invert === true,
    color: asColor(rec.color, fallbackColor),
    matchMode: asMatchMode(rec.matchMode),
    criteria: { ...criteriaRaw },
    sourceId: typeof rec.sourceId === 'string' && rec.sourceId.trim() ? rec.sourceId.trim() : null,
  };
}

function presetToRule(preset: Preset, color: string): FilterRule {
  return makeRule({
    id: preset.id,
    name: preset.name,
    color,
    matchMode: preset.matchMode,
    enabled: false,
    criteria: {
      idleDays: preset.days,
      statuses: [...(preset.statuses || [])],
      startDates: [...(preset.startDates || [])],
      maxProgress: preset.maxProgress ?? null,
      startWithin: preset.startWithin ?? null,
    },
  });
}

function liveToRule(page: PageSettings, color: string): FilterRule {
  return makeRule({
    id: 'migrated-live',
    name: 'My filter',
    color,
    matchMode: page.matchMode,
    enabled: true,
    criteria: {
      idleDays: page.days,
      statuses: [...(page.statuses || [])],
      startDates: [...(page.startDates || [])],
      maxProgress: page.maxProgress,
      startWithin: page.startWithin,
    },
  });
}

function criteriaEqual(a: FilterCriteria, b: FilterCriteria): boolean {
  return JSON.stringify({
    idleDays: a.idleDays ?? null,
    statuses: asStringList(a.statuses),
    startDates: asStringList(a.startDates),
    maxProgress: a.maxProgress ?? null,
    startWithin: a.startWithin ?? null,
  }) === JSON.stringify({
    idleDays: b.idleDays ?? null,
    statuses: asStringList(b.statuses),
    startDates: asStringList(b.startDates),
    maxProgress: b.maxProgress ?? null,
    startWithin: b.startWithin ?? null,
  });
}

function defaultIdleId(moduleId: ModuleId): string {
  return moduleId === 'journeys' ? 'idle-7' : 'idle-6';
}

/**
 * Merge code builtins with stored rules. A custom fork (sourceId) occupies that default's slot.
 * Empty stored lists migrate from presets / the previous live recipe.
 */
export function mergeFilterList(page: PageSettings, moduleId: ModuleId): FilterRule[] {
  const fallback = pageDefaultColor(moduleId);
  const builtins = builtinFilters(moduleId);
  const stored = (page.filters || []).map((r) => normalizeRule(r, fallback)).filter((r): r is FilterRule => !!r);

  if (!stored.length) {
    const list = builtins.map((b) => ({ ...b, enabled: b.id === defaultIdleId(moduleId) }));
    (page.presets || []).forEach((preset) => {
      if (list.some((r) => r.id === preset.id)) return;
      list.push(presetToRule(preset, fallback));
    });
    if (page.activePreset && list.some((r) => r.id === page.activePreset)) {
      list.forEach((r) => { r.enabled = r.id === page.activePreset; });
    } else {
      const live = liveToRule(page, page.color || fallback);
      const idle = list.find((r) => r.id === defaultIdleId(moduleId));
      if (idle && !criteriaEqual(live.criteria, idle.criteria)) {
        list.forEach((r) => { r.enabled = false; });
        list.push(live);
      } else if (idle && page.matchMode === 'and' && !(page.statuses || []).length && (page.days || 0) > 0) {
        // Human: A saved "idle N days, any status" recipe must not become Idle 6d, which also requires Open.
        // Agent: criteriaEqual ignores statusPattern, so this AND + empty-tag shape looked like the builtin. WRITES a custom rule.
        list.forEach((r) => { r.enabled = false; });
        list.push(live);
      } else if (idle && page.color && asColor(page.color, idle.color) !== idle.color) {
        idle.color = asColor(page.color, idle.color);
      }
    }
    return applyCanonicalFilterOrder(list, moduleId);
  }

  const out: FilterRule[] = [];
  const seen = new Set<string>();
  const forked = new Set<string>();
  stored.forEach((row) => {
    if (row.sourceId) forked.add(row.sourceId);
    const builtin = builtins.find((b) => b.id === row.id);
    if (builtin) {
      out.push({
        ...builtin,
        enabled: row.enabled,
        color: asColor(row.color, builtin.color),
      });
    } else {
      out.push({ ...row, builtin: false });
    }
    seen.add(row.id);
  });
  builtins.forEach((b) => {
    if (seen.has(b.id) || forked.has(b.id)) return;
    out.push(b);
  });
  return applyCanonicalFilterOrder(out, moduleId);
}

/** First save of a default creates a custom copy in the same slot. */
export function forkFromBuiltin(rule: FilterRule): FilterRule {
  const sourceId = rule.builtin ? rule.id : (rule.sourceId || null);
  return {
    ...rule,
    id: newFilterId(),
    builtin: false,
    sourceId,
    criteria: { ...rule.criteria },
  };
}

export function restoreFromSource(rule: FilterRule, moduleId: ModuleId): FilterRule | null {
  const srcId = rule.sourceId;
  if (!srcId) return null;
  const src = builtinFilters(moduleId).find((b) => b.id === srcId);
  if (!src) return null;
  return { ...src, enabled: rule.enabled };
}

export function isForkOfDefault(rule: FilterRule): boolean {
  return !rule.builtin && !!rule.sourceId;
}

export function moveFilter(list: FilterRule[], id: string, dir: -1 | 1): FilterRule[] {
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(i, 1);
  next.splice(j, 0, row);
  return next;
}

let filterSeq = 0;
export function newFilterId(): string {
  filterSeq += 1;
  return `f-${Date.now().toString(36)}-${filterSeq.toString(36)}`;
}

export function blankFilter(moduleId: ModuleId): FilterRule {
  const color = pageDefaultColor(moduleId);
  return makeRule({
    id: newFilterId(),
    name: 'New filter',
    color,
    matchMode: 'or',
    enabled: true,
    criteria: { idleDays: moduleId === 'journeys' ? 7 : 6 },
  });
}

export function duplicateFilter(rule: FilterRule): FilterRule {
  return {
    ...rule,
    id: newFilterId(),
    name: `${rule.name} copy`.slice(0, 40),
    builtin: false,
    enabled: true,
    invert: rule.invert === true,
    sourceId: rule.builtin ? rule.id : (rule.sourceId || null),
    criteria: { ...rule.criteria },
  };
}
