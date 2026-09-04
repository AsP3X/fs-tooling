// Human: Late-bound UI hooks so page painting does not import the panel module (avoids a cycle).
// Agent: WRITES renderStats / onPageChange from panel/ui.ts; CALLS from paint.ts and the MutationObserver.

export const runtime = {
  renderStats: (): void => {},
  onPageChange: (): void => {},
};
