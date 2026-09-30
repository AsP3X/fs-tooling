import { describe, expect, it } from 'vitest';
import { isNaturalOrder, visualOffsets } from './visual-order';

describe('visualOffsets', () => {
  it('is all zeros for the natural order', () => {
    const boxes = [{ top: 0, height: 40 }, { top: 40, height: 40 }];
    expect(visualOffsets(boxes, [0, 1])).toEqual([0, 0]);
    expect(isNaturalOrder([0, 1])).toBe(true);
  });

  it('swaps equal-height rows', () => {
    const boxes = [{ top: 0, height: 40 }, { top: 40, height: 40 }, { top: 80, height: 40 }];
    expect(visualOffsets(boxes, [2, 1, 0])).toEqual([80, 0, -80]);
    expect(isNaturalOrder([2, 1, 0])).toBe(false);
  });

  it('tiles mixed heights without overlap or gaps', () => {
    const boxes = [{ top: 10, height: 30 }, { top: 40, height: 60 }, { top: 100, height: 20 }];
    const order = [2, 0, 1];
    const offsets = visualOffsets(boxes, order);
    const placed = order.map((i) => ({ top: boxes[i].top + offsets[i], height: boxes[i].height }));
    expect(placed).toEqual([{ top: 10, height: 20 }, { top: 30, height: 30 }, { top: 60, height: 60 }]);
  });

  it('keeps each row pitch (border-spacing) when rows have gaps', () => {
    const boxes = [{ top: 0, height: 40 }, { top: 42, height: 40 }];
    expect(visualOffsets(boxes, [1, 0])).toEqual([42, -42]);
  });

  it('refuses mismatched input instead of guessing', () => {
    expect(visualOffsets([{ top: 0, height: 40 }], [0, 1])).toEqual([0]);
  });
});
