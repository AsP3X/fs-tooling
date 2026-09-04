// Human: Late-bound UI hooks so page painting does not import the panel module (avoids a cycle).
// Agent: WRITES renderStats from panel/ui.ts; CALLS from paint.ts after each list pass.

export const runtime = {
  renderStats: (): void => {},
};
