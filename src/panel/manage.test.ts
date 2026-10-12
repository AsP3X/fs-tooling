// Human: Manage filters dialog — new-filter flow and the editor's action buttons.
// Agent: onChange writes the list back to state and calls sync(), the way ui.ts does through syncUI. A press is
// mousedown + click; when mousedown is not cancelled the focused field gets its blur-time change first.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinFilterPattern, builtinFilters } from '../lib/filters';
import { assignRoot, getSettings, page, setModuleId } from '../lib/state';
import type { FilterRule } from '../lib/types';
import { initManage } from './manage';

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

function custom(partial: Partial<FilterRule> = {}): FilterRule {
  return { id: 'c1', name: 'Mine', builtin: false, enabled: true, color: '#c62828', matchMode: 'or', invert: false, criteria: {}, ...partial };
}

function setFilters(filters: FilterRule[]): void {
  assignRoot({ tickets: { ...getSettings().tickets, filters } });
}

interface Mounted {
  shadow: ShadowRoot;
  editor: HTMLElement;
  onChange: ReturnType<typeof vi.fn<(filters: FilterRule[]) => void>>;
  q: <T extends HTMLElement>(sel: string) => T;
}

function mount(filters: FilterRule[]): Mounted {
  setFilters(filters);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<p id="manageFilterWarn" hidden></p><div id="filterList"></div><button id="newFilter" type="button">New filter</button><div class="card hide" id="filterEditor"></div>';
  const onChange = vi.fn<(next: FilterRule[]) => void>();
  const manage = initManage(shadow, { onChange });
  onChange.mockImplementation((next) => {
    setFilters(next);
    manage.sync();
  });
  manage.sync();
  const q = <T extends HTMLElement>(sel: string): T => {
    const el = shadow.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  return { shadow, editor: q('#filterEditor'), onChange, q };
}

/** A user press: mousedown, then the blur-time change unless mousedown was cancelled, then click if still attached. */
function press(shadow: ShadowRoot, el: HTMLElement): { held: boolean; clicked: boolean } {
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  el.dispatchEvent(down);
  if (!down.defaultPrevented) {
    const focused = shadow.activeElement as HTMLElement | null;
    focused?.dispatchEvent(new Event('change', { bubbles: true }));
    focused?.blur();
  }
  const clicked = el.isConnected;
  if (clicked) el.click();
  return { held: down.defaultPrevented, clicked };
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  field.focus();
  field.value = value;
}

beforeEach(() => {
  document.body.innerHTML = '';
  setModuleId('tickets');
});

describe('New filter', () => {
  it('opens the editor on the same click and creates the rule switched off', () => {
    const m = mount([custom()]);
    m.q('#newFilter').click();
    const created = (page().filters || []).at(-1);
    expect(created?.name).toBe('New filter');
    expect(created?.enabled).toBe(false);
    expect(m.editor.classList.contains('hide')).toBe(false);
    expect(m.q<HTMLInputElement>('#filterName').value).toBe('New filter');
    expect(m.shadow.querySelector(`.filter-row[data-id="${created?.id}"] .toggle.on`)).toBeNull();
  });
});

describe('editor action buttons after typing', () => {
  function editCustom(): Mounted {
    const m = mount([custom()]);
    m.q('.filter-row [data-act="edit"]').click();
    return m;
  }

  it('Done saves the typed regex and closes on the first click', () => {
    const m = editCustom();
    type(m.q<HTMLTextAreaElement>('#filterRegex textarea'), '^open$');
    const result = press(m.shadow, m.q('#closeEditor'));
    expect(result).toEqual({ held: true, clicked: true });
    expect(page().filters?.[0].criteria.statusPattern).toBe('^open$');
    expect(m.editor.classList.contains('hide')).toBe(true);
    expect(m.onChange).toHaveBeenCalledTimes(1);
  });

  it('Done saves the typed name on the first click', () => {
    const m = editCustom();
    type(m.q<HTMLInputElement>('#filterName'), '  Renamed  ');
    press(m.shadow, m.q('#closeEditor'));
    expect(page().filters?.[0].name).toBe('Renamed');
    expect(m.editor.classList.contains('hide')).toBe(true);
  });

  it('a group header saves the typed regex and toggles on the first click', () => {
    const m = editCustom();
    const head = m.q('.tagbox-head[data-group="people"]');
    const wasOpen = head.parentElement?.classList.contains('open');
    type(m.q<HTMLTextAreaElement>('#filterRegex textarea'), 'pending');
    expect(press(m.shadow, head).held).toBe(true);
    expect(page().filters?.[0].criteria.statusPattern).toBe('pending');
    expect(m.q('.tagbox-head[data-group="people"]').parentElement?.classList.contains('open')).toBe(!wasOpen);
    // The editor was rebuilt from the saved rule, not from the copy the old handler closed over.
    expect(m.q<HTMLTextAreaElement>('#filterRegex textarea').value).toBe('pending');
  });

  it('Delete saves first, so cancelling the prompt keeps the typed value', () => {
    const m = editCustom();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    type(m.q<HTMLInputElement>('#filterName'), 'Keep me');
    expect(press(m.shadow, m.q('#delEditor')).held).toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('Delete “Keep me”?');
    expect(page().filters?.map((r) => r.name)).toEqual(['Keep me']);
    confirmSpy.mockReturnValue(true);
    press(m.shadow, m.q('#delEditor'));
    expect(page().filters).toEqual([]);
    expect(m.editor.classList.contains('hide')).toBe(true);
    confirmSpy.mockRestore();
  });

  it('Restore default works on the first click after typing', () => {
    const builtin = builtinFilters('tickets').find((r) => builtinFilterPattern(r));
    if (!builtin) throw new Error('no default with a regex');
    const m = mount([builtin]);
    m.q('.filter-row [data-act="edit"]').click();
    // Typing into a default forks it; the fork is what Restore acts on.
    type(m.q<HTMLTextAreaElement>('#filterRegex textarea'), 'mine');
    press(m.shadow, m.q('.tagbox-head'));
    expect(page().filters?.[0].builtin).toBe(false);
    type(m.q<HTMLTextAreaElement>('#filterRegex textarea'), 'mine again');
    expect(press(m.shadow, m.q('#restoreEditor'))).toEqual({ held: true, clicked: true });
    expect(page().filters?.[0].id).toBe(builtin.id);
    expect(page().filters?.[0].builtin).toBe(true);
  });

  it('Done on an untouched default does not fork it', () => {
    const builtin = builtinFilters('tickets').find((r) => builtinFilterPattern(r));
    if (!builtin) throw new Error('no default with a regex');
    const m = mount([builtin]);
    m.q('.filter-row [data-act="edit"]').click();
    m.q<HTMLTextAreaElement>('#filterRegex textarea').focus();
    press(m.shadow, m.q('#closeEditor'));
    expect(m.onChange).not.toHaveBeenCalled();
    expect(page().filters?.[0].id).toBe(builtin.id);
  });
});
