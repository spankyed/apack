import { Node, type Editor } from '@tiptap/core'
import { DOMParser as PromptDOMParser, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { ContextReference } from '#generated/types.ts'
import { captureClaudePromptDocument, type ClaudePromptDocument, type ClaudePromptSerializer, type rewriteClaudePromptDocument } from './native-prompt-document.ts'

interface ClaudeSourceReference { text: string; reference: ContextReference; from?: number }
type PositionedSourceReference = ClaudeSourceReference & { from: number }

export function parseClaudePromptMarkdown(editor: Editor, text: string): ProseMirrorNode {
  const parser = (editor.storage as unknown as { markdown: { parser: { parse(text: string): string } } }).markdown.parser
  const template = document.createElement('template')
  template.innerHTML = parser.parse(text)
  return PromptDOMParser.fromSchema(editor.schema).parse(template.content)
}

/** Literal Markdown is needed when a native caret addresses syntax hidden by rich nodes. */
export const ClaudePromptSource = Node.create({
  name: 'claudePromptSource', group: 'block', content: 'text*', marks: '',
  code: true, defining: true, isolating: true, whitespace: 'pre',
  addAttributes: () => ({ references: { default: [] } }),
  parseHTML: () => [{ tag: 'div[data-claude-prompt-source]' }],
  renderHTML: () => ['div', { 'data-claude-prompt-source': '', style: 'white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace' }, 0],
  addStorage: () => ({ markdown: { serialize(state: MarkdownSerializerState, node: ProseMirrorNode) { state.write(node.textContent); state.closeBlock(node) } } }),
  addProseMirrorPlugins() {
    const parse = (text: string) => parseClaudePromptMarkdown(this.editor, text)
    return [new Plugin({
      appendTransaction(transactions, previous, current) {
        if (!transactions.some(transaction => transaction.docChanged)) return
        const mapping = new Mapping()
        for (const transaction of transactions) mapping.appendMapping(transaction.mapping)
        const update = current.tr
        previous.doc.descendants((node, position) => {
          if (node.type.name !== 'claudePromptSource') return
          if (!Array.isArray(node.attrs.references) || !node.attrs.references.length) return false
          const mapped = mapping.mapResult(position, 1)
          const next = current.doc.nodeAt(mapped.pos)
          // Full source rewrites and restored drafts supply their own reference metadata.
          if (mapped.deleted || next?.type !== node.type || next.attrs.references !== node.attrs.references) return false
          const mappedReferences = retainedReferences(node).flatMap(value => {
            const start = position + 1 + value.from
            const from = mapping.mapResult(start, 1)
            const to = mapping.mapResult(start + value.text.length, -1)
            const offset = from.pos - mapped.pos - 1
            if (from.deleted || to.deleted || offset < 0 || to.pos - from.pos !== value.text.length
              || next.textContent.slice(offset, offset + value.text.length) !== value.text) return []
            return [{ ...value, from: offset }]
          })
          const retained = mappedReferences.length && next.textContent !== node.textContent
            ? activeSourceReferences(next.textContent, mappedReferences, parse)
            : mappedReferences
          if (retained.length !== node.attrs.references.length || retained.some((value, index) => value.from !== node.attrs.references[index].from))
            update.setNodeMarkup(mapped.pos, undefined, { ...next.attrs, references: retained })
          return false
        })
        return update.docChanged ? update : undefined
      },
    })]
  },
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.isActive(this.name) && this.editor.commands.insertContent({ type: 'text', text: '\n' }) }
  },
})

function referenceOffsets(text: string, token: string): number[] {
  const offsets: number[] = []
  let from = 0, offset: number
  while ((offset = text.indexOf(token, from)) >= 0) {
    offsets.push(offset)
    from = offset + token.length
  }
  return offsets
}

/** Legacy drafts have no offsets. Retain their references only where the token count still matches. */
function positionSourceReferences(text: string, references: readonly ClaudeSourceReference[]): PositionedSourceReference[] {
  const positions = new Map<string, number[]>(), counts = new Map<string, number>()
  for (const value of references) counts.set(value.text, (counts.get(value.text) ?? 0) + 1)
  for (const [token, count] of counts) {
    const offsets = referenceOffsets(text, token)
    if (offsets.length === count) positions.set(token, offsets)
  }
  const used = new Map<string, number>()
  return references.flatMap(value => {
    const offsets = positions.get(value.text)
    if (!offsets) return []
    const index = used.get(value.text) ?? 0
    used.set(value.text, index + 1)
    return [{ ...value, from: offsets[index]! }]
  })
}

