import { diffChars } from 'diff'
import { Selection } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface ClaudePromptDocument {
  text: string
  cursor: number
  /** Document identity at dispatch time: late replies cannot rewrite a newer document. */
  doc: ProseMirrorNode
  position: number
}
export type ClaudePromptSerializer = (doc: ProseMirrorNode) => string

export interface ClaudePromptRewrite {
  doc: ProseMirrorNode
  position: number
  storedMarks?: readonly Mark[]
  normalized?: boolean
  sourceEdit?: { before: ProseMirrorNode; step: ReplaceStep }
  sourcePositions?: ReadonlyMap<number, number>
  sourceOffsets?: ReadonlyMap<number, number>
}

export function isEmptyClaudePromptParagraph(doc: ProseMirrorNode): boolean {
  return doc.childCount === 1 && doc.firstChild?.type.name === 'paragraph' && !doc.firstChild.content.size
}

/** Locate a caret in the submitted Markdown without mistaking a document offset for text. */
export function captureClaudePromptDocument(doc: ProseMirrorNode, position: number, serialize: ClaudePromptSerializer, marks?: readonly Mark[]): ClaudePromptDocument | undefined {
  if (!Number.isInteger(position) || position < 0 || position > doc.content.size) return
  const text = serialize(doc)
  // The empty paragraph has one text boundary, including Select All's document-edge head.
  // The app's Markdown extension spells it as &nbsp;, not user draft text.
  if ((text === '' || text === '&nbsp;') && isEmptyClaudePromptParagraph(doc)) {
    return { text: '', cursor: 0, doc, position: 1 }
  }
  let resolved = doc.resolve(position)
  // Select All has a document-edge head. Project through structural wrappers only;
  // skipping a block attachment would invent a caret on the other side of an atom.
  if (!resolved.parent.isTextblock && (position === 0 || position === doc.content.size)) {
    const edge = Selection.findFrom(resolved, position === 0 ? 1 : -1, true)
    if (!edge) return
    let crossesAtom = false
    doc.nodesBetween(Math.min(position, edge.head), Math.max(position, edge.head), node => { if (node.isAtom && !node.isText) crossesAtom = true })
    if (crossesAtom) return
    position = edge.head
    resolved = doc.resolve(position)
  }
  if (!resolved.parent.isTextblock) return
  let marker = '\uE000apackCursor\uE001'
  while (text.includes(marker)) marker += '\uE002'
  const markerMarks = marks ?? resolved.marks()
  const insertMarker = (withMarks: readonly Mark[]) => serialize(doc.replace(position, position,
    new Slice(Fragment.from(doc.type.schema.text(marker, withMarks)), 0, 0)))
  const encoded = insertMarker(markerMarks)
  let cursor = encoded.indexOf(marker)
  if (cursor < 0 || encoded.indexOf(marker, cursor + marker.length) >= 0) return
  const before = encoded.slice(0, cursor), after = encoded.slice(cursor + marker.length)
  if (before + after !== text) {
    // Emphasis serializers move enclosed whitespace outside their delimiters. At that edge a
    // marked probe can pull spaces back inside. Accept an unmarked probe only if it proves
    // that the original serialized prompt is unchanged.
    if (markerMarks.length && (/\s$/.test(resolved.nodeBefore?.text ?? '') || /^\s/.test(resolved.nodeAfter?.text ?? ''))) {
      const alternate = insertMarker([])
      const at = alternate.indexOf(marker)
      if (at >= 0 && alternate.indexOf(marker, at + marker.length) < 0
          && alternate.slice(0, at) + alternate.slice(at + marker.length) === text) {
        return { text, cursor: at, doc, position }
      }
    }
    // Giving a blank paragraph text introduces Markdown paragraph separators.
    // Remove only that proven extra framing, and refuse ambiguous cursor offsets.
    if (resolved.depth !== 1 || resolved.parent.type.name !== 'paragraph' || resolved.parent.content.size) return
    const extra = before.length + after.length - text.length, candidates = new Set<number>()
    if (extra < 1 || extra > 2) return
    for (let left = 0; left <= extra; left++) {
      const right = extra - left
      if (before.endsWith('\n'.repeat(left)) && after.startsWith('\n'.repeat(right)) && before.slice(0, before.length - left) + after.slice(right) === text) candidates.add(before.length - left)
    }
    if (candidates.size !== 1) return
    cursor = candidates.values().next().value!
  }
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
function rewriteClaudePromptText(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer): ClaudePromptRewrite | undefined {
  if (!Number.isInteger(frame.cursor) || frame.cursor < 0 || frame.cursor > frame.text.length) return
  const original = snapshot.text
  let start = 0
  while (start < original.length && start < frame.text.length && original[start] === frame.text[start]) start++
  let end = original.length, replacementEnd = frame.text.length
  while (end > start && replacementEnd > start && original[end - 1] === frame.text[replacementEnd - 1]) { end--; replacementEnd-- }
  let doc = snapshot.doc
  let sourceEdit: ClaudePromptRewrite['sourceEdit']
  if (original !== frame.text) {
    const from = findClaudePromptPosition(doc, start, serialize), to = findClaudePromptPosition(doc, end, serialize)
    if (from === undefined || to === undefined) return
    let atom = false
    doc.nodesBetween(from, to, node => { if (node.isAtom && !node.isText) atom = true })
    if (atom) return
    const replacement = frame.text.slice(start, replacementEnd)
    const resolvedFrom = doc.resolve(from), resolvedTo = doc.resolve(to)
    const slice = new Slice(replacement ? Fragment.from(doc.type.schema.text(replacement, resolvedFrom.marks())) : Fragment.empty, 0, 0)
    const step = new ReplaceStep(from, to, slice)
    const changed = step.apply(doc).doc
    if (!changed || serialize(changed) !== frame.text) return
    // Keep the literal block's edit map so its reference offsets move with their tokens.
    if (resolvedFrom.parent === resolvedTo.parent && resolvedFrom.parent.type.name === 'claudePromptSource') sourceEdit = { before: doc, step }
    doc = changed
  }
  const position = frame.cursor === snapshot.cursor && doc === snapshot.doc ? snapshot.position : findClaudePromptPosition(doc, frame.cursor, serialize)
  return position === undefined ? undefined : { doc, position, sourceEdit }
}


/** Project normalized source offsets; unchanged spans retain their exact UTF-16 distance. */
function normalizedClaudePromptOffsets(source: string, canonical: string, offsets: readonly number[]): ReadonlyMap<number, number> | undefined {
  // A pathological normalization must not block the editor indefinitely.
  const changes = diffChars(source, canonical, {timeout: 100})
  if (!changes) return
  const requested = [...new Set(offsets)].sort((a, b) => a - b), mapped = new Map<number, number>()
  let from = 0, to = 0, index = 0
  for (const change of changes) {
    if (change.added) { to += change.value.length; continue }
    const end = from + change.value.length
    while (index < requested.length && requested[index]! <= end) {
      const offset = requested[index++]!
      mapped.set(offset, to + (change.removed ? 0 : offset - from))
    }
    from = end
    if (!change.removed) to += change.value.length
  }
  return mapped.size === requested.length ? mapped : undefined
}

/** Expose visible list boundaries while leaving other Markdown offsets for the verified parse. */
function listPaintBoundaries(source: string, canonical: string, offsets: readonly number[]): Map<number, number> | undefined {
  const rawLines = source.split('\n'), canonicalLines = canonical.split('\n')
  if (rawLines.length !== canonicalLines.length) return
  const requested = [...new Set(offsets)].sort((a, b) => a - b), boundaries = new Map<number, number>()
  let start = 0, index = 0, moved = false
  for (const [lineIndex, raw] of rawLines.entries()) {
    const normalized = canonicalLines[lineIndex]!
    const end = start + raw.length
    let visibleStart = start
    if (raw !== normalized && index < requested.length && requested[index]! <= end) {
      const marker = /^( *)([*+-]|[0-9]{1,9}[.)])[ \t]+(?=\S)/
      const before = marker.exec(raw), after = marker.exec(normalized)
      if (before && after && raw.slice(before[0].length) === normalized.slice(after[0].length)) {
        const ordered = before[2]!.length > 1
        // The ordered-list serializer right-aligns the numbers. The marked parse below verifies nesting.
        if (ordered === (after[2]!.length > 1) && (ordered || before[1] === after[1])) {
          visibleStart += before[0].length
        }
      }
    }
    while (index < requested.length && requested[index]! <= end) {
      const offset = requested[index++]!
      const visible = Math.max(offset, visibleStart)
      moved ||= visible !== offset
      boundaries.set(offset, visible)
    }
    start = end + 1
  }
  if (moved && boundaries.size === requested.length) return boundaries
}

