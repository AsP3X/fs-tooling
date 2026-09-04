import { describe, expect, it } from 'vitest';
import { contextLabel, detectContext, detectSurface } from './context';

describe('detectSurface', () => {
  it('treats a ticket table as a list', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr"></tr></tbody></table>';
    expect(detectSurface(document, { pathname: '/a/tickets', href: 'https://x.freshservice.com/a/tickets' })).toBe('list');
  });

  it('treats a numeric ticket URL without a table as detail', () => {
    document.body.innerHTML = '<div></div>';
    expect(detectSurface(document, { pathname: '/a/tickets/42', href: 'https://x.freshservice.com/a/tickets/42' })).toBe('detail');
  });

  it('treats a dashboard as other', () => {
    document.body.innerHTML = '<div></div>';
    expect(detectSurface(document, { pathname: '/a/dashboard', href: 'https://x.freshservice.com/a/dashboard' })).toBe('other');
  });
});

describe('detectContext', () => {
  it('combines module + surface', () => {
    document.body.innerHTML = '<table><thead><tr><th data-name="initiator"></th></tr></thead><tbody><tr class="et-tr"></tr></tbody></table>';
    const ctx = detectContext('auto', document, { pathname: '/a/tickets', href: 'https://x.freshservice.com/a/tickets' });
    expect(ctx.module).toBe('journeys');
    expect(ctx.surface).toBe('list');
  });
});

describe('contextLabel', () => {
  it('keeps list titles', () => {
    expect(contextLabel({ module: 'tickets', surface: 'list', path: '/a/tickets' }).title).toBe('Tickets');
  });
});
