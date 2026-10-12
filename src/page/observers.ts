// Human: The two page observers. childList → debounced repaint; attributes (class/style/href) → cheap guard
// that re-applies marks/offsets Ember wiped and drops state on rows recycled for another ticket.
// Agent: CALLS paint/start-column guards synchronously (before the browser paints the mutation), then
// debounces `onPaint`. RETURNS { childObserver, attrObserver, stop } so content.ts can disconnect them on
// re-inject. Our own writes are idempotent, so each settles after at most one extra callback.

import { rowHrefChanged, shouldIgnoreMutations } from './mutations';
import { dropShiftsOnStructureChange, recordsTouchPaintedRows, restorePaintedRows } from './paint';
import { invalidateStaleStartCells } from './start-column';

export interface ListObservers {
  childObserver: MutationObserver;
  attrObserver: MutationObserver;
  /** Disconnect both observers and cancel a pending repaint. */
  stop: () => void;
}

// Human: Stale highlights / start dates / offsets never show on a row that now holds another ticket, and
// added/removed rows never overlap a visual sort.
function settleRows(muts: MutationRecord[]): void {
  dropShiftsOnStructureChange(muts);
  restorePaintedRows();
  invalidateStaleStartCells();
}

export function startListObservers(
  root: HTMLElement,
  host: Element | null,
  onPaint: () => void,
  debounceMs = 300,
): ListObservers {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedulePaint = (): void => {
    clearTimeout(timer);
    timer = setTimeout(onPaint, debounceMs);
  };

  const inListRow = (record: MutationRecord): boolean => {
    const el = record.target instanceof Element ? record.target : record.target.parentElement;
    return !!el?.closest('tbody tr.et-tr');
  };

  const childObserver = new MutationObserver((muts) => {
    const relevant = muts.filter((record) => record.type !== 'characterData' || inListRow(record));
    if (!relevant.length || shouldIgnoreMutations(relevant, host)) return;
    settleRows(relevant);
    schedulePaint();
  });
  childObserver.observe(root, { childList: true, subtree: true, characterData: true });

  const attrObserver = new MutationObserver((muts) => {
    const recycled = rowHrefChanged(muts);
    const text = muts.some((record) => (record.attributeName === 'aria-label' || record.attributeName === 'title') && inListRow(record));
    if (recycled || recordsTouchPaintedRows(muts)) settleRows(muts);
    // Ember can recycle a row by swapping the subject link, or edit a cell's text without adding a node.
    if (recycled || text) schedulePaint();
  });
  attrObserver.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'href', 'aria-label', 'title'], subtree: true });

  return {
    childObserver,
    attrObserver,
    stop: () => {
      clearTimeout(timer);
      childObserver.disconnect();
      attrObserver.disconnect();
    },
  };
}
