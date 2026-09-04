// Human: Date parsing for Freshservice cell titles and journey "Start DD-MM-YYYY" title fragments.
// Agent: PURE. parseTicketDate is day-first for numeric dates; parseStartDate only matches Start/Starting in the title.

import { MONTHS } from './constants';

export function civilDate(year: number, month1to12: number, day: number): Date | null {
  const y = Number(year);
  const m = Number(month1to12);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  const dt = new Date(y, m - 1, Math.min(d, last));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function dateKey(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  let m = str.match(/(\d{1,2})\s+([A-Za-z]{3})\.?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0));
  }
  m = str.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = +m[1];
    const mo = +m[2];
    return new Date(+m[3], mo - 1, d, +(m[4] || 0), +(m[5] || 0));
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
  m = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    return dateKey(civilDate(+m[3], MONTHS[m[2].toLowerCase()] + 1, +m[1]));
  }
  return dateKey(parseStartDate('Start ' + str));
}
