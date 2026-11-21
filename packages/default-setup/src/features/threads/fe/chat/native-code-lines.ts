import { all, createLowlight } from 'lowlight'
import type { ClaudeCodeDiffRow } from './native-code-diff.ts'

const highlighter = createLowlight(all)
export interface ClaudeCodeToken { text: string; classes: string[] }

/** Highlight once, then split tokens across rows without losing multiline grammar state. */
export function claudeCodeLines(source: string, language?: string, path?: string): ClaudeCodeToken[][] {
  const candidate = pathLanguage(path)
  const hint = language ?? (candidate && highlighter.registered(candidate) ? candidate : shebangLanguage(source))
  if (!hint || !highlighter.registered(hint)) return source.split('\n').map(text => [{ text, classes: [] }])
  try {
    const tree = highlighter.highlight(hint, source)
    const lines: ClaudeCodeToken[][] = [[]]
    function visit(node: (typeof tree.children)[number], classes: string[]) {
      if (node.type === 'text') {
        const parts = node.value.split('\n')
        for (const [index, text] of parts.entries()) {
          if (index) lines.push([])
          if (text) lines.at(-1)!.push({ text, classes })
        }
      } else if (node.type === 'element') {
        const names = node.properties.className
        const next = Array.isArray(names) ? [...classes, ...names.filter((name): name is string => typeof name === 'string')] : classes
        for (const child of node.children) visit(child, next)
      }
    }
    for (const node of tree.children) visit(node, [])
    return lines
  } catch { return source.split('\n').map(text => [{ text, classes: [] }]) }
}

function pathLanguage(path?: string): string | undefined {
  if (!path) return
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? ''
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile'
  const extension = name.match(/\.([\w+-]+)$/)?.[1]
  if (extension && ['jsx', 'mjs', 'cjs'].includes(extension)) return 'javascript'
  if (extension && ['tsx', 'mts', 'cts'].includes(extension)) return 'typescript'
  return extension
}
function shebangLanguage(source: string): string | undefined {
  const line = source.split('\n', 1)[0]
  if (!line.startsWith('#!')) return
  if (/\bpython[\d.]*\b/.test(line)) return 'python'
  if (/\b(?:node|nodejs)\b/.test(line)) return 'javascript'
  if (/\b(?:bash|sh|zsh|fish)\b/.test(line)) return 'bash'
  if (/\bruby\b/.test(line)) return 'ruby'
  if (/\bperl\b/.test(line)) return 'perl'
}

/** Highlight each side separately so removed text cannot change the new side's grammar state. */
export function claudeCodeDiffLines(rows: ClaudeCodeDiffRow[], language?: string, path?: string): ClaudeCodeToken[][] {
  const result: ClaudeCodeToken[][] = []
  for (let start = 0; start < rows.length;) {
    const header = rows[start++]
    result.push([{ text: header.text, classes: [] }])
    let end = start
    while (end < rows.length && rows[end].kind !== 'hunk') end++
    const hunk = rows.slice(start, end)
    const oldLines = claudeCodeLines(hunk.filter(row => row.oldLine !== undefined).map(row => row.text).join('\n'), language, path)
    const newLines = claudeCodeLines(hunk.filter(row => row.newLine !== undefined).map(row => row.text).join('\n'), language, path)
    let oldIndex = 0, newIndex = 0
    for (const row of hunk) {
      result.push(row.kind === 'remove' ? oldLines[oldIndex] : newLines[newIndex])
      if (row.oldLine !== undefined) oldIndex++
      if (row.newLine !== undefined) newIndex++
    }
    start = end
  }
  return result
}
