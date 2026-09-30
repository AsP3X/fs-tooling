import { afterEach, describe, expect, it } from 'vitest';
import { installSelectionGuard, isShiftSelectClick, SHIFT_SELECT_NOTICE } from './selection-guard';

function list(): { box: HTMLInputElement; subject: HTMLElement } {
  document.body.innerHTML = `<table><tbody><tr class="et-tr">
    <td data-name="isSelected"><div data-test-id="checkbox-cell" class="checkbox-cell"><input type="checkbox" id="box"></div></td>
    <td data-name="ticket_subject"><a id="subject" href="/a/tickets/1">T</a></td>
  </tr></tbody></table>`;
  return {
    box: document.getElementById('box') as HTMLInputElement,
    subject: document.getElementById('subject') as HTMLElement,
  };
}

describe('isShiftSelectClick', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('only matches shift-clicks on the selection checkbox cell', () => {
    const { box, subject } = list();
    expect(isShiftSelectClick({ shiftKey: true, target: box })).toBe(true);
    expect(isShiftSelectClick({ shiftKey: false, target: box })).toBe(false);
    expect(isShiftSelectClick({ shiftKey: true, target: subject })).toBe(false);
  });
});

describe('installSelectionGuard', () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.body.innerHTML = '';
  });

  it('blocks shift-select only while the visual sort is active', () => {
    const { box } = list();
    let active = true;
    const notices: string[] = [];
    uninstall = installSelectionGuard(window, () => active, (m) => notices.push(m));
    box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    expect(box.checked).toBe(false);
    expect(notices).toEqual([SHIFT_SELECT_NOTICE]);
    active = false;
    box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }));
    expect(box.checked).toBe(true);
    expect(notices).toHaveLength(1);
  });

  it('also swallows shift press events so a mousedown-based range select cannot run', () => {
    const { box } = list();
    const seen: string[] = [];
    box.addEventListener('mousedown', () => seen.push('mousedown'));
    box.addEventListener('pointerdown', () => seen.push('pointerdown'));
    uninstall = installSelectionGuard(window, () => true, () => {});
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }));
    box.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey: true }));
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(seen).toEqual(['mousedown']);
  });

  it('never touches plain clicks', () => {
    const { box } = list();
    uninstall = installSelectionGuard(window, () => true, () => {});
    box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(box.checked).toBe(true);
  });
});
