// Where each commit of a history is drawn: one lane for a line of commits, a second opened by a merge's other parent
// and ended where the two lines meet again.
import { expect, it } from 'vitest';
import { laneRows } from '#features/code/fe/utils/history-lanes.ts';

it('draws a line of commits in one lane', () => {
  const rows = laneRows([{ hash: 'c', parents: ['b'] }, { hash: 'b', parents: ['a'] }, { hash: 'a', parents: [] }]);

  expect(rows.map(row => row.lane)).toEqual([0, 0, 0]);
  expect(rows.at(-1)!.below, 'and nothing goes on below the first commit').toEqual([]);
});

it('opens a lane for a merge\'s other parent and ends it where the two lines meet', () => {
  // m merges b into a's line; both came from c
  const rows = laneRows([
    { hash: 'm', parents: ['a', 'b'] },
    { hash: 'b', parents: ['c'] },
    { hash: 'a', parents: ['c'] },
    { hash: 'c', parents: [] },
  ]);

  expect(rows.map(row => row.lane)).toEqual([0, 1, 0, 0]);
  expect(rows[0]!.merges).toEqual([1]);
  expect(rows[2]!.below, 'both lines wait for c below a').toEqual([0, 1]);
  expect(rows[3]!.through, 'and meet at it').toEqual([0, 1]);
  expect(rows[3]!.below).toEqual([]);
  expect(rows.at(-1)!.width).toBe(2);
});
