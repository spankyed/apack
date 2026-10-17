import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface ClaudePromptDocument {
  text: string
  cursor: number
  /** Document identity at dispatch time: late replies cannot rewrite a newer document. */
  doc: ProseMirrorNode
  position: number
}
export type ClaudePromptSerializer = (doc: ProseMirrorNode) => string

/** Locate a caret in the submitted Markdown without mistaking a document offset for text. */
export function captureClaudePromptDocument(doc: ProseMirrorNode, position: number, serialize: ClaudePromptSerializer): ClaudePromptDocument | undefined {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return
  const resolved = doc.resolve(position)
  if (!resolved.parent.isTextblock) return
  const text = serialize(doc)
  let marker = '\uE000apackCursor\uE001'
  while (text.includes(marker)) marker += '\uE002'
  const marked = doc.replace(position, position, new Slice(Fragment.from(doc.type.schema.text(marker, resolved.marks())), 0, 0))
  const encoded = serialize(marked)
  const cursor = encoded.indexOf(marker)
  if (cursor < 0 || encoded.indexOf(marker, cursor + marker.length) >= 0 || encoded.slice(0, cursor) + encoded.slice(cursor + marker.length) !== text) return
  return { text, cursor, doc, position }
}

/** Match exact serialized boundaries; syntax and atoms are never guessed through. */
export function findClaudePromptPosition(doc: ProseMirrorNode, offset: number, serialize: ClaudePromptSerializer, bias: -1 | 0 | 1 = 0): number | undefined {
  if (!Number.isInteger(offset) || offset < 0) return
  let found: number | undefined, distance = Infinity
  doc.descendants((node, position) => {
    if (distance === 0) return false
    if (!node.isTextblock) return
    let low = position + 1, high = position + node.nodeSize - 1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const projected = captureClaudePromptDocument(doc, middle, serialize)
      if (!projected) break
      if (projected.cursor === offset) { found = middle; distance = 0; break }
      const delta = projected.cursor - offset
      if (bias && Math.sign(delta) === bias && Math.abs(delta) < distance) { found = middle; distance = Math.abs(delta) }
      if (projected.cursor < offset) low = middle + 1
      else high = middle - 1
    }
    return false
  })
  return found
}

/** Keep original nodes/marks and reference attributes when the native rewrite is representable. */
export function rewriteClaudePromptDocument(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer): { doc: ProseMirrorNode; position: number } | undefined {
  if (!Number.isInteger(frame.cursor) || frame.cursor < 0 || frame.cursor > frame.text.length) return
  const original = snapshot.text
  let start = 0
  while (start < original.length && start < frame.text.length && original[start] === frame.text[start]) start++
  let end = original.length, replacementEnd = frame.text.length
  while (end > start && replacementEnd > start && original[end - 1] === frame.text[replacementEnd - 1]) { end--; replacementEnd-- }
  let doc = snapshot.doc
  if (original !== frame.text) {
    const from = findClaudePromptPosition(doc, start, serialize), to = findClaudePromptPosition(doc, end, serialize)
    if (from === undefined || to === undefined) return
    let atom = false
    doc.nodesBetween(from, to, node => { if (node.isAtom && !node.isText) atom = true })
    if (atom) return
    const replacement = frame.text.slice(start, replacementEnd)
    const marks = doc.resolve(from).marks()
    try { doc = doc.replace(from, to, new Slice(replacement ? Fragment.from(doc.type.schema.text(replacement, marks)) : Fragment.empty, 0, 0)) } catch { return }
    if (serialize(doc) !== frame.text) return
  }
  const position = frame.cursor === snapshot.cursor && doc === snapshot.doc ? snapshot.position : findClaudePromptPosition(doc, frame.cursor, serialize)
  return position === undefined ? undefined : { doc, position }
}
