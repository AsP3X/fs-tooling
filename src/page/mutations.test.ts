import { afterEach, describe, expect, it } from 'vitest';
import { HOST_ID } from '../lib/constants';
import { mutationIsOurs, rowHrefChanged, shouldIgnoreMutations } from './mutations';

function record(target: Node, added: Node[] = [], removed: Node[] = []): MutationRecord {
  return {
    type: 'childList',
    target,
    addedNodes: added as unknown as NodeList,
    removedNodes: removed as unknown as NodeList,
    attributeName: null,
    attributeNamespace: null,
    nextSibling: null,
    previousSibling: null,
    oldValue: null,
  } as MutationRecord;
}

describe('mutationIsOurs', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('ignores the panel host and start-column nodes', () => {
    const host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
    const td = document.createElement('td');
    td.dataset.sthCol = 'start';
    document.body.appendChild(td);
    const badge = document.createElement('button');
    badge.className = 'sth-range-badge';
    td.appendChild(badge);
    expect(mutationIsOurs(record(host), host)).toBe(true);
    expect(mutationIsOurs(record(td, [badge]), host)).toBe(true);
    expect(mutationIsOurs(record(document.body, [td]), host)).toBe(true);
  });

  it('does not ignore Freshservice row swaps', () => {
    const host = document.createElement('div');
    host.id = HOST_ID;
    const tbody = document.createElement('tbody');
    const row = document.createElement('tr');
    row.className = 'et-tr';
    tbody.appendChild(row);
    expect(mutationIsOurs(record(tbody, [row]), host)).toBe(false);
    expect(shouldIgnoreMutations([record(tbody, [row])], host)).toBe(false);
  });
});

describe('rowHrefChanged', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function attr(target: Node, name: string): MutationRecord {
    return { ...record(target), type: 'attributes', attributeName: name } as MutationRecord;
  }

  it('flags an href swap inside a list-body row (recycled row)', () => {
    document.body.innerHTML = '<table><tbody><tr class="et-tr"><td><a id="a" href="/a/tickets/1">x</a></td></tr></tbody></table><a id="nav" href="/x">n</a>';
    const link = document.getElementById('a') as HTMLElement;
    const nav = document.getElementById('nav') as HTMLElement;
    expect(rowHrefChanged([attr(link, 'href')])).toBe(true);
    expect(rowHrefChanged([attr(link, 'class')])).toBe(false);
    expect(rowHrefChanged([attr(nav, 'href')])).toBe(false);
    const user = document.createElement('a');
    user.setAttribute('href', '/users/9');
    (document.querySelector('tr') as HTMLElement).appendChild(user);
    expect(rowHrefChanged([attr(user, 'href')])).toBe(false);
  });
});
