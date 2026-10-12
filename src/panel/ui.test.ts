// Human: Panel wiring — API key save, minimize / chip, dock and resize, date range, column warnings, teardown.
// Agent: Mounts initPanel into a jsdom shadow root. The worker, the range API, painting, and the update toast are
// mocked. jsdom has no layout, so the dock tests install a fake one (fakeLayout).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reportable } from '../lib/types';

type RangeResult = { rows: Reportable[]; fromApi: boolean; truncated: boolean };

const listRangeResults = vi.fn<(visible: unknown[], force?: boolean) => Promise<RangeResult>>();
const getApiKey = vi.fn<() => Promise<string>>();
const setApiKey = vi.fn<(key: string) => Promise<void>>();
const clearApiKey = vi.fn<() => Promise<void>>();

vi.mock('../lib/api/enrich', () => ({
  listRangeResults: (visible: unknown[], force?: boolean) => listRangeResults(visible, force),
}));
vi.mock('../lib/secrets', async (original) => ({
  ...(await original<typeof import('../lib/secrets')>()),
  hasExtensionRuntime: () => false,
  getApiKey: () => getApiKey(),
  setApiKey: (key: string) => setApiKey(key),
  clearApiKey: () => clearApiKey(),
}));
vi.mock('../page/paint', () => ({ markTickets: vi.fn(), openMarked: vi.fn() }));
vi.mock('../page/ops-track', () => ({ trackCurrentTicket: vi.fn(async () => null) }));
vi.mock('./update-toast', () => ({ initUpdateToast: vi.fn() }));

// Agent: Node 25 exposes a throwing global localStorage that shadows jsdom's; settings only need memory here.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
});

import { STORAGE_KEY, defaultSettings } from '../lib/constants';
import { normalizeSettings } from '../lib/settings';
import { assignRoot, getLastRangeResults, getSettings, setApiKeyPresent, setLastMarkedUrls, setLastRangeResults, setModuleId } from '../lib/state';
import type { FilterRule, ModuleId, PageSettings } from '../lib/types';
import { runtime } from '../page/runtime';
import { initPanel } from './ui';

interface Mounted {
  host: HTMLElement;
  shadow: ShadowRoot;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
}

function mount(): Mounted {
  const host = document.createElement('div');
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  initPanel(host, shadow);
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = shadow.getElementById(id);
    if (!el) throw new Error(`missing #${id}`);
    return el as T;
  };
  return { host, shadow, $ };
}

/** Let resolved promises and zero-delay timers run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setPage(moduleId: ModuleId, partial: Partial<PageSettings>): void {
  assignRoot({ [moduleId]: { ...getSettings()[moduleId], ...partial } });
}

/** A tickets list, or a journeys list (Auto mode detects journeys from the Initiator header). */
function showList(moduleId: ModuleId, extra = ''): void {
  const journeyHead = moduleId === 'journeys' ? '<th data-name="initiator">Initiator</th>' : '';
  document.body.innerHTML = `<table><thead><tr><th data-name="ticket_subject">Subject</th>${journeyHead}${extra}</tr></thead>
    <tbody><tr class="et-tr"><td data-name="ticket_subject"><a href="/a/tickets/1">One</a></td></tr></tbody></table>`;
}

function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, clientX: x, clientY: y });
}

function drag(handle: HTMLElement, dx: number, dy: number): void {
  handle.dispatchEvent(pointer('pointerdown', 10, 10));
  window.dispatchEvent(pointer('pointermove', 10 + dx, 10 + dy));
  window.dispatchEvent(pointer('pointerup', 10 + dx, 10 + dy));
}

function ticketRow(label: string): Reportable {
  return { status: 'Open', idleDays: 1, startKey: null, updatedKey: '2026-01-05', startIn: null, progress: { pct: null }, kind: '—', href: `/a/tickets/${label}`, label };
}

beforeEach(() => {
  mem.clear();
  document.body.innerHTML = '';
  assignRoot(normalizeSettings(defaultSettings()));
  setModuleId('tickets');
  setApiKeyPresent(false);
  setLastMarkedUrls([]);
  setLastRangeResults([], { truncated: false, fromApi: false });
  listRangeResults.mockReset().mockResolvedValue({ rows: [], fromApi: true, truncated: false });
  getApiKey.mockReset().mockResolvedValue('');
  setApiKey.mockReset().mockResolvedValue(undefined);
  clearApiKey.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  window.__sthPanelTeardown?.();
  document.querySelectorAll('html > div').forEach((el) => el.remove());
  vi.useRealTimers();
});

