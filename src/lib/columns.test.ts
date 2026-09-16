import { afterEach, describe, expect, it } from 'vitest';
import {
  missingColumnsForRule,
  missingColumnsMessage,
  visibleColumnNames,
} from './columns';
import type { FilterRule } from './types';

function rule(partial: Partial<FilterRule> & Pick<FilterRule, 'id' | 'name'>): FilterRule {
  return {
    builtin: false,
    enabled: true,
    invert: false,
    color: '#e65100',
    matchMode: 'or',
    criteria: {},
    ...partial,
  };
}

describe('visibleColumnNames', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads data-name from headers and cells regardless of order', () => {
    document.body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th data-name="priority">P</th>
            <th data-name="ticket_subject">S</th>
            <th data-name="status">St</th>
          </tr>
        </thead>
        <tbody>
          <tr class="et-tr"><td data-name="assigned_to"></td></tr>
        </tbody>
      </table>
    `;
    const names = visibleColumnNames(document);
    expect(names.has('priority')).toBe(true);
    expect(names.has('ticket_subject')).toBe(true);
    expect(names.has('status')).toBe(true);
    expect(names.has('assigned_to')).toBe(true);
    expect(names.has('due_by')).toBe(false);
  });

  it('ignores data-name columns on unrelated tables', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th data-name="due_by">Due</th></tr></thead>
      </table>
      <table>
        <thead>
          <tr><th data-name="ticket_subject">S</th><th data-name="status">St</th></tr>
        </thead>
        <tbody>
          <tr class="et-tr"><td data-name="ticket_subject">Hi</td></tr>
        </tbody>
      </table>
    `;
    const names = visibleColumnNames(document);
    expect(names.has('ticket_subject')).toBe(true);
    expect(names.has('due_by')).toBe(false);
  });
});

describe('missingColumnsForRule', () => {
  const visible = new Set(['ticket_subject', 'status', 'updated_at_date']);

  it('warns when an enabled priority filter has no Priority column', () => {
    const missing = missingColumnsForRule(
      rule({ id: 'high', name: 'High', criteria: { priorities: [3] } }),
      visible,
      false,
    );
    expect(missing.map((c) => c.id)).toEqual(['priority']);
  });

  it('warns when a priority regex filter has no Priority column', () => {
    const missing = missingColumnsForRule(
      rule({ id: 'urgent', name: 'Urgent', criteria: { priorityPattern: 'urgent|dringend' } }),
      visible,
      false,
    );
    expect(missing.map((c) => c.id)).toEqual(['priority']);
  });

  it('does not warn when the API can fill the field', () => {
    const missing = missingColumnsForRule(
      rule({ id: 'high', name: 'High', criteria: { priorities: [3] } }),
      visible,
      true,
    );
    expect(missing).toEqual([]);
  });

  it('does not warn for disabled rules or unused dimensions', () => {
    expect(missingColumnsForRule(
      rule({ id: 'high', name: 'High', enabled: false, criteria: { priorities: [3] } }),
      visible,
      false,
    )).toEqual([]);
    expect(missingColumnsForRule(
      rule({ id: 'idle', name: 'Idle', criteria: { idleDays: 6 } }),
      visible,
      false,
    )).toEqual([]);
  });

  it('names hidden columns in the activate warning', () => {
    const missing = missingColumnsForRule(
      rule({ id: 'x', name: 'X', matchMode: 'and', criteria: { dueWithin: 0, unassigned: true } }),
      visible,
      false,
    );
    expect(missingColumnsMessage(missing)).toContain('Due date');
    expect(missingColumnsMessage(missing)).toContain('Agent');
    expect(missingColumnsMessage(missing)).toContain('Customize columns');
  });
});
