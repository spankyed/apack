import { createReferencePill } from '../internal/reference-pill.ts'
import type { ReadOnlyTextRenderer } from '@apackdev/sdk/fe'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import { formatReferenceHref, parseReferenceHref } from '@apackdev/sdk/fe/references'


export const ReferenceNode = Node.create({
  name: 'reference',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      refType: { default: null },
      refId: { default: null },
      shortCode: { default: '' },
      label: { default: '' },
    }
  },

  parseHTML() {
    return [{
      tag: 'a[href^="apack-ref://"]',
      priority: 60,
      getAttrs(node: HTMLElement) {
        const target = parseReferenceHref(node.getAttribute('href') || '')
        if (!target) return false
        return { refType: target.type, refId: target.id, shortCode: node.getAttribute('data-short-code') || '', label: node.textContent || '' }
      },
    }]
  },

  renderHTML({ node }) {
    if (typeof node.attrs.refType !== 'string' || !node.attrs.refType || typeof node.attrs.refId !== 'string' || !node.attrs.refId) return ['span', { class: 'reference-pill' }, node.attrs.label]
    return [
      'a',
      mergeAttributes({
        href: formatReferenceHref({ type: node.attrs.refType, id: node.attrs.refId }),
        class: 'reference-pill',
        'data-ref-type': node.attrs.refType,
        'data-short-code': node.attrs.shortCode,
      }),
      node.attrs.label,
    ]
  },

  addNodeView() {
    return ({ node, editor }) => {
      const pill = createReferencePill({ type: node.attrs.refType, id: node.attrs.refId, label: node.attrs.label }, () => editor.isEditable)
      return {
        dom: pill.dom,
        destroy: pill.dispose,
        update(updatedNode) {
          if (updatedNode.type.name !== 'reference') return false
          pill.update({ type: updatedNode.attrs.refType, id: updatedNode.attrs.refId, label: updatedNode.attrs.label })
          return true
        },
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor
        const { selection } = state
        const { $from } = selection

        if (selection.empty && $from.nodeBefore?.type.name === 'reference') {
          const pos = $from.pos - $from.nodeBefore.nodeSize
          editor.chain().setTextSelection({ from: pos, to: $from.pos }).deleteSelection().run()
          return true
        }

        return false
      },
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          if (typeof node.attrs.refType !== 'string' || !node.attrs.refType || typeof node.attrs.refId !== 'string' || !node.attrs.refId) {
            state.text(node.attrs.label)
            return
          }
          state.write('[')
          state.text(node.attrs.label)
          state.write(`](${formatReferenceHref({ type: node.attrs.refType, id: node.attrs.refId })})`)
        },
      },
    }
  },
})

/** References retain their navigation and live icons without an editor view. */
export const ReadOnlyReferences: ReadOnlyTextRenderer = {
  decorate(root) {
    const cleanups: Array<() => void> = []
    try {
      for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="apack-ref://"]')) {
        const target = parseReferenceHref(anchor.getAttribute('href') ?? '')
        if (!target) continue
        const pill = createReferencePill({ ...target, label: anchor.textContent ?? '' })
        const separator = () => {
          const image = document.createElement('img')
          image.className = 'ProseMirror-separator'
          image.alt = ''
          return image
        }
        anchor.replaceWith(separator(), pill.dom, separator())
        if (pill.dom.parentElement?.tagName === 'P' && pill.dom.parentElement.lastChild === pill.dom.nextSibling) {
          const line = document.createElement('br')
          line.className = 'ProseMirror-trailingBreak'
          pill.dom.parentElement.appendChild(line)
        }
        cleanups.push(pill.dispose)
      }
    } catch (error) { for (const cleanup of cleanups.reverse()) cleanup(); throw error }
    return () => { for (const cleanup of cleanups.reverse()) cleanup() }
  },
}
