import { afterEach, describe, expect, it } from 'vitest';
import { emphasisCell, idleExplainingCell } from './emphasis';

function rowHtml(extra = ''): HTMLTableRowElement {
  document.body.innerHTML = `<table><tbody><tr class="et-tr">
    <td data-name="ticket_subject"><div id="subj">S</div></td>
    <td data-name="updated_at_date"><div id="upd" data-test-id="date-cell" title="1 Jan, 2020">x</div></td>
    <td data-name="status"><div id="st" class="status-list-wrapper">Open</div></td>
    <td data-name="priority" id="prio">Urgent</td>
    ${extra}
  </tr></tbody></table>`;
  return document.querySelector('tr') as HTMLTableRowElement;
}

describe('emphasisCell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers the idle date for idle rules that also check status', () => {
    const tr = rowHtml();
    const idle = document.getElementById('upd');
    expect(emphasisCell(tr, ['idleDays', 'statusPattern'], idle)?.id).toBe('upd');
  });

  it('outlines the status content for status-only rules', () => {
    const tr = rowHtml();
    expect(emphasisCell(tr, ['statusPattern'], document.getElementById('upd'))?.id).toBe('st');
  });

  it('falls back to the td when the cell has no element child', () => {
    const tr = rowHtml();
    expect(emphasisCell(tr, ['priorityPattern'], null)?.id).toBe('prio');
  });

  it('targets the injected Start cell for start-date rules', () => {
    const tr = rowHtml('<td data-sth-col="start"><span id="start">14 Sep</span></td>');
    expect(emphasisCell(tr, ['startWithin'], null)?.id).toBe('start');
  });

  it('returns null when the explaining column is hidden or nothing passed', () => {
    const tr = rowHtml();
    expect(emphasisCell(tr, ['dueWithin'], document.getElementById('upd'))).toBeNull();
    expect(emphasisCell(tr, [], document.getElementById('upd'))).toBeNull();
  });
});

describe('idleExplainingCell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the Status cell when idle came from "since N days" and there is no API data', () => {
    const tr = rowHtml();
    (document.getElementById('st') as HTMLElement).insertAdjacentHTML('beforeend', '<div class="status-list-trigger" aria-label="Open since 9 days"></div>');
    const date = document.getElementById('upd');
    expect(idleExplainingCell(tr, false, date)?.id).toBe('st');
    expect(idleExplainingCell(tr, true, date)?.id).toBe('upd');
  });

  it('keeps the date cell when there is no status age', () => {
    const tr = rowHtml();
    expect(idleExplainingCell(tr, false, document.getElementById('upd'))?.id).toBe('upd');
  });
});
