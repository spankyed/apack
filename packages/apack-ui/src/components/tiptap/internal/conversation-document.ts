import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { conversationMessageNodeName } from '../extensions.ts'

export interface ConversationMessage {
  id: string
  text: string
}

interface ParsedMessage {
  text: string
  node: ProseMirrorNode
}

// captureTransaction does not reset capture after a thrown callback. Propagate errors only once it ends.
function parseMarkdown(editor: Editor, message: ConversationMessage) {
  let failure: { error: unknown } | undefined
  const transaction = editor.captureTransaction(() => {
    try {
      if (!editor.commands.setContent(message.text, { emitUpdate: false })) throw new Error(`Message content was refused: ${message.id}`)
    } catch (error) { failure = { error } }
  })
  if (failure) throw failure.error
  if (!transaction) throw new Error(`Message content produced no document: ${message.id}`)
  return transaction.doc.content
}

/** A cache belongs to one schema/editor lifetime. Markdown still goes through its contributed commands. */
export function createConversationDocument(editor: Editor) {
  const messageNode = editor.schema.nodes[conversationMessageNodeName]
  let previous = new Map<string, ParsedMessage>()

  return (messages: readonly ConversationMessage[]) => {
    const next = new Map<string, ParsedMessage>()
    const nodes = messages.map(message => {
      const { id, text } = message
      if (next.has(id)) throw new Error(`Duplicate conversation message: ${id}`)
      const cached = previous.get(id)
      const entry = cached?.text === text ? cached
        : { text, node: messageNode.createChecked({ id }, parseMarkdown(editor, message)) }
      next.set(id, entry)
      return entry.node
    })
    const current = editor.state.doc
    const sameOrder = current.childCount === nodes.length
      && nodes.every((node, index) => current.child(index).type === node.type && current.child(index).attrs.id === node.attrs.id)
    const transaction = editor.state.tr
    if (sameOrder) {
      let end = current.content.size
      for (let index = nodes.length - 1; index >= 0; index--) {
        const old = current.child(index)
        const start = end - old.nodeSize
        if (!old.eq(nodes[index])) transaction.replaceWith(start, end, nodes[index])
        end = start
      }
    } else {
      let prefix = 0
      let from = 0
      while (prefix < Math.min(current.childCount, nodes.length) && current.child(prefix).eq(nodes[prefix])) {
        from += current.child(prefix++).nodeSize
      }
      let oldEnd = current.childCount
      let newEnd = nodes.length
      let to = current.content.size
      while (oldEnd > prefix && newEnd > prefix && current.child(oldEnd - 1).eq(nodes[newEnd - 1])) {
        to -= current.child(--oldEnd).nodeSize
        newEnd--
      }
      if (from !== to || prefix !== newEnd) transaction.replaceWith(from, to, nodes.slice(prefix, newEnd))
    }
    if (transaction.docChanged) editor.view.dispatch(transaction.setMeta('addToHistory', false))
    previous = next
  }
}
