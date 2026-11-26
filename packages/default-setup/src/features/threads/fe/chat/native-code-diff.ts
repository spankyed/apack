import { parsePatch } from 'diff'

export interface ClaudeCodeDiffRow {
  kind: 'hunk' | 'context' | 'add' | 'remove'
  text: string
  oldLine?: number
  newLine?: number
}

/** Invalid or truncated hunks fall back to unnumbered source, as native Code does. */
export function claudeCodeDiffRows(source: string): ClaudeCodeDiffRow[] | undefined {
  try {
    const hunks = parsePatch(source).flatMap(file => file.hunks)
    if (!hunks.length || hunks.some(hunk => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]
      .some(value => !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000))) return
    const rows: ClaudeCodeDiffRow[] = []
    for (const hunk of hunks) {
      rows.push({ kind: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` })
      let oldLine = hunk.oldStart, newLine = hunk.newStart
      for (const line of hunk.lines) {
        // The marker describes the previous row, rather than another line of code.
        if (line.startsWith('\\')) continue
        const text = line.slice(1)
        if (line.startsWith('+')) rows.push({ kind: 'add', text, newLine: newLine++ })
        else if (line.startsWith('-')) rows.push({ kind: 'remove', text, oldLine: oldLine++ })
        else if (line.startsWith(' ')) rows.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ })
        else return
      }
      if (oldLine !== hunk.oldStart + hunk.oldLines || newLine !== hunk.newStart + hunk.newLines) return
    }
    return rows
  } catch { return }
}
