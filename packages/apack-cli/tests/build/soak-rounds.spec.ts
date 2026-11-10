import { expect, it } from 'vitest';
import { judgeSoak } from '../../scripts/soak-rounds.ts';

const picked = { pickedUp: true, bystanderSaw: true };
const pickedUnseen = { pickedUp: true, bystanderSaw: false };
const lost = { pickedUp: false, bystanderSaw: true };
const stalled = { pickedUp: false, bystanderSaw: false };

it('passes only when every edit was picked up', () => {
  expect(judgeSoak([picked, pickedUnseen])).toEqual({ rounds: 2, pickedUp: 2, lost: 0, stalled: 0, exitCode: 0 });
});

it('blames the watcher only when the event was delivered', () => {
  expect(judgeSoak([picked, lost, stalled])).toEqual({ rounds: 3, pickedUp: 1, lost: 1, stalled: 1, exitCode: 1 });
});

it('calls a stall partial rather than a pass or a failure', () => {
  expect(judgeSoak([picked, stalled])).toMatchObject({ lost: 0, stalled: 1, exitCode: 3 });
});

it('blames the watcher for every miss when it held only file watches', () => {
  expect(judgeSoak([picked, pickedUnseen, stalled], { filesOnly: true })).toMatchObject({ pickedUp: 2, lost: 1, stalled: 0, exitCode: 1 });
});

it('does not call a soak that ran nothing a pass', () => {
  expect(judgeSoak([]).exitCode).toBe(3);
});
