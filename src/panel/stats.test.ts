// Human: Statistics side panel. Labels must say what the number is.
// Agent: Renders the overview into a bare shadow root. The ops ledger is empty, so only labels are checked.

import { describe, expect, it, vi } from 'vitest';

// Agent: Node 25 exposes a throwing global localStorage that shadows jsdom's; the ledger only needs memory here.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

import { initStats } from './stats';

describe('statistics overview', () => {
  it('labels the first-open → resolve median as the agent’s own time, like the ticket view', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<h1 id="statsTitle"></h1><p id="statsSub"></p><div id="statsBody"></div>';
    initStats(shadow, {}).sync();
    const labels = [...shadow.querySelectorAll('#statsBody .stat span')].map((el) => el.textContent);
    expect(labels).toContain('Your median time to resolve');
    expect(labels).not.toContain('Median time to resolve');
    expect(labels).toContain('Median age at resolve');
  });
});
