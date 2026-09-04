// Human: String helpers for titles, HTML, colors, and duration labels.
// Agent: PURE. sanitizeTitle strips person names from onboarding subjects before display/stats labels.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] || c);
}

export function hexToRgba(hex: string | null | undefined, a: number): string {
  const h = String(hex || '#e65100').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${a})`;
}

export function employeeKind(title: string): string {
  const m = String(title || '').match(/\((Internal|External)\s+employee\)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : '—';
}

export function sanitizeTitle(title: string): string {
  return String(title || '')
    .replace(/Employee Onboarding Request\s*-\s*[^-]+-\s*/i, 'Onboarding · ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmtDur(d: number | null | undefined): string {
  if (d == null || !Number.isFinite(d)) return '—';
  if (Math.abs(d) < 1 / 24) return `${Math.max(1, Math.round(Math.abs(d) * 1440))}m`;
  if (Math.abs(d) < 2) {
    const h = Math.abs(d) * 24;
    return `${d < 0 ? '−' : ''}${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
  }
  const v = Math.abs(d);
  return `${d < 0 ? '−' : ''}${v < 10 ? v.toFixed(1) : Math.round(v)}d`;
}