/** Apply native Markdown structure through the editor schema while retaining unchanged atom attributes. */
export function rewriteClaudePromptDocument(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer, parse?: (text: string) => ProseMirrorNode, offsets: readonly number[] = []): ClaudePromptRewrite | undefined {
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
    const canonicalText = serialize(parsed), canonicalSource = canonicalText === frame.text
    const requested = [...new Set([frame.cursor, ...(canonicalSource ? [] : offsets)])].sort((a, b) => a - b)
    if (requested.some(offset => !Number.isInteger(offset) || offset < 0 || offset > frame.text.length)) return
    const locate = (requested: readonly number[]) => {
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
      const doc = clean(marked)!
      // Source boundaries must not change Markdown interpretation or atom identity.
      if (!doc.eq(parsed)) return
      return {doc, sourcePositions, markerMarks}
    }
    let located = locate(requested), sourceOffsets: ReadonlyMap<number, number> | undefined
    if (!located && !canonicalSource && offsets.length) {
      // A global diff is quadratic across many normalized list markers. Probe the visible
      // list boundaries directly, then verify the marked parse preserves the entire document.
      const boundaries = listPaintBoundaries(frame.text, canonicalText, offsets)
      if (boundaries) {
        located = locate([...new Set([frame.cursor, ...boundaries.values()])].sort((a, b) => a - b))
        if (located) {
          const sourcePositions = new Map([[frame.cursor, located.sourcePositions.get(frame.cursor)!]])
          for (const [offset, visible] of boundaries) {
            if (offset !== frame.cursor) sourcePositions.set(offset, located.sourcePositions.get(visible)!)
          }
          located = { ...located, sourcePositions }
        }
      }
    }
    if (!located && !canonicalSource && offsets.length) {
      // Paint may touch hidden delimiters even when the native caret and document are valid.
      // Verify the caret separately, then project paint inward through canonical serialization.
      located = locate([frame.cursor])
      if (!located) return
      // A diff timeout leaves only the exact caret position available for paint.
      sourceOffsets = normalizedClaudePromptOffsets(frame.text, canonicalText, offsets)
    }
    if (!located) return
    let {doc} = located
    const {sourcePositions, markerMarks} = located
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
    return { doc, position: markerPosition, storedMarks: markerMarks, normalized: canonical.text !== frame.text || canonical.cursor !== frame.cursor, sourcePositions: canonicalSource ? undefined : sourcePositions, sourceOffsets }
  } catch { return }
}
