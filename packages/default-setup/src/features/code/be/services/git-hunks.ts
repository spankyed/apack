// A file's change, cut into the pieces git calls hunks, each one a patch that can be applied by itself. Staging
// one piece of a file is `git apply --cached` of that piece: git made the patch and git reads it back, so what a
// line ending or a filter does to the file is git's to get right on both sides.
import type { DiffHunk } from '../types.ts'

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** What a patch's header says that makes the file more than plainly modified, where only the whole file is staged */
const NOT_PLAINLY_MODIFIED = /^(new file mode|deleted file mode|rename from|rename to|copy from|copy to|similarity index|old mode|new mode|Binary files|GIT binary patch)/m

/**
 * The hunks of one file's patch as `git diff` printed it, each with the patch that applies it alone. Nothing for
 * a file that was added, deleted, renamed or is binary, and nothing for a patch of more than one file.
 */
export function hunksOf(patch: string): DiffHunk[] {
  const lines = patch.split('\n')
  const first = lines.findIndex(line => HUNK.test(line))
  if (first < 0) return []
  const header = lines.slice(0, first)
  if (header.filter(line => line.startsWith('diff --git ')).length !== 1 || NOT_PLAINLY_MODIFIED.test(header.join('\n'))) return []
  // A patch ends with a line break, which leaves one empty string after the last line
  const body = lines.slice(first, lines.at(-1) === '' ? -1 : undefined)

  const hunks: DiffHunk[] = []
  for (let at = 0; at < body.length;) {
    let end = at + 1
    while (end < body.length && !HUNK.test(body[end]!)) end++
    const [, oldStart, oldLines, newStart, newLines] = HUNK.exec(body[at]!)!
    hunks.push({
      oldStart: Number(oldStart), oldLines: Number(oldLines ?? 1),
      newStart: Number(newStart), newLines: Number(newLines ?? 1),
      patch: `${[...header, ...body.slice(at, end)].join('\n')}\n`,
    })
    at = end
  }
  return hunks
}
