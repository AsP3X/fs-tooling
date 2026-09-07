// Human: Injected page CSS for idle-row highlight and the Journeys Start date column.
// Agent: WRITES #sth-page-style. Color comes from the active module's settings.

import { CELL_MARK, ROW_MARK, STYLE_ID } from '../lib/constants';
import { accentColor } from '../lib/filters';
import { getModuleId, page } from '../lib/state';

export function pageStyleElement(): HTMLStyleElement | null {
  return document.getElementById(STYLE_ID) as HTMLStyleElement | null;
}

export function applyPageStyles(): void {
  const el = pageStyleElement();
  if (!el) return;
  const c = accentColor(page(), getModuleId());
  const css = `
      .${ROW_MARK} {
        background-color: color-mix(in srgb, var(--sth-mark, ${c}) 18%, transparent) !important;
        box-shadow: inset 4px 0 0 var(--sth-mark, ${c}) !important;
      }
      .${ROW_MARK} > td { background-color: color-mix(in srgb, var(--sth-mark, ${c}) 18%, transparent) !important; }
      .${CELL_MARK} {
        background-color: color-mix(in srgb, var(--sth-mark, ${c}) 35%, transparent) !important;
        outline: 2px solid var(--sth-mark, ${c}) !important;
        border-radius: 3px;
      }
      th[data-sth-col="start"], td[data-sth-col="start"] {
        width: 148px !important;
        min-width: 148px !important;
        max-width: 148px !important;
        box-sizing: border-box;
        vertical-align: middle;
        padding: 8px 12px !important;
        font-size: 13px;
      }
      th[data-sth-col="start"] {
        position: sticky;
        top: 0;
        z-index: 3;
        cursor: pointer;
        user-select: none;
        font-weight: 650;
        background: inherit !important;
        border-bottom: 1px solid var(--color-boundary-border-0-3, rgba(0,0,0,.08));
      }
      th[data-sth-col="start"]:hover { color: ${c}; }
      th[data-sth-col="start"] .sth-sort { margin-left: 6px; opacity: .45; font-size: 11px; }
      th[data-sth-col="start"].sth-on .sth-sort { opacity: 1; color: ${c}; }
      th[data-sth-col="start"] .sth-range-badge {
        margin-left: 8px;
        border: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: 11px;
        font-weight: 650;
        opacity: .5;
        cursor: pointer;
      }
      th[data-sth-col="start"] .sth-range-badge:hover,
      th[data-sth-col="start"].sth-filtered .sth-range-badge { opacity: 1; color: ${c}; }
      th[data-sth-col="start"].sth-range-off .sth-range-badge,
      th[data-sth-col="start"] .sth-range-badge:disabled {
        opacity: .35;
        cursor: default;
        color: inherit;
      }
      td[data-sth-col="start"] {
        color: inherit;
        white-space: nowrap;
      }
      td[data-sth-col="start"] .sth-empty { opacity: .35; }
    `;
  if (el.textContent === css) return;
  el.textContent = css;
}
