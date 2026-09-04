/// <reference types="vite/client" />

export {};

declare global {
  interface Window {
    __staleTicketObserver?: MutationObserver;
  }
}
