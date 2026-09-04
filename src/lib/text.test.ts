import { describe, expect, it } from 'vitest';
import { employeeKind, escapeHtml, fmtDur, hexToRgba, sanitizeTitle } from './text';

describe('text helpers', () => {
  it('escapes HTML', () => {
    expect(escapeHtml(`<a "b" c'>`)).toBe('&lt;a &quot;b&quot; c&#39;&gt;');
  });

  it('reads Internal/External employee kind', () => {
    expect(employeeKind('Foo (Internal employee)')).toBe('Internal');
    expect(employeeKind('Foo (external employee)')).toBe('External');
    expect(employeeKind('Printer jam')).toBe('—');
  });

  it('strips the person name from onboarding titles', () => {
    expect(sanitizeTitle('Employee Onboarding Request - Alex Example - Start 14-09-2026')).toBe(
      'Onboarding · Start 14-09-2026',
    );
  });

  it('formats durations with a unicode minus', () => {
    expect(fmtDur(null)).toBe('—');
    expect(fmtDur(3)).toBe('3.0d');
    expect(fmtDur(-3)).toBe('−3.0d');
    expect(fmtDur(0.5)).toBe('12h');
  });

  it('converts hex to rgba', () => {
    expect(hexToRgba('#e65100', 0.18)).toBe('rgba(230, 81, 0, 0.18)');
  });
});
