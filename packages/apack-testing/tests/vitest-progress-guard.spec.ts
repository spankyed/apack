// What the progress guard sets for every suite that loads it, which is every suite (`suite-timeouts.spec.ts`).
import { expect, it } from 'vitest';

it("gives a poll that names no timeout the guard's stall window rather than Vitest's one second", async () => {
  const started = Date.now();
  // True only once more than Vitest's own default has passed, so a poll held to that default fails here
  await expect.poll(() => Date.now() - started).toBeGreaterThan(1_500);
});
