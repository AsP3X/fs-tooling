import { describe, expect, it } from 'vitest';
import { detectModule } from './detect';

describe('detectModule', () => {
  it('honors an explicit module setting', () => {
    expect(detectModule('tickets')).toBe('tickets');
    expect(detectModule('journeys')).toBe('journeys');
  });

  it('auto-detects journeys from the URL', () => {
    const loc = { pathname: '/a/employee_onboarding', href: 'https://x.freshservice.com/a/employee_onboarding' };
    expect(detectModule('auto', document, loc)).toBe('journeys');
  });

  it('auto-detects journeys from initiator column headers', () => {
    document.body.innerHTML = '<table><thead><tr><th data-name="initiator">Initiator</th></tr></thead></table>';
    const loc = { pathname: '/a/tickets', href: 'https://x.freshservice.com/a/tickets' };
    expect(detectModule('auto', document, loc)).toBe('journeys');
  });

  it('defaults to tickets', () => {
    document.body.innerHTML = '<table><thead><tr><th data-name="subject">Subject</th></tr></thead></table>';
    const loc = { pathname: '/a/tickets', href: 'https://x.freshservice.com/a/tickets' };
    expect(detectModule('auto', document, loc)).toBe('tickets');
  });
});
