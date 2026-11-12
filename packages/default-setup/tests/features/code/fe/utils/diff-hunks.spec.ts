// Where a piece of a change is in the file, for the bar that names it and the editor that goes to it
import { expect, it } from 'vitest';
import { firstChangedLine, hunkLines } from '#features/code/fe/utils/diff-hunks.ts';

const HEADER = 'diff --git a/a.txt b/a.txt\nindex 1..2 100644\n--- a/a.txt\n+++ b/a.txt\n';
const hunk = (at: string, body: string[]) => {
  const [, oldStart, oldLines, newStart, newLines] = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(at)!.map(Number);
  return { id: at, oldStart: oldStart!, oldLines: oldLines!, newStart: newStart!, newLines: newLines!, patch: `${HEADER}${at}\n${body.join('\n')}\n` };
};

it('goes to the line that changed, past the unchanged lines git shows around it', () => {
  expect(firstChangedLine(hunk('@@ -30,7 +30,7 @@', [' a', ' b', ' c', '-old', '+new', ' d', ' e', ' f']))).toBe(33);
});

it('goes to the line a removal sits before, and to the first line of a file changed at its top', () => {
  expect(firstChangedLine(hunk('@@ -10,5 +10,4 @@', [' a', ' b', '-gone', ' c', ' d']))).toBe(12);
  expect(firstChangedLine(hunk('@@ -1,2 +0,0 @@', ['-only', '-lines']))).toBe(1);
  expect(firstChangedLine(hunk('@@ -1,3 +1,4 @@', ['+first', ' a', ' b', ' c']))).toBe(1);
});

it('says where a piece is as a person would', () => {
  expect(hunkLines(hunk('@@ -30,7 +30,7 @@', []))).toBe('lines 30–36');
  expect(hunkLines(hunk('@@ -4,1 +4,1 @@', []))).toBe('line 4');
  expect(hunkLines(hunk('@@ -1,2 +0,0 @@', []))).toBe('line 1');
});
