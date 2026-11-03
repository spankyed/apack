import { expect, it, vi } from 'vitest';
import { createScrollPositioning } from '#features/threads/fe/chat/scroll-positioning.ts';

it('keeps automatic paging disabled throughout replacement and initial positioning', () => {
  const frames = new Map<number, () => void>();
  let next = 0;
  const positioning = createScrollPositioning(callback => { frames.set(++next, callback); return next; }, id => { frames.delete(id); });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const scroll = vi.fn();
  positioning.position(scroll);
  expect(positioning.ready()).toBe(false);
  flush();
  expect(positioning.ready()).toBe(false);
  flush();
  expect(positioning.ready()).toBe(true);
  expect(scroll).toHaveBeenCalledTimes(3);

  positioning.reset();
  expect(positioning.ready()).toBe(false);
  positioning.position(scroll);
  const stale = [...frames.values()][0]!;
  positioning.reset();
  stale();
  expect(scroll).toHaveBeenCalledTimes(4);
  expect(positioning.ready()).toBe(false);
  expect(frames.size).toBe(0);

  positioning.position(scroll);
  flush(); flush();
  expect(positioning.ready()).toBe(true);
});
