// Human: Visual-only row sort. Computes a vertical offset per row (applied as position:relative + top)
// so the table *looks* sorted while the DOM keeps Freshservice's order. Ember/Glimmer tracks rows by
// DOM position; physically moving them can orphan or misplace rows on the next re-render.
// Agent: PURE. RETURNS pixel offsets indexed like the input boxes. No DOM access.

export interface RowBox {
  /** offsetTop of the row inside its tbody, in natural (DOM) order. */
  top: number;
  height: number;
}

/** True when `order` lists 0..n-1 unchanged (nothing to shift). */
export function isNaturalOrder(order: readonly number[]): boolean {
  return order.every((value, index) => value === index);
}

/**
 * Offsets that move each natural row to its slot in `order`.
 * `order[k]` is the natural index shown at visual position k.
 */
// Agent: Each row keeps its own pitch (height + gap to the next row) so mixed row heights and
// border-spacing still tile without overlap. RETURNS all zeros for the natural order.
export function visualOffsets(boxes: readonly RowBox[], order: readonly number[]): number[] {
  const offsets = boxes.map(() => 0);
  if (!boxes.length || order.length !== boxes.length) return offsets;
  const gaps = boxes.map((box, i) => {
    const next = boxes[i + 1];
    return next ? Math.max(0, next.top - box.top - box.height) : 0;
  });
  // The last row has no successor; reuse the gap above it so a moved-up last row keeps the spacing.
  if (boxes.length > 1) gaps[boxes.length - 1] = gaps[boxes.length - 2];
  const pitch = boxes.map((box, i) => box.height + gaps[i]);
  let cursor = boxes[0].top;
  order.forEach((naturalIndex) => {
    const box = boxes[naturalIndex];
    if (!box) return;
    offsets[naturalIndex] = cursor - box.top;
    cursor += pitch[naturalIndex];
  });
  return offsets;
}