describe('API key', () => {
  async function openSettings(saved = 'abcd1234'): Promise<Mounted> {
    getApiKey.mockResolvedValue(saved);
    const m = mount();
    m.$('openSettings').click();
    await tick();
    return m;
  }

  it('Save with an empty field keeps the stored key', async () => {
    const m = await openSettings();
    m.$('saveApiKey').click();
    await tick();
    expect(setApiKey).not.toHaveBeenCalled();
    expect(m.$('apiKeyStatus').textContent).toBe('Saved · ••••1234');
    expect(m.$('apiKeyNote').classList.contains('hide')).toBe(false);
  });

  it('Enter in an empty or blank field keeps the stored key', async () => {
    const m = await openSettings();
    const input = m.$<HTMLInputElement>('apiKeyInput');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    expect(setApiKey).not.toHaveBeenCalled();
    expect(m.$('apiKeyStatus').textContent).toBe('Saved · ••••1234');
  });

  it('saves a typed key, empties the field, and refreshes the status', async () => {
    const m = await openSettings('');
    const input = m.$<HTMLInputElement>('apiKeyInput');
    input.value = ' new-key-9876 ';
    getApiKey.mockResolvedValue('new-key-9876');
    m.$('saveApiKey').click();
    await tick();
    expect(setApiKey).toHaveBeenCalledWith('new-key-9876');
    expect(input.value).toBe('');
    expect(m.$('apiKeyStatus').textContent).toBe('Saved · ••••9876');
    expect(m.$('apiKeyNote').classList.contains('hide')).toBe(true);
  });

  it('after an extension reload it asks for a tab reload and keeps the "Saved" line', async () => {
    const m = await openSettings();
    setApiKey.mockRejectedValue(new Error('extension_context_invalidated'));
    // A dead context answers '' for the key; the status line must not be rebuilt from that.
    getApiKey.mockResolvedValue('');
    m.$<HTMLInputElement>('apiKeyInput').value = 'new-key';
    m.$('saveApiKey').click();
    await tick();
    expect(m.$('apiKeyNote').textContent).toContain('Reload this Freshservice tab');
    expect(m.$('apiKeyNote').classList.contains('hide')).toBe(false);
    expect(m.$('apiKeyStatus').textContent).toBe('Saved · ••••1234');
  });

  it('says so when the save fails for another reason', async () => {
    const m = await openSettings();
    setApiKey.mockRejectedValue(new Error('worker gone'));
    m.$<HTMLInputElement>('apiKeyInput').value = 'new-key';
    m.$('saveApiKey').click();
    await tick();
    expect(m.$('apiKeyNote').textContent).toBe('Couldn’t save the key. Try again.');
    expect(m.$<HTMLInputElement>('apiKeyInput').value).toBe('new-key');
    expect(m.$('apiKeyStatus').textContent).toBe('Saved · ••••1234');
  });
});

