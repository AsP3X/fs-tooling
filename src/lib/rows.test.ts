import { afterEach, describe, expect, it } from 'vitest';
import { collectRows } from './rows';

const NOW = new Date(2026, 8, 4, 12, 0, 0).getTime();

describe('collectRows', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reads subject, status, dates, progress, and start-from-title', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject">
              <a class="subject-cell" href="/a/tickets/42" title="Employee Onboarding Request - Alex - Start 14-09-2026 (Internal employee)">Onboarding</a>
            </td>
            <td data-name="updated_at_date"><span data-test-id="date-cell" title="01 Sep, 2026, 12:00">1 Sep</span></td>
            <td data-name="created_at_date"><span data-test-id="date-cell" title="20 Aug, 2026, 12:00">20 Aug</span></td>
            <td data-name="status"><span data-test-id="state-cell"><span title="Being Processed">Being Processed</span></span></td>
            <td data-name="initiator"><a>Pat</a></td>
            <td><span class="progress-counts">1 / 4</span></td>
          </tr>
        </tbody>
      </table>
    `;
    const [row] = collectRows(document, NOW);
    expect(row).toBeDefined();
    expect(row.status).toBe('Being Processed');
    expect(row.kind).toBe('Internal');
    expect(row.startKey).toBe('2026-09-14');
    expect(row.updatedKey).toBe('2026-09-01');
    expect(row.progress.pct).toBe(25);
    expect(row.initiator).toBe('Pat');
    expect(row.href).toContain('/a/tickets/42');
    expect(row.label).toContain('Onboarding ·');
    expect(row.idleDays).toBeCloseTo(3, 5);
    expect(row.createdDays).toBeCloseTo(15, 5);
    expect(row.subject).toContain('Internal employee');
  });

  it('reads due date, priority, and unassigned agent', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/7">Hi</a></td>
            <td data-name="created_at_date"><span data-test-id="date-cell" title="20 Aug, 2026, 12:00">20 Aug</span></td>
            <td data-name="due_by"><span data-test-id="date-cell" title="01 Sep, 2026, 12:00">1 Sep</span></td>
            <td data-name="priority"><span title="Urgent">Urgent</span></td>
            <td data-name="responder"></td>
          </tr>
        </tbody>
      </table>
    `;
    const [row] = collectRows(document, NOW);
    expect(row.priority).toBe(4);
    expect(row.unassigned).toBe(true);
    expect(row.dueIn).toBeCloseTo(-3, 0);
  });

  it('reads icon-only and data-value priority cells', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/8">Hi</a></td>
            <td data-name="ticket_priority"><i class="icon-priority-high" aria-label="High"></i></td>
          </tr>
        </tbody>
      </table>
    `;
    expect(collectRows(document, NOW)[0].priority).toBe(3);
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/9">Hi</a></td>
            <td data-name="priority" data-value="4"></td>
          </tr>
        </tbody>
      </table>
    `;
    expect(collectRows(document, NOW)[0].priority).toBe(4);
  });

  it('prefers status-age "since N days" over Updated', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/1">Hi</a></td>
            <td data-name="updated_at_date"><span data-test-id="date-cell" title="01 Sep, 2026, 12:00">1 Sep</span></td>
            <td><button class="status-list-trigger" aria-label="Open since 11 days"></button></td>
          </tr>
        </tbody>
      </table>
    `;
    const [row] = collectRows(document, NOW);
    expect(row.idleDays).toBe(11);
    expect(row.status).toBe('Open');
  });

  it('reads a plain status cell without a title attribute', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/2">Hi</a></td>
            <td data-name="status">Open</td>
          </tr>
        </tbody>
      </table>
    `;
    expect(collectRows(document, NOW)[0].status).toBe('Open');
  });
});