function retainedReferences(node: ProseMirrorNode): PositionedSourceReference[] {
  if (node.type.name !== 'claudePromptSource' || !Array.isArray(node.attrs.references)) return []
  const values = (node.attrs.references as ClaudeSourceReference[]).filter(value => value && typeof value.text === 'string' && value.text && value.reference)
  if (values.every(value => value.from === undefined)) return positionSourceReferences(node.textContent, values)
  return values.flatMap(value => {
    const from = value.from
    return from !== undefined && Number.isInteger(from) && from >= 0
      && node.textContent.slice(from, from + value.text.length) === value.text ? [{ ...value, from }] : []
  })
}

export function claudePromptSourceReferences(node: ProseMirrorNode): ContextReference[] {
  return retainedReferences(node).map(value=>({...value.reference}))
}

/** Confirm each occurrence is an active reference, including when identical text appears elsewhere. */
function activeSourceReferences(text: string, references: readonly PositionedSourceReference[], parse: (text: string) => ProseMirrorNode): PositionedSourceReference[] {
  let prefix = 'apackReferenceProbe'
  while (text.includes(prefix)) prefix += 'Z'
  const expected = new Map<string, PositionedSourceReference>()
  const parts: string[] = []
  let from = 0
  for (const [index, value] of [...references].sort((left, right) => left.from - right.from).entries()) {
    if (!value.text.startsWith('[')) continue
    const label = value.from + 1
    const marker = `${prefix}${index}Z`
    parts.push(text.slice(from, label), marker)
    expected.set(marker, value)
    from = label
  }
  parts.push(text.slice(from))
  // The marker belongs to a link label only if the regular editor parser recognizes the link.
  const markerAtLabelStart = new RegExp(`^${prefix}\\d+Z`)
  const active = new Set<PositionedSourceReference>()
  try {
    parse(parts.join('')).descendants(node => {
      if (node.type.name !== 'reference' || typeof node.attrs.label !== 'string') return
      const marker = markerAtLabelStart.exec(node.attrs.label)?.[0]
      const reference = marker ? expected.get(marker) : undefined
      if (reference && reference.reference.refType === node.attrs.refType && reference.reference.refId === node.attrs.refId) active.add(reference)
    })
  } catch { return [] }
  return references.filter(reference => active.has(reference))
}

/** Keep exact source/caret. Ordinary edits retain atom identity; explicit replacement may withdraw it. */
export function rewriteClaudePromptSource(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer, parse: (text: string) => ProseMirrorNode, allowAtomReplacement = false): ReturnType<typeof rewriteClaudePromptDocument> {
  const type=snapshot.doc.type.schema.nodes.claudePromptSource
  if (!type || !Number.isInteger(frame.cursor) || frame.cursor<0 || frame.cursor>frame.text.length) return
  const references: ClaudeSourceReference[]=[]
  let unmappable=false
  if (!allowAtomReplacement) snapshot.doc.descendants((node,position)=>{
    if (node.type.name==='claudePromptSource') { references.push(...retainedReferences(node));return false }
    if (!node.isAtom || node.isText) return
    // A hard break carries text, not an opaque reference identity. Full fills may explicitly replace other atoms.
    if (node.type.name==='hardBreak' && node.isInline) return false
    if (node.type.name!=='reference' || !node.isInline) { unmappable=true;return false }
    const start=captureClaudePromptDocument(snapshot.doc,position,serialize),end=captureClaudePromptDocument(snapshot.doc,position+node.nodeSize,serialize)
    if (!start || !end || end.cursor<=start.cursor) { unmappable=true;return false }
    references.push({text:start.text.slice(start.cursor,end.cursor),reference:{...node.attrs} as ContextReference})
    return false
  })
  if (unmappable) return
  const retained = positionSourceReferences(frame.text, references)
  if (retained.length !== references.length) return
  try {
    if (retained.length && activeSourceReferences(frame.text, retained, parse).length !== retained.length) return
    const content=frame.text?snapshot.doc.type.schema.text(frame.text):undefined
    const doc=snapshot.doc.type.create(null,type.create({references:retained},content)),position=frame.cursor+1
    if (serialize(doc)!==frame.text) return
    const captured=captureClaudePromptDocument(doc,position,serialize)
    return captured?.cursor===frame.cursor?{doc,position}:undefined
  } catch { return }
}
