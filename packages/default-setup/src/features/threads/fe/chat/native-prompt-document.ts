import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface ClaudePromptDocument {
  text: string
  cursor: number
  /** Document identity at dispatch time: late replies cannot rewrite a newer document. */
  doc: ProseMirrorNode
  position: number
}
export type ClaudePromptSerializer = (doc: ProseMirrorNode) => string

/** Locate a caret in the submitted Markdown without mistaking a document offset for text. */
export function captureClaudePromptDocument(doc: ProseMirrorNode, position: number, serialize: ClaudePromptSerializer, marks?: readonly Mark[]): ClaudePromptDocument | undefined {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return
  const resolved = doc.resolve(position)
  if (!resolved.parent.isTextblock) return
  const text = serialize(doc)
  // The app's Markdown extension spells its empty paragraph as &nbsp;, not user draft text.
  if ((text === '' || text === '&nbsp;') && doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && !doc.firstChild.content.size) {
    return { text: '', cursor: 0, doc, position }
  }
  let marker = '\uE000apackCursor\uE001'
  while (text.includes(marker)) marker += '\uE002'
  const marked = doc.replace(position, position, new Slice(Fragment.from(doc.type.schema.text(marker, marks ?? resolved.marks())), 0, 0))
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
function rewriteClaudePromptText(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer): { doc: ProseMirrorNode; position: number } | undefined {
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


/** Apply native Markdown structure through the editor schema while retaining unchanged atom attributes. */
export function rewriteClaudePromptDocument(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer, parse?: (text: string) => ProseMirrorNode, offsets: readonly number[] = []): { doc: ProseMirrorNode; position: number; storedMarks?: readonly Mark[]; normalized?: boolean; sourcePositions?: ReadonlyMap<number, number> } | undefined {
  const textOnly = rewriteClaudePromptText(snapshot, frame, serialize)
  if (textOnly || !parse || !Number.isInteger(frame.cursor) || frame.cursor < 0 || frame.cursor > frame.text.length) return textOnly
  try {
    const originalAtoms = new Map<string, ProseMirrorNode[]>()
    let unmappable = false
    const token = (doc: ProseMirrorNode, node: ProseMirrorNode, position: number): string | undefined => {
      const start = captureClaudePromptDocument(doc, position, serialize), end = captureClaudePromptDocument(doc, position + node.nodeSize, serialize)
      return start && end && end.cursor > start.cursor ? start.text.slice(start.cursor, end.cursor) : undefined
    }
    snapshot.doc.descendants((node, position) => {
      if (!node.isAtom || node.isText) return
      const text = token(snapshot.doc, node, position)
      if (!text) { unmappable = true; return false }
      const atoms = originalAtoms.get(text) ?? []; atoms.push(node); originalAtoms.set(text, atoms)
      return false
    })
    if (unmappable) return
    const parsed = parse(frame.text)
    // Parse all requested source boundaries together, avoiding a parse per decoration.
    const canonicalSource = serialize(parsed) === frame.text
    const requested = [...new Set([frame.cursor, ...(canonicalSource ? [] : offsets)])].sort((a, b) => a - b)
    if (requested.some(offset => !Number.isInteger(offset) || offset < 0 || offset > frame.text.length)) return
    let prefix = '\uE000apackNativeOffset'
    while (frame.text.includes(prefix)) prefix += '\uE002'
    const markers = requested.map((offset, index) => ({ offset, marker: prefix + index + '\uE001' }))
    const parts: string[] = []; let previous = 0
    for (const { offset, marker } of markers) { parts.push(frame.text.slice(previous, offset), marker); previous = offset }
    parts.push(frame.text.slice(previous))
    const marked = parse(parts.join(''))
    const found: { index: number; position: number; length: number; marks: readonly Mark[] }[] = []
    const pattern = new RegExp(prefix + '(\\d+)\uE001', 'g')
    marked.descendants((node, position) => {
      if (!node.isText) return
      for (const match of node.text!.matchAll(pattern)) found.push({ index: Number(match[1]), position: position + match.index!, length: match[0].length, marks: node.marks })
    })
    if (found.length !== markers.length || new Set(found.map(value => value.index)).size !== markers.length || found.some(value => !markers[value.index])) return
    found.sort((a, b) => a.position - b.position)
    const sourcePositions = new Map<number, number>(); let removed = 0, markerMarks: readonly Mark[] = []
    for (const value of found) {
      const offset = markers[value.index]!.offset
      sourcePositions.set(offset, value.position - removed); removed += value.length
      if (offset === frame.cursor) markerMarks = value.marks
    }
    const clean = (node: ProseMirrorNode): ProseMirrorNode | undefined => {
      if (node.isText) { const text = node.text!.replace(pattern, ''); return text ? node.type.schema.text(text, node.marks) : undefined }
      const children: ProseMirrorNode[] = []
      node.forEach(child => { const next = clean(child); if (next) children.push(next) })
      return node.copy(Fragment.from(children))
    }
    let doc = clean(marked)!
    // Source boundaries must not change Markdown interpretation or atom identity.
    if (!doc.eq(parsed)) return
    const markerPosition = sourcePositions.get(frame.cursor)
    if (markerPosition === undefined) return
    const replacements = new Map<number, ProseMirrorNode>(), used = new Map<string, number>()
    doc.descendants((node, position) => {
      if (!node.isAtom || node.isText) return
      const text = token(doc, node, position), originals = text ? originalAtoms.get(text) : undefined
      if (originals) {
        const index = used.get(text!) ?? 0, original = originals[index]
        if (!original || original.type !== node.type) { unmappable = true; return false }
        replacements.set(position, node.type.create(original.attrs, node.content, node.marks)); used.set(text!, index + 1)
      }
      return false
    })
    if (unmappable || [...originalAtoms].some(([text, atoms]) => used.get(text) !== atoms.length)) return
    const restore = (node: ProseMirrorNode, start: number): ProseMirrorNode => {
      const replacement = replacements.get(start)
      if (replacement) return replacement
      if (!node.childCount) return node
      const children: ProseMirrorNode[] = []
      node.forEach((child, offset) => children.push(restore(child, start + offset + (node.type.name === 'doc' ? 0 : 1))))
      return node.copy(Fragment.from(children))
    }
    doc = restore(doc, 0)
    const canonical = captureClaudePromptDocument(doc, markerPosition, serialize, markerMarks)
    if (!canonical) return
    return { doc, position: markerPosition, storedMarks: markerMarks, normalized: canonical.text !== frame.text || canonical.cursor !== frame.cursor, sourcePositions: canonicalSource ? undefined : sourcePositions }
  } catch { return }
}
