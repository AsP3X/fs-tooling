// Human: While the panel's visual sort is active, the rows on screen are not in Freshservice's order.
// Shift-click range selection follows Freshservice's order, so it would tick tickets the user cannot
// see as part of the range — dangerous right before a bulk action. Block only that gesture and explain.
// Agent: READS click target + shiftKey. WRITES nothing on the page; CALLS notify. Plain clicks, row
// clicks, and ctrl/cmd-clicks are never touched. Listener is capture-phase on window, so it runs first.

const SELECT_CELL = 'td[data-name="isSelected"], [data-test-id="checkbox-cell"], .checkbox-cell';

export const SHIFT_SELECT_NOTICE = 'Shift-select is paused while the panel sort is on, because Freshservice would select by its own order, not the order you see. Tick rows one by one, or set Sort to Default.';

/** True for a shift-click on a row's selection checkbox in the list body. */
export function isShiftSelectClick(event: Pick<MouseEvent, 'shiftKey' | 'target'>): boolean {
  if (!event.shiftKey) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest('tbody tr.et-tr')) return false;
  return !!target.closest(SELECT_CELL);
}

// Agent: RETURNS an uninstall function. `isActive` is checked per event so the guard costs nothing while
// the table is in Freshservice's order. Press events are swallowed too, in case the checkbox component
// handles range selection on pointerdown/mousedown; only the click shows the notice.
const PRESS_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const;

export function installSelectionGuard(
  win: Window,
  isActive: () => boolean,
  notify: (message: string) => void,
): () => void {
  const onPress = (event: MouseEvent): void => {
    if (!isShiftSelectClick(event) || !isActive()) return;
    event.stopImmediatePropagation();
  };
  const onClick = (event: MouseEvent): void => {
    if (!isShiftSelectClick(event) || !isActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    notify(SHIFT_SELECT_NOTICE);
  };
  PRESS_EVENTS.forEach((type) => win.addEventListener(type, onPress as EventListener, true));
  win.addEventListener('click', onClick, true);
  return () => {
    PRESS_EVENTS.forEach((type) => win.removeEventListener(type, onPress as EventListener, true));
    win.removeEventListener('click', onClick, true);
  };
}
