import { parseClaudeDocument, type ClaudeStatusSpan } from '#extensions/blocks/display/native-status-text.ts'

/** Match original patch content to original painted rows; terminal gutters and padding are presentation only. */
export function projectClaudeThemePreview(patch: readonly string[], ansi: string): { kind: string; spans: ClaudeStatusSpan[] }[] | undefined {
  const rows: ClaudeStatusSpan[][] = [[]]
  for (const span of parseClaudeDocument(ansi)) {
    const parts = span.text.split('\n')
    for (const [index, text] of parts.entries()) {
      if (index) rows.push([])
      if (text) rows.at(-1)!.push({ ...span, text })
    }
  }
  const result: { kind: string; spans: ClaudeStatusSpan[] }[] = []
  let next = 0
  for (const line of patch) {
    const content = line.slice(1).trim(), kind = line[0]!
    if (![' ', '+', '-'].includes(kind)) return
    const index = rows.findIndex((row, index) => { const text = row.map(span => span.text).join(''); return index >= next && /^\s*\d+\s+[+-]?\s/.test(text) && text.trimEnd().endsWith(content) })
    if (index < 0) return
    const row = rows[index]!, plain = row.map(span => span.text).join(''), start = content ? plain.lastIndexOf(content) : plain.trimEnd().length
    let offset = 0
    const spans = row.flatMap(span => {
      const from = Math.max(0, start - offset), to = Math.min(span.text.length, start + content.length - offset)
      offset += span.text.length
      return to > from ? [{ ...span, text: span.text.slice(from, to) }] : []
    })
    // Preserve source indentation independently of the terminal's line-number gutter.
    const indent = line.slice(1).match(/^\s*/)?.[0] ?? ''
    if (indent) spans.unshift({ text: indent, style: {} })
    result.push({ kind, spans }); next = index + 1
  }
  return result
}
