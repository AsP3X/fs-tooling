import { describe, expect, it } from 'vitest';
import { agentCellUnassigned, parsePriority, priorityLabel } from './ticket-fields';

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
});

describe('priorityLabel', () => {
  it('returns the display name', () => {
    expect(priorityLabel(4)).toBe('Urgent');
    expect(priorityLabel(null)).toBe('—');
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
    expect(agentCellUnassigned('Pat', true)).toBe(false);
  });
});
