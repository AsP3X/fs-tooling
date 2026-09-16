import { describe, expect, it } from 'vitest';
import { agentCellUnassigned, parsePriority, priorityLabel, priorityMatchFallback } from './ticket-fields';

describe('parsePriority', () => {
  it('maps Freshservice ids and labels', () => {
    expect(parsePriority(4)).toBe(4);
    expect(parsePriority('Urgent')).toBe(4);
    expect(parsePriority('high')).toBe(3);
    expect(parsePriority('Medium')).toBe(2);
    expect(parsePriority('Low')).toBe(1);
    expect(parsePriority('priority-urgent')).toBe(4);
    expect(parsePriority('icon priority_high')).toBe(3);
    expect(parsePriority('nope')).toBeNull();
  });

  it('maps German and other-locale labels', () => {
    expect(parsePriority('Dringend')).toBe(4);
    expect(parsePriority('Hoch')).toBe(3);
    expect(parsePriority('Mittel')).toBe(2);
    expect(parsePriority('Niedrig')).toBe(1);
  });

  it('does not treat stems inside other words as a priority', () => {
    expect(parsePriority('below')).toBeNull();
    expect(parsePriority('highlight')).toBeNull();
    expect(parsePriority('immediate')).toBeNull();
  });
});

describe('priorityLabel', () => {
  it('returns the display name', () => {
    expect(priorityLabel(4)).toBe('Urgent');
    expect(priorityLabel(null)).toBe('—');
  });
});

describe('priorityMatchFallback', () => {
  it('includes English and locale stems for an id', () => {
    expect(priorityMatchFallback(4)).toMatch(/Urgent/i);
    expect(priorityMatchFallback(4)).toMatch(/dringend/i);
    expect(priorityMatchFallback(null)).toBe('');
  });
});

describe('agentCellUnassigned', () => {
  it('treats a missing column as unknown', () => {
    expect(agentCellUnassigned('', false)).toBeNull();
  });

  it('treats empty or Unassigned as unassigned', () => {
    expect(agentCellUnassigned('', true)).toBe(true);
    expect(agentCellUnassigned('—', true)).toBe(true);
    expect(agentCellUnassigned('Unassigned', true)).toBe(true);
    expect(agentCellUnassigned('Nicht zugewiesen', true)).toBe(true);
    expect(agentCellUnassigned('Pat', true)).toBe(false);
  });
});
