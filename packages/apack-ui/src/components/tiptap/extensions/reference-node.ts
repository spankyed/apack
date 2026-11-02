import { openEntity } from '@apackdev/sdk/fe'
import type { EARS } from '@apackdev/sdk'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import { formatReferenceHref, parseReferenceHref, getReferenceTypeDeclaration, onReferenceDeclarationsChanged } from '@apackdev/sdk/fe/references'

function createIconSvg(type: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  for (const [tag, attrs] of getReferenceTypeDeclaration(type)?.svgElements ?? []) {
    const el = document.createElementNS(ns, tag)
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v)
    }
    svg.appendChild(el)
  }

  return svg
}

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
      let currentNode = node
      const dom = document.createElement('span')
      dom.classList.add('reference-pill')
      dom.dataset.refType = node.attrs.refType
      dom.contentEditable = 'false'

      const icon = document.createElement('span')
      icon.classList.add('reference-pill-icon')
      icon.appendChild(createIconSvg(node.attrs.refType))

      const label = document.createElement('span')
      label.classList.add('reference-pill-label')
      label.textContent = node.attrs.label

      dom.appendChild(icon)
      dom.appendChild(label)
      const stopDeclarations = onReferenceDeclarationsChanged(() => {
        icon.replaceChildren(createIconSvg(currentNode.attrs.refType))
      })

      const onClick = (event: MouseEvent) => {
        if (editor.isEditable && !event.metaKey && !event.ctrlKey) return

        const refId = currentNode.attrs.refId as string

        if (typeof refId === 'string' && refId.includes('-')) openEntity(refId as EARS.EntityId)
      }
      dom.addEventListener('click', onClick)

      return {
        dom,
        destroy() {
          stopDeclarations()
          dom.removeEventListener('click', onClick)
        },
        update(updatedNode) {
          if (updatedNode.type.name !== 'reference') return false
          currentNode = updatedNode
          dom.dataset.refType = updatedNode.attrs.refType
          icon.replaceChildren(createIconSvg(updatedNode.attrs.refType))
          label.textContent = updatedNode.attrs.label
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
