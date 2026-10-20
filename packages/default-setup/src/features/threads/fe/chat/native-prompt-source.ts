import { Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { ContextReference } from '#generated/types.ts'
import { captureClaudePromptDocument, type ClaudePromptDocument, type ClaudePromptSerializer, type rewriteClaudePromptDocument } from './native-prompt-document.ts'

interface ClaudeSourceReference { text: string; reference: ContextReference }

/** Literal Markdown is needed when a native caret addresses syntax hidden by rich nodes. */
export const ClaudePromptSource = Node.create({
  name: 'claudePromptSource', group: 'block', content: 'text*', marks: '',
  code: true, defining: true, isolating: true, whitespace: 'pre',
  addAttributes: () => ({ references: { default: [] } }),
  parseHTML: () => [{ tag: 'div[data-claude-prompt-source]' }],
  renderHTML: () => ['div', { 'data-claude-prompt-source': '', style: 'white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,monospace' }, 0],
  addStorage: () => ({ markdown: { serialize(state: MarkdownSerializerState, node: ProseMirrorNode) { state.write(node.textContent); state.closeBlock(node) } } }),
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.isActive(this.name) && this.editor.commands.insertContent({ type: 'text', text: '\n' }) }
  },
})

function occurrences(text: string, token: string): number {
  if (!token) return 0
  let count=0,from=0,index: number
  while ((index=text.indexOf(token,from))>=0) { count++;from=index+token.length }
  return count
}

/** A person changing a raw link must not retain context for its former target. */
function retainedReferences(node: ProseMirrorNode): ClaudeSourceReference[] {
  if (node.type.name !== 'claudePromptSource' || !Array.isArray(node.attrs.references)) return []
  const available=new Map<string,number>(),retained: ClaudeSourceReference[]=[]
  for (const value of node.attrs.references as ClaudeSourceReference[]) {
    if (!value || typeof value.text !== 'string' || !value.text || !value.reference) continue
    const count=available.get(value.text) ?? occurrences(node.textContent,value.text)
    if (count>0) { retained.push(value);available.set(value.text,count-1) }
  }
  return retained
}

export function claudePromptSourceReferences(node: ProseMirrorNode): ContextReference[] {
  return retainedReferences(node).map(value=>({...value.reference}))
}

/** Keep exact source/caret and unchanged reference identities; never guess through missing atoms. */
export function rewriteClaudePromptSource(snapshot: ClaudePromptDocument, frame: { text: string; cursor: number }, serialize: ClaudePromptSerializer): ReturnType<typeof rewriteClaudePromptDocument> {
  const type=snapshot.doc.type.schema.nodes.claudePromptSource
  if (!type || !Number.isInteger(frame.cursor) || frame.cursor<0 || frame.cursor>frame.text.length) return
  const references: ClaudeSourceReference[]=[]
  let unmappable=false
  snapshot.doc.descendants((node,position)=>{
    if (node.type.name==='claudePromptSource') { references.push(...retainedReferences(node));return false }
    if (!node.isAtom || node.isText) return
    if (node.type.name!=='reference' || !node.isInline) { unmappable=true;return false }
    const start=captureClaudePromptDocument(snapshot.doc,position,serialize),end=captureClaudePromptDocument(snapshot.doc,position+node.nodeSize,serialize)
    if (!start || !end || end.cursor<=start.cursor) { unmappable=true;return false }
    references.push({text:start.text.slice(start.cursor,end.cursor),reference:{...node.attrs} as ContextReference})
    return false
  })
  if (unmappable) return
  const counts=new Map<string,number>()
  for (const value of references) counts.set(value.text,(counts.get(value.text)??0)+1)
  for (const [text,count] of counts) if (occurrences(frame.text,text)!==count) return
  try {
    const content=frame.text?snapshot.doc.type.schema.text(frame.text):undefined
    const doc=snapshot.doc.type.create(null,type.create({references},content)),position=frame.cursor+1
    if (serialize(doc)!==frame.text) return
    const captured=captureClaudePromptDocument(doc,position,serialize)
    return captured?.cursor===frame.cursor?{doc,position}:undefined
  } catch { return }
}
