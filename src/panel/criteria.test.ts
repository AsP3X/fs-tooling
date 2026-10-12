// Human: Filter-editor fields. Covers the regex field's save-on-change and the focus-holding helpers.
// Agent: jsdom only. A real blur is not simulated; change is dispatched the way flushFieldEdit does it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinFilterPattern, builtinFilters, forkFromBuiltin } from '../lib/filters';
import type { FilterCriteria, FilterRule } from '../lib/types';
import { flushFieldEdit, keepFieldFocus, mountFilterRegex } from './criteria';

function custom(criteria: FilterCriteria = {}): FilterRule {
  return { id: 'c1', name: 'Mine', builtin: false, enabled: true, color: '#c62828', matchMode: 'or', invert: false, criteria };
}

function mount(rule: FilterRule): { shadow: ShadowRoot; box: HTMLElement; area: HTMLTextAreaElement; onPatch: ReturnType<typeof vi.fn<(patch: FilterCriteria) => void>> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const box = document.createElement('div');
  shadow.appendChild(box);
  const onPatch = vi.fn<(patch: FilterCriteria) => void>();
  mountFilterRegex(box, rule, onPatch);
  return { shadow, box, area: box.querySelector('textarea') as HTMLTextAreaElement, onPatch };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('keepFieldFocus', () => {
  it('cancels mousedown so the edited field does not blur before click', () => {
    const btn = document.createElement('button');
    keepFieldFocus(btn);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    btn.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('leaves click alone', () => {
    const btn = document.createElement('button');
    const onClick = vi.fn();
    btn.addEventListener('click', onClick);
    keepFieldFocus(btn);
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('regex field', () => {
  it('saves the focused field on flush and not again on the later blur', () => {
    const { shadow, box, area, onPatch } = mount(custom());
    area.focus();
    area.value = '  ^open$ ';
    flushFieldEdit(shadow, box);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ statusPattern: '^open$' });
    // The browser's own change, fired when the field finally blurs.
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  it('does not save an untouched field on flush (would fork a default)', () => {
    const builtin = builtinFilters('tickets').find((r) => builtinFilterPattern(r));
    if (!builtin) throw new Error('no default with a regex');
    const { shadow, box, area, onPatch } = mount(builtin);
    expect(area.value).not.toBe('');
    area.focus();
    flushFieldEdit(shadow, box);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('ignores a flush when focus is outside the editor', () => {
    const { shadow, box, area, onPatch } = mount(custom());
    area.value = 'typed';
    flushFieldEdit(shadow, box);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Default regex holds focus and replaces the typed text', () => {
    const builtin = builtinFilters('tickets').find((r) => builtinFilterPattern(r));
    if (!builtin) throw new Error('no default with a regex');
    const spec = builtinFilterPattern(builtin);
    if (!spec) throw new Error('no regex spec');
    const fork = forkFromBuiltin({ ...builtin, criteria: { ...builtin.criteria, [spec.field]: 'mine' } });
    const { box, area, onPatch } = mount(fork);
    const reset = box.querySelector('[data-default]') as HTMLButtonElement;
    area.focus();
    area.value = 'half typed';
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    reset.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    reset.click();
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenCalledWith({ [spec.field]: spec.source });
    expect(area.value).toBe(spec.source);
    expect(box.querySelector('[data-default]')).toBeNull();
    // The field now equals what was saved, so its blur is not a second save.
    area.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onPatch).toHaveBeenCalledTimes(1);
  });
});