describe('minimize and the chip', () => {
  it('the chip is a named, focusable button', () => {
    const m = mount();
    const fab = m.$('fab');
    expect(fab.getAttribute('role')).toBe('button');
    expect(fab.tabIndex).toBe(0);
    expect(fab.getAttribute('aria-label')).toContain('Expand panel');
  });

  const key = (type: 'keydown' | 'keyup', k: string, repeat = false): KeyboardEvent =>
    new KeyboardEvent(type, { key: k, repeat, bubbles: true, cancelable: true });

  it('Minimize moves focus to the chip; Enter and Space expand it again', () => {
    const m = mount();
    for (const k of ['Enter', ' ']) {
      m.$('collapse').click();
      expect(getSettings().collapsed).toBe(true);
      expect(m.shadow.activeElement).toBe(m.$('fab'));
      const down = key('keydown', k);
      m.$('fab').dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      m.$('fab').dispatchEvent(key('keyup', k));
      expect(getSettings().collapsed).toBe(false);
      expect(m.shadow.activeElement).toBe(m.$('collapse'));
    }
  });

  it('releasing the Enter that pressed Minimize does not expand again', () => {
    const m = mount();
    m.$('collapse').click();
    // Focus is on the chip now; the key is still down from pressing Minimize, repeats, then comes up.
    m.$('fab').dispatchEvent(key('keydown', 'Enter', true));
    m.$('fab').dispatchEvent(key('keyup', 'Enter'));
    expect(getSettings().collapsed).toBe(true);
  });

  it('other keys on the chip do nothing', () => {
    const m = mount();
    m.$('collapse').click();
    m.$('fab').dispatchEvent(key('keydown', 'a'));
    m.$('fab').dispatchEvent(key('keyup', 'a'));
    expect(getSettings().collapsed).toBe(true);
  });

  it('the first chip click after dragging the panel expands it', async () => {
    const m = mount();
    drag(m.$('dragHandle'), 40, 30);
    await tick();
    m.$('collapse').click();
    m.$('fab').click();
    expect(getSettings().collapsed).toBe(false);
  });

  it('dragging the chip is not a click, and the next click still expands', async () => {
    const m = mount();
    m.$('collapse').click();
    drag(m.$('fab'), 40, 30);
    // The browser sends click right after pointerup when the pointer is still over the chip.
    m.$('fab').click();
    expect(getSettings().collapsed).toBe(true);
    await tick();
    m.$('fab').click();
    expect(getSettings().collapsed).toBe(false);
  });
});

describe('dock while a side dialog is open', () => {
  const MAIN_W = 320;
  const SIDE_W = 528;

  // Human: Boxes as the browser would lay them out: the host grows by the side dialog, and a dialog on the
  // left pushes the main panel right inside the host.
  function fakeLayout(m: Mounted): void {
    const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
      left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
    } as DOMRect);
    const side = (): boolean => !m.$('filterPanel').classList.contains('hide') || !m.$('statsPanel').classList.contains('hide');
    const hostLeft = (): number => parseFloat(m.host.style.left) || 0;
    const hostTop = (): number => parseFloat(m.host.style.top) || 0;
    const stub = (el: HTMLElement, fn: () => DOMRect): void => {
      Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: fn });
    };
    stub(m.host, () => rect(hostLeft(), hostTop(), side() ? MAIN_W + SIDE_W : MAIN_W, 400));
    stub(m.$('chromeRow'), () => rect(hostLeft(), hostTop(), side() ? MAIN_W + SIDE_W : MAIN_W, 400));
    stub(m.$('panel'), () => rect(hostLeft() + (side() && m.$('chromeRow').dataset.side === 'left' ? SIDE_W : 0), hostTop(), MAIN_W, 400));
  }

  // Human: Panel docked near the right edge, so Manage opens on its left: host origin ≠ panel origin.
  function openManageNearRightEdge(): Mounted {
    window.innerWidth = 1400;
    window.innerHeight = 900;
    showList('tickets');
    assignRoot({ x: 1000, y: 100 });
    const m = mount();
    fakeLayout(m);
    window.dispatchEvent(new Event('resize'));
    expect(m.host.style.left).toBe('1000px');
    m.$('openManage').click();
    expect(m.$('chromeRow').dataset.side).toBe('left');
    expect(m.$('panel').getBoundingClientRect().left).toBe(1000);
    return m;
  }

  it('a notice does not move the pair', () => {
    const m = openManageNearRightEdge();
    const before = m.host.style.left;
    runtime.notify('Shift-select is paused while sorted.');
    expect(m.$('pageNotice').hidden).toBe(false);
    expect(m.host.style.left).toBe(before);
    expect(m.$('panel').getBoundingClientRect().left).toBe(1000);
  });

  it('a window resize does not rewrite the saved dock', () => {
    const m = openManageNearRightEdge();
    mem.clear();
    window.innerWidth = 1300;
    window.dispatchEvent(new Event('resize'));
    expect(getSettings().x).toBe(1000);
    expect(getSettings().y).toBe(100);
    expect(mem.has(STORAGE_KEY)).toBe(false);
    // The main panel is kept in view by its own width (320), not the pair's.
    expect(m.$('panel').getBoundingClientRect().right).toBeLessThanOrEqual(1300 - 8);
  });

  it('a resize of the bare panel still re-clamps and saves the dock', () => {
    window.innerWidth = 1400;
    window.innerHeight = 900;
    showList('tickets');
    assignRoot({ x: 1000, y: 100 });
    const m = mount();
    fakeLayout(m);
    window.innerWidth = 1200;
    window.dispatchEvent(new Event('resize'));
    expect(getSettings().x).toBe(1200 - MAIN_W - 8);
  });

  it('dragging with Manage open saves the main panel’s corner, not the host’s', async () => {
    const m = openManageNearRightEdge();
    drag(m.$('filterHandle'), 10, 20);
    await tick();
    expect(getSettings().x).toBe(1010);
    expect(getSettings().y).toBe(120);
    m.$('closeFilters').click();
    expect(m.$('panel').getBoundingClientRect().left).toBe(1010);
  });
});

