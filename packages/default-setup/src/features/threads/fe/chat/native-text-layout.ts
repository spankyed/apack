import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'
import type { ClaudeUiTextWrap } from '#features/code/be/services/claude-code/ui-presentation.ts'

export interface ClaudeTextCut { head: number; tail: number; ellipsis: boolean }
export type ClaudeTextMeasure = (start: number, end: number) => number

/** Offsets address original UTF-16 text; cuts never split a displayed grapheme. */
export function claudeTextCut(text: string, width: number, mode: ClaudeUiTextWrap, measure: ClaudeTextMeasure, ellipsisWidth: number): ClaudeTextCut {
  const full = { head: text.length, tail: text.length, ellipsis: false }
  if (mode === 'wrap' || measure(0, text.length) <= width) return full
  if (width < ellipsisWidth || width <= 0) return { head: 0, tail: text.length, ellipsis: false }
  const edges = [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.index + part.segment.length)]
  function prefix(budget: number) {
    let low = 0, high = edges.length - 1
    while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure(0, edges[mid]!) <= budget) low = mid; else high = mid - 1 }
    return edges[low]!
  }
  function suffix(budget: number) {
    let low = 0, high = edges.length - 1
    while (low < high) { const mid = Math.floor((low + high) / 2); if (measure(edges[mid]!, text.length) <= budget) high = mid; else low = mid + 1 }
    return edges[low]!
  }
  const available = Math.max(0, width - ellipsisWidth)
  if (mode === 'truncate-start') return { head: 0, tail: suffix(available), ellipsis: true }
  if (mode === 'middle' || mode === 'truncate-middle') {
    const first = prefix(width / 2), tail = suffix(Math.max(0, available - measure(0, first)))
    return { head: prefix(Math.max(0, available - measure(tail, text.length))), tail, ellipsis: true }
  }
  return { head: prefix(available), tail: text.length, ellipsis: true }
}

/** Text and Link are inline; other components keep their own layout/lifetime. */
export function claudeInlineText(node: ClaudeUiNode): string | undefined {
  if (node.kind !== 'text' && node.kind !== 'link') return
  let text = node.kind === 'text' ? node.text : ''
  for (const child of node.children ?? []) { const content = claudeInlineText(child); if (content === undefined) return; text += content }
  return text
}

function sliceText(node: ClaudeUiNode, start: number, end: number): ClaudeUiNode | undefined {
  if (node.kind !== 'text' && node.kind !== 'link') return
  let offset = node.kind === 'text' ? node.text.length : 0
  const text = node.kind === 'text' ? node.text.slice(start, end) : ''
  const children: ClaudeUiNode[] = []
  for (const child of node.children ?? []) {
    const length = claudeInlineText(child)!.length
    if (end > offset && start < offset + length) { const clipped = sliceText(child, Math.max(0, start - offset), Math.min(length, end - offset)); if (clipped) children.push(clipped) }
    offset += length
  }
  if (!text && !children.length) return
  return node.kind === 'text' ? { ...node, text, children } : { ...node, children }
}

/** Keep surviving native spans, links and attribution; never mutate the source drawing. */
export function cutClaudeTextNode(node: Extract<ClaudeUiNode, { kind: 'text' }>, cut: ClaudeTextCut): Extract<ClaudeUiNode, { kind: 'text' }> {
  const text = claudeInlineText(node)
  if (text === undefined || (cut.head === text.length && cut.tail === text.length && !cut.ellipsis)) return node
  const children: ClaudeUiNode[] = []
  const head = sliceText(node, 0, cut.head), tail = sliceText(node, cut.tail, text.length)
  if (head) children.push(head)
  if (cut.ellipsis) children.push({ kind: 'text', text: '…' })
  if (tail) children.push(tail)
  return { ...node, text: '', children }
}
