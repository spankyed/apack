import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface ConversationMessage {
  id: string
  text: string
}

interface ParsedMessage {
  text: string
  node: ProseMirrorNode
}

/** A cache belongs to one schema/editor lifetime. Markdown still goes through its contributed commands. */
export function createConversationDocument(editor: Editor, nodeName: string) {
  let previous = new Map<string, ParsedMessage>()

  return (messages: readonly ConversationMessage[]) => {
    const next = new Map<string, ParsedMessage>()
    for (const message of messages) {
      if (next.has(message.id)) throw new Error(`Duplicate conversation message: ${message.id}`)
      const cached = previous.get(message.id)
      if (cached?.text === message.text) {
        next.set(message.id, cached)
        continue
      }
      // captureTransaction does not restore its capturing flag after a thrown callback.
      // Keep the callback nonthrowing and propagate command failures after capture has ended.
      let failure: unknown
      let failed = false
      const parsed = editor.captureTransaction(() => {
        try {
          if (!editor.commands.setContent(message.text, { emitUpdate: false })) {
            throw new Error(`Message content was refused: ${message.id}`)
          }
        } catch (error) { failed = true; failure = error }
      })
      if (failed) throw failure
      if (!parsed) throw new Error(`Message content produced no document: ${message.id}`)
      const node = editor.schema.nodes[nodeName].createChecked({ id: message.id }, parsed.doc.content)
      next.set(message.id, { text: message.text, node })
    }

    const nodes = Array.from(next.values(), entry => entry.node)
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
