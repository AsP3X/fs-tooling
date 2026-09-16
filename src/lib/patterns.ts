// Human: Unicode regex helpers and default highlight patterns. Flags are always `iu` (case-insensitive, Unicode).
// Agent: PURE. compileUnicodeRegex never throws. Defaults use \p{L}/\p{N} edges instead of ASCII \b so DE/EN/other locales match.

/**
 * Industry-standard Unicode word edges. JS `\b` is ASCII-only even with the `u` flag.
 * Lookbehind/ahead on letters, marks, and digits so "Offen" and "Open" both count as whole words.
 */
export const UNICODE_WORD_START = String.raw`(?<![\p{L}\p{M}\p{N}_])`;
export const UNICODE_WORD_END = String.raw`(?![\p{L}\p{M}\p{N}_])`;

/** Wrap an alternation so it cannot match inside a longer token. */
export function wholeWords(alternation: string): string {
  return `${UNICODE_WORD_START}(?:${alternation})${UNICODE_WORD_END}`;
}

/** Flexible separators between words in a status phrase (space, punct). */
const SEP = String.raw`[\s._-]+`;

/** Locale stems for Freshservice priority ids 1–4. Shared by parsePriority and filter regex. */
export const PRIORITY_STEMS: Record<1 | 2 | 3 | 4, string> = {
  1: 'low|niedrig|gering|faible|baja|basso|baixa',
  2: 'medium|mittel|moyen|media|medio|med',
  3: 'high|hoch|élevé|elevado|alta|alto',
  4: 'urgent|dringend|kritisch|critique|urgente|critica',
};

/** Words a priority-id mapping tests a user regex against (API query). */
// Agent: READS PRIORITY_STEMS. RETURNS space-separated stems for regex.test haystacks.
export function priorityLocaleHaystack(id: number): string {
  const stems = PRIORITY_STEMS[id as 1 | 2 | 3 | 4];
  return stems ? stems.replace(/\|/g, ' ') : '';
}

/**
 * Default patterns for ticket highlight filters and field identification.
 * Stems cover German, English, and other common Freshservice locales without depending on one UI language.
 */
export const DEFAULT_PATTERNS = {
  statusOpen: wholeWords('open|offen|ouvert|abierto|aperto|aberto|openstaand|öppen|åben|otwarte|åpen'),
  statusPending: wholeWords(`pending|ausstehend|pendiente|pendente|wachtend|väntande|en${SEP}attente|in${SEP}attesa`),
  statusThirdParty: `(?:third${SEP}party|3rd${SEP}party|dritt(?:anbieter|partei)|${wholeWords('tiers')}|tercer(?:a|os?)?|terceir\\p{L}*)`,
  statusAwaitingInfo: `(?:awaiting${SEP}information|warten${SEP}auf${SEP}informationen|en${SEP}attente${SEP}d['’]?information\\p{L}*)`,
  statusBeingProcessed: `(?:being${SEP}processed|in${SEP}bearbeitung|wird${SEP}bearbeitet|en${SEP}cours|en${SEP}proceso|in${SEP}elaborazione)`,
  unassigned: wholeWords(`unassigned|nicht${SEP}zugewiesen|nicht${SEP}zugeteilt|unzugeordnet|non${SEP}assign[eé]|sin${SEP}asignar|non${SEP}assegnat[oa]`),
  escalated: '(?:escalat|eskaliert|escalad)',
  priorityLow: wholeWords(PRIORITY_STEMS[1]),
  priorityMedium: wholeWords(PRIORITY_STEMS[2]),
  priorityHigh: wholeWords(PRIORITY_STEMS[3]),
  priorityUrgent: wholeWords(PRIORITY_STEMS[4]),
  overdue: wholeWords(`overdue|überfällig|ueberfaellig|en${SEP}retard|atrasad[oa]|vencid[oa]|scadut[oa]|in${SEP}ritardo|achterstallig|förfallen|försenad`),
} as const;

export type DefaultPatternId = keyof typeof DEFAULT_PATTERNS;

const STATUS_AGE_RE = new RegExp(
  String.raw`^(.*?)\s+(?:since|seit|depuis|desde|da)\s+(\p{N}+)\s+(?:days?|tagen?|tag|jours?|jour|d[íi]as?|giorni)\s*$`,
  'iu',
);

export interface CompiledPattern {
  source: string;
  regex: RegExp;
}

/** Compile a user or default pattern. Always `iu`. Invalid source → null (callers skip the dimension). */
export function compileUnicodeRegex(source: string | null | undefined): CompiledPattern | null {
  const trimmed = String(source || '').trim();
  if (!trimmed) return null;
  try {
    return { source: trimmed, regex: new RegExp(trimmed, 'iu') };
  } catch {
    return null;
  }
}

/**
 * null = no pattern (dimension off).
 * false = pattern is invalid or does not match.
 * true = match.
 */
export function patternMatches(source: string | null | undefined, text: string | null | undefined): boolean | null {
  const trimmed = String(source || '').trim();
  if (!trimmed) return null;
  const compiled = compileUnicodeRegex(trimmed);
  if (!compiled) return false;
  compiled.regex.lastIndex = 0;
  return compiled.regex.test(String(text || ''));
}

/**
 * Match identification regex against scraped cell text and/or a structured fallback label.
 * Raw "4" must not hide fallback "Urgent". Empty pattern → dimension off (null).
 * Agent: CALLS patternMatches on raw then fallback. RETURNS true if either hits.
 */
export function patternMatchesField(
  source: string | null | undefined,
  raw: string | null | undefined,
  fallback?: string | null,
): boolean | null {
  const trimmed = String(source || '').trim();
  if (!trimmed) return null;
  const rawText = String(raw || '').replace(/\s+/g, ' ').trim();
  if (rawText && patternMatches(trimmed, rawText) === true) return true;
  const fallbackText = String(fallback || '').replace(/\s+/g, ' ').trim();
  if (fallbackText && patternMatches(trimmed, fallbackText) === true) return true;
  return false;
}

/** Status-trigger labels like "Open since 11 days" / "Offen seit 11 Tagen". */
export function parseStatusAgeLabel(raw: string | null | undefined): { status: string; days: number } | null {
  const label = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!label) return null;
  const m = label.match(STATUS_AGE_RE);
  if (!m) return null;
  const days = Number(m[2]);
  if (!Number.isFinite(days)) return null;
  const status = String(m[1] || '').replace(/\s+/g, ' ').trim();
  return { status, days };
}

export function defaultPattern(id: DefaultPatternId): string {
  return DEFAULT_PATTERNS[id];
}
