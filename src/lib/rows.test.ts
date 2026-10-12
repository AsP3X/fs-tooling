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
    expect(row.priorityText).toMatch(/Urgent/i);
    expect(row.unassigned).toBe(true);
    expect(row.dueIn).toBeCloseTo(-3, 0);
    expect(row.dueText).toMatch(/Sep/i);
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

  it('reads a start date from the subject aria-label when the visible line is clamped', () => {
    document.body.innerHTML = `
      <table><tbody><tr class="et-tr">
        <td data-name="ticket_subject">
          <a class="subject-cell" href="/a/tickets/8" aria-label="Onboarding Task: Install Laptop - Ada (Werkstudent) - Start 15-09-2026">Onboarding Task: Install Laptop - Ada</a>
        </td>
      </tr></tbody></table>`;
    const [row] = collectRows(document, NOW);
    expect(row.startKey).toBe('2026-09-15');
    expect(row.subject).toContain('Start 15-09-2026');
  });

  it('ignores a status dropdown that only says Select, and does not read the agent dropdown', () => {
    document.body.innerHTML = `
      <table><tbody><tr class="et-tr">
        <td data-name="assigned_to"><div data-ebd-id="x-trigger" aria-label="Choose Group and Agent"></div></td>
        <td data-name="status"><div class="status-list-trigger" aria-label="Select ticket status"></div></td>
        <td data-name="updated_at_date"><span data-test-id="date-cell" title="01 Sep, 2026, 12:00">1 Sep</span></td>
      </tr></tbody></table>`;
    const [row] = collectRows(document, NOW);
    expect(row.idleFromStatus).toBe(false);
    expect(row.idleDays).toBeCloseTo(3, 5);
  });

  it('reads German status-age labels', () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr class="et-tr">
            <td data-name="subject"><a class="subject-cell" href="/a/tickets/3">Hi</a></td>
            <td data-name="updated_at_date"><span data-test-id="date-cell" title="01 Sep, 2026, 12:00">1 Sep</span></td>
            <td><button class="status-list-trigger" aria-label="Offen seit 11 Tagen"></button></td>
          </tr>
        </tbody>
      </table>
    `;
    const [row] = collectRows(document, NOW);
    expect(row.idleDays).toBe(11);
    expect(row.status).toBe('Offen');
  });

  it('reads columns after they are reordered or a due column is omitted', () => {
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
          <tr class="et-tr">
            <td data-name="priority"><span title="Hoch">Hoch</span></td>
            <td data-name="ticket_subject"><a class="subject-cell" href="/a/tickets/4">Hi</a></td>
            <td data-name="status">Offen</td>
          </tr>
        </tbody>
      </table>
    `;
    const [row] = collectRows(document, NOW);
    expect(row.priority).toBe(3);
    expect(row.status).toBe('Offen');
    expect(row.dueIn).toBeNull();
    expect(row.unassigned).toBeNull();
  });
});
