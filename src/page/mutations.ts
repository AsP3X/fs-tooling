// Human: Decide which MutationObserver records are ours (start column, host) vs Freshservice’s list.
// Agent: PURE. childList-only. Attribute toggles on highlight classes are not observed.

import { HOST_ID } from '../lib/constants';

export function nodeIsOurs(node: Node, host: Element | null): boolean {
  if (host && host.contains(node)) return true;
  if (!(node instanceof Element)) return false;
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