describe('date range', () => {
  async function mountWithKey(moduleId: ModuleId = 'tickets'): Promise<Mounted> {
    getApiKey.mockResolvedValue('abcd1234');
    showList(moduleId);
    const m = mount();
    await tick();
    return m;
  }

  function typeFrom(m: Mounted, value: string): void {
    const from = m.$<HTMLInputElement>('rangeFrom');
    from.focus();
    from.value = value;
    from.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('Apply saves the range for the list on screen and opens the results', async () => {
    const m = await mountWithKey();
    typeFrom(m, '2026-01-05');
    m.$('applyRange').click();
    await tick();
    expect(getSettings().tickets.startFrom).toBe('2026-01-05');
    expect(getSettings().journeys.startFrom).toBeNull();
    expect(m.$('resultsPanel').classList.contains('show')).toBe(true);
    expect(listRangeResults).toHaveBeenCalledTimes(1);
  });

  it('drops a draft and shows the new list’s saved range when the page changes while typing', async () => {
    setPage('journeys', { startFrom: '2026-02-02', startTo: '2026-02-03' });
    const m = await mountWithKey();
    typeFrom(m, '2026-01-05');
    showList('journeys');
    runtime.onPageChange();
    // Still focused, but the value now belongs to the journeys list.
    expect(m.shadow.activeElement).toBe(m.$('rangeFrom'));
    expect(m.$<HTMLInputElement>('rangeFrom').value).toBe('2026-02-02');
    expect(m.$<HTMLInputElement>('rangeTo').value).toBe('2026-02-03');
    m.$('applyRange').click();
    await tick();
    expect(getSettings().tickets.startFrom).toBeNull();
    expect(getSettings().journeys.startFrom).toBe('2026-02-02');
  });

  it('Apply never writes a ticket draft into journeys when the page moved before the panel synced', async () => {
    const m = await mountWithKey();
    typeFrom(m, '2026-01-05');
    showList('journeys');
    m.$('applyRange').click();
    await tick();
    expect(getSettings().journeys.startFrom).toBeNull();
    expect(getSettings().tickets.startFrom).toBeNull();
    expect(m.$<HTMLInputElement>('rangeFrom').value).toBe('');
    expect(m.$('resultsPanel').classList.contains('show')).toBe(false);
    expect(listRangeResults).not.toHaveBeenCalled();
  });

  it('Clear clears the list whose range is shown, not the list the page moved to', async () => {
    setPage('tickets', { startFrom: '2026-01-01', startTo: null });
    setPage('journeys', { startFrom: '2026-02-02', startTo: null });
    const m = await mountWithKey();
    expect(m.$<HTMLInputElement>('rangeFrom').value).toBe('2026-01-01');
    showList('journeys');
    m.$('clearRange').click();
    expect(getSettings().tickets.startFrom).toBeNull();
    expect(getSettings().journeys.startFrom).toBe('2026-02-02');
    expect(m.$<HTMLInputElement>('rangeFrom').value).toBe('2026-02-02');
  });

  it('ignores a ticket range answer that arrives after the page became a journeys list', async () => {
    const m = await mountWithKey();
    let answer: (value: RangeResult) => void = () => {};
    listRangeResults.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    typeFrom(m, '2026-01-05');
    m.$('applyRange').click();
    expect(m.$('resultsBody').textContent).toContain('Loading');
    showList('journeys');
    runtime.onPageChange();
    answer({ rows: [ticketRow('late ticket')], fromApi: true, truncated: false });
    await tick();
    expect(getLastRangeResults()).toEqual([]);
    expect(m.$('resultsBody').textContent).not.toContain('late ticket');
    // Journeys has no saved range, so the overlay closed instead of staying on "Loading…".
    expect(m.$('resultsPanel').classList.contains('show')).toBe(false);
  });

  it('reloads the open results for the new list when it has a saved range', async () => {
    setPage('journeys', { startFrom: '2026-02-02', startTo: null });
    const m = await mountWithKey();
    typeFrom(m, '2026-01-05');
    m.$('applyRange').click();
    await tick();
    listRangeResults.mockClear();
    showList('journeys');
    runtime.onPageChange();
    await tick();
    expect(listRangeResults).toHaveBeenCalledTimes(1);
    expect(m.$('resultsPanel').classList.contains('show')).toBe(true);
    expect(m.$('resultsSub').textContent).toContain('02-02-2026');
  });

  describe('results states', () => {
    async function applied(result: RangeResult | Error): Promise<Mounted> {
      const m = await mountWithKey();
      if (result instanceof Error) listRangeResults.mockRejectedValue(result);
      else listRangeResults.mockResolvedValue(result);
      typeFrom(m, '2026-01-05');
      m.$('applyRange').click();
      await tick();
      return m;
    }

    it('a failed request with a saved key offers a retry, not "save an API key"', async () => {
      const m = await applied({ rows: [], fromApi: false, truncated: false });
      const text = m.$('resultsBody').textContent || '';
      expect(text).toContain('Couldn’t load the list');
      expect(text).not.toContain('API key');
      listRangeResults.mockResolvedValue({ rows: [ticketRow('found')], fromApi: true, truncated: false });
      (m.shadow.getElementById('retryRange') as HTMLButtonElement).click();
      await tick();
      expect(listRangeResults).toHaveBeenLastCalledWith(expect.anything(), true);
      expect(m.$('resultsBody').textContent).toContain('found');
      expect(m.shadow.getElementById('retryRange')).toBeNull();
    });

    it('a failed request still lists this page’s matches and says they are page-only', async () => {
      const m = await applied({ rows: [ticketRow('on page')], fromApi: false, truncated: false });
      const text = m.$('resultsBody').textContent || '';
      expect(text).toContain('Couldn’t load the list');
      expect(text).toContain('this page only');
      expect(text).toContain('on page');
      expect(m.shadow.getElementById('retryRange')).not.toBeNull();
    });

    it('a thrown request shows the failure instead of "Loading…"', async () => {
      const m = await applied(new Error('message port closed'));
      expect(m.$('resultsBody').textContent).toContain('Couldn’t load the list');
      expect(m.shadow.getElementById('retryRange')).not.toBeNull();
    });

    it('a request that never answers stops showing "Loading…"', async () => {
      const m = await mountWithKey();
      listRangeResults.mockReturnValue(new Promise(() => {}));
      typeFrom(m, '2026-01-05');
      vi.useFakeTimers();
      m.$('applyRange').click();
      expect(m.$('resultsBody').textContent).toContain('Loading');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(m.$('resultsBody').textContent).toContain('Couldn’t load the list');
    });

    it('a successful empty result is a real empty state', async () => {
      const m = await applied({ rows: [], fromApi: true, truncated: false });
      expect(m.$('resultsBody').textContent).toBe('No items in this range.');
      expect(m.shadow.getElementById('retryRange')).toBeNull();
    });

    it('a truncated result says the list is partial', async () => {
      const m = await applied({ rows: [ticketRow('first')], fromApi: true, truncated: true });
      expect(m.$('resultsBody').textContent).toContain('Partial list');
      expect(m.$('resultsSub').textContent).toContain('partial list');
    });
  });

  describe('right-click on a start date', () => {
    function startCell(key: string): HTMLElement {
      const td = document.createElement('td');
      td.dataset.sthCol = 'start';
      td.dataset.startKey = key;
      document.querySelector('tr.et-tr')?.appendChild(td);
      return td;
    }

    it('applies that single day and opens the results', async () => {
      const m = await mountWithKey('journeys');
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      startCell('2026-03-04').dispatchEvent(menu);
      await tick();
      expect(menu.defaultPrevented).toBe(true);
      expect(getSettings().journeys.startFrom).toBe('2026-03-04');
      expect(getSettings().journeys.startTo).toBe('2026-03-04');
      expect(m.$('resultsPanel').classList.contains('show')).toBe(true);
      expect(listRangeResults).toHaveBeenCalledTimes(1);
    });

    it('leaves the browser menu alone without an API key', async () => {
      showList('journeys');
      const m = mount();
      await tick();
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      startCell('2026-03-04').dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(false);
      expect(getSettings().journeys.startFrom).toBeNull();
      expect(m.$('resultsPanel').classList.contains('show')).toBe(false);
    });
  });
});

describe('re-inject teardown', () => {
  function startHeader(): HTMLElement {
    showList('journeys', '<th data-sth-col="start">Start date</th>');
    return document.querySelector('th[data-sth-col="start"]') as HTMLElement;
  }

  it('initPanel registers a teardown that clears itself', () => {
    mount();
    expect(typeof window.__sthPanelTeardown).toBe('function');
    window.__sthPanelTeardown?.();
    expect(window.__sthPanelTeardown).toBeUndefined();
  });

  it('a replaced instance no longer handles the Start header, so one click sorts ascending', () => {
    const th = startHeader();
    mount();
    window.__sthPanelTeardown?.();
    mount();
    th.click();
    expect(getSettings().journeys.sortKey).toBe('start');
    expect(getSettings().journeys.sortDir).toBe('asc');
    th.click();
    expect(getSettings().journeys.sortDir).toBe('desc');
  });

  it('after teardown, document and window events reach nothing', async () => {
    getApiKey.mockResolvedValue('abcd1234');
    const th = startHeader();
    assignRoot({ x: 2000, y: 2000 });
    mount();
    await tick();
    window.__sthPanelTeardown?.();
    th.click();
    expect(getSettings().journeys.sortKey).toBe('default');
    const td = document.createElement('td');
    td.dataset.sthCol = 'start';
    td.dataset.startKey = '2026-03-04';
    document.querySelector('tr.et-tr')?.appendChild(td);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    td.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
    window.dispatchEvent(new Event('resize'));
    expect(getSettings().x).toBe(2000);
    // Hooks the page side calls are unhooked too.
    expect(() => runtime.notify('late')).not.toThrow();
  });
});

describe('hints, warnings, and Open marked', () => {
  it('on a ticket page the hint points at Settings for the API key', () => {
    const before = location.pathname;
    history.pushState({}, '', '/a/tickets/123');
    try {
      const m = mount();
      const text = m.$('contextHintText').textContent || '';
      expect(text).toContain('Settings');
      expect(text).not.toContain('Manage');
    } finally {
      history.pushState({}, '', before);
    }
  });

  it('the column warning follows a rule’s criteria', () => {
    const rule: FilterRule = { id: 'r1', name: 'Rule', builtin: false, enabled: true, color: '#c62828', matchMode: 'or', invert: false, criteria: {} };
    showList('tickets');
    setPage('tickets', { filters: [rule] });
    const m = mount();
    expect(m.$('filterWarn').hidden).toBe(true);
    // Edited in Manage: the rule now needs the Priority column, which this list does not show.
    setPage('tickets', { filters: [{ ...rule, criteria: { priorities: [4] } }] });
    runtime.onPageChange();
    expect(m.$('filterWarn').hidden).toBe(false);
    expect(m.$('filterWarn').textContent).toContain('Priority');
    expect(m.shadow.querySelector('.filter-chip.warn')).not.toBeNull();
    setPage('tickets', { filters: [rule] });
    runtime.onPageChange();
    expect(m.$('filterWarn').hidden).toBe(true);
    expect(m.shadow.querySelector('.filter-chip.warn')).toBeNull();
  });

  it('Open marked tabs is disabled until there is something to open', () => {
    showList('tickets');
    const m = mount();
    expect(m.$<HTMLButtonElement>('openStale').disabled).toBe(true);
    setLastMarkedUrls(['https://desk.example/a/tickets/1']);
    runtime.renderStats();
    expect(m.$<HTMLButtonElement>('openStale').disabled).toBe(false);
    setLastMarkedUrls([]);
    runtime.renderStats();
    expect(m.$<HTMLButtonElement>('openStale').disabled).toBe(true);
  });
});
