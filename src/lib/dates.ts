// Human: Date parsing for Freshservice cell titles and journey "Start DD-MM-YYYY" title fragments.
// Agent: PURE. parseTicketDate is day-first for numeric dates; parseStartDate only matches Start/Starting in the title.

import { MONTHS, MS_DAY } from './constants';

// Human: Calendar date in local time. 31 Feb is not a date — do not slide it onto 28 Feb.
// Agent: PURE. RETURNS null when the day is outside that month. Callers must not clamp.
export function civilDate(year: number, month1to12: number, day: number): Date | null {
  const y = Number(year);
  const m = Number(month1to12);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  if (d > last) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Human: Resolve a Freshservice month token. Full names win over a 3-letter slice so "juni" is June and "juli" stays July.
// Agent: READS MONTHS. RETURNS null for an unknown token. PURE.
function monthIndex(token: string): number | null {
  const key = token.toLowerCase().replace(/\./g, '');
  const n = MONTHS[key];
  return n == null ? null : n;
}

function dateWithTime(year: number, month1to12: number, day: number, hour: number, minute: number): Date | null {
  const dt = civilDate(year, month1to12, day);
  if (!dt) return null;
  dt.setHours(hour, minute, 0, 0);
  return dt;
}

export function dateKey(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole days from `from` until `now`. Null when the source date is missing. */
export function ageDays(from: Date | null | undefined, now: number): number | null {
  if (!from || Number.isNaN(from.getTime())) return null;
  return (now - from.getTime()) / MS_DAY;
}

/** Whole days from `now` until `from`. Negative means the date is already past. */
export function daysUntil(from: Date | null | undefined, now: number): number | null {
  if (!from || Number.isNaN(from.getTime())) return null;
  return (from.getTime() - now) / MS_DAY;
}

export function formatStart(key: string | null | undefined): string {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(key || '');
}

export function prettyStart(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function parseTicketDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const str = String(raw).replace(/\s+/g, ' ').trim();
  // Human: 3-letter abbreviations and full names (Juni, Juli, mars, September). A 3-letter cut turned Juni into an unknown token.
  let m = str.match(/(\d{1,2})\s+(\p{L}{3,12})\.?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/u);
  const month = m ? monthIndex(m[2]) : null;
  if (m && month != null) {
    return dateWithTime(+m[3], month + 1, +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  m = str.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return dateWithTime(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  const native = new Date(str.replace(/,/g, ''));
  return Number.isNaN(native.getTime()) ? null : native;
}

export function parseStartDate(title: string | null | undefined): Date | null {
  const s = String(title || '');
  const m = s.match(/Start(?:ing)?\s*:?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/i);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += 2000;
  return civilDate(y, +m[2], +m[1]);
}

export function parseStartInput(raw: string | null | undefined): string | null {
  const str = String(raw || '').replace(/^start(?:ing)?\s*:?\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!str) return null;
  let m = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return dateKey(civilDate(y, +m[2], +m[1]));
  }
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return dateKey(civilDate(+m[1], +m[2], +m[3]));
  m = str.match(/^(\d{1,2})\s+(\p{L}{3,12})\.?\s+(\d{4})$/u);
  const month = m ? monthIndex(m[2]) : null;
  if (m && month != null) {
    return dateKey(civilDate(+m[3], month + 1, +m[1]));
  }
  return dateKey(parseStartDate('Start ' + str));
}
