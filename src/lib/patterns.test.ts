import { describe, expect, it } from 'vitest';
import {
  compileUnicodeRegex,
  DEFAULT_PATTERNS,
  parseStatusAgeLabel,
  patternMatches,
} from './patterns';

describe('compileUnicodeRegex', () => {
  it('adds Unicode + case-insensitive flags', () => {
    const compiled = compileUnicodeRegex('offen');
    expect(compiled?.regex.flags).toContain('i');
    expect(compiled?.regex.flags).toContain('u');
    expect(compiled?.regex.test('OFFEN')).toBe(true);
  });

  it('returns null for empty or invalid source', () => {
    expect(compileUnicodeRegex('')).toBeNull();
    expect(compileUnicodeRegex('   ')).toBeNull();
    expect(compileUnicodeRegex('(unclosed')).toBeNull();
  });
});

describe('default status patterns', () => {
  it('matches Open / Offen and not Pending', () => {
    expect(patternMatches(DEFAULT_PATTERNS.statusOpen, 'Open')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusOpen, 'Offen')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusOpen, 'ouvert')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusOpen, 'Pending')).toBe(false);
    expect(patternMatches(DEFAULT_PATTERNS.statusOpen, 'Reopened')).toBe(false);
  });

  it('matches Pending / Ausstehend', () => {
    expect(patternMatches(DEFAULT_PATTERNS.statusPending, 'Pending')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusPending, 'Ausstehend')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusPending, 'en attente')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusPending, 'Open')).toBe(false);
  });

  it('matches third-party status labels across locales', () => {
    expect(patternMatches(DEFAULT_PATTERNS.statusThirdParty, 'Waiting for third party')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusThirdParty, 'Waiting for 3rd-party')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusThirdParty, 'Warten auf Drittanbieter')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.statusThirdParty, 'Pending')).toBe(false);
    expect(patternMatches(DEFAULT_PATTERNS.statusThirdParty, 'frontiers')).toBe(false);
  });

  it('matches unassigned and escalated stems', () => {
    expect(patternMatches(DEFAULT_PATTERNS.unassigned, 'Unassigned')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.unassigned, 'Nicht zugewiesen')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.escalated, 'Escalated')).toBe(true);
    expect(patternMatches(DEFAULT_PATTERNS.escalated, 'Eskaliert')).toBe(true);
  });

  it('treats an empty pattern as inactive', () => {
    expect(patternMatches('', 'Open')).toBeNull();
    expect(patternMatches(null, 'Open')).toBeNull();
  });
});

describe('parseStatusAgeLabel', () => {
  it('reads English and German status-age triggers', () => {
    expect(parseStatusAgeLabel('Open since 11 days')).toEqual({ status: 'Open', days: 11 });
    expect(parseStatusAgeLabel('Offen seit 11 Tagen')).toEqual({ status: 'Offen', days: 11 });
    expect(parseStatusAgeLabel('Pending depuis 3 jours')).toEqual({ status: 'Pending', days: 3 });
  });

  it('returns null when the label is not a status-age phrase', () => {
    expect(parseStatusAgeLabel('Choose Group and Agent')).toBeNull();
    expect(parseStatusAgeLabel('')).toBeNull();
  });
});
