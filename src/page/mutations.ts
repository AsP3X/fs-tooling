// Human: Decide which MutationObserver records are ours (start column, host) vs Freshservice’s list.
// Agent: PURE. shouldIgnoreMutations is for the childList observer; rowHrefChanged for the attribute guard.

import { HOST_ID } from '../lib/constants';

export function nodeIsOurs(node: Node, host: Element | null): boolean {
  if (host && host.contains(node)) return true;
  if (!(node instanceof Element)) {
    const parent = node.parentElement;
    return !!parent && nodeIsOurs(parent, host);
  }
  if (node.id === HOST_ID || node.closest(`#${HOST_ID}`)) return true;
  if (node.closest('[data-sth-col]')) return true;
  return node.hasAttribute('data-sth-col');
}

export function mutationIsOurs(m: MutationRecord, host: Element | null): boolean {
  if (nodeIsOurs(m.target, host)) return true;
  const nodes = [...m.addedNodes, ...m.removedNodes];
  return nodes.length > 0 && nodes.every((n) => nodeIsOurs(n, host));
}

export function shouldIgnoreMutations(muts: MutationRecord[], host: Element | null): boolean {
  return muts.length > 0 && muts.every((m) => mutationIsOurs(m, host));
}

// Human: Freshservice recycles <tr> elements; a changed subject-link href means the row now shows
// another ticket even when no nodes were added or removed.
// Agent: PURE over records. RETURNS true for an href attribute change inside a list-body row.
function isSubjectLink(el: Element): boolean {
  if (el.closest('a.subject-cell')) return true;
  const href = el.getAttribute('href') || '';
  return /\/(?:tickets|employee_onboarding|journeys)\//i.test(href);
}

// Human: A requester /users link is not a new ticket. Only the subject link means the row was recycled.
export function rowHrefChanged(muts: MutationRecord[]): boolean {
  return muts.some((m) => m.type === 'attributes'
    && m.attributeName === 'href'
    && m.target instanceof Element
    && !!m.target.closest('tbody tr.et-tr')
    && isSubjectLink(m.target));
}
