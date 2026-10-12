/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    __staleTicketObserver?: MutationObserver;
    /** Attribute guard for painted rows (class/style/href). Disconnected on re-inject. */
    __sthAttrObserver?: MutationObserver;
    /** Uninstalls the previous instance's window listeners on re-inject. */
    __sthTeardown?: () => void;
    /** Panel document/window listeners. Set by initPanel; content.ts calls it on re-inject. */
    __sthPanelTeardown?: () => void;
  }
}
