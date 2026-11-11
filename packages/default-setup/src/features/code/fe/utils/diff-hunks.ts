import type { DiffHunk } from '../../be/types.ts'

/**
 * The line on the right side of the diff where a piece's change begins. A piece starts with the lines around
 * the change, which are the same on both sides, so this is past those: the first line added, or the line a
 * removal sits before.
 */
export function firstChangedLine(hunk: DiffHunk): number {
  let line = hunk.newStart
  for (const row of hunk.patch.slice(hunk.patch.indexOf('\n@@ ') + 1).split('\n').slice(1)) {
    if (row.startsWith('+') || row.startsWith('-')) return Math.max(1, line)
    if (row.startsWith(' ')) line++
  }
  return Math.max(1, hunk.newStart)
}

/** Where a piece is on the right side of the diff, as a person would say it */
export function hunkLines(hunk: DiffHunk): string {
  if (hunk.newLines <= 1) return `line ${Math.max(1, hunk.newStart)}`
  return `lines ${hunk.newStart}–${hunk.newStart + hunk.newLines - 1}`
}
