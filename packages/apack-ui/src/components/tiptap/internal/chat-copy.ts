import { Editor } from '@tiptap/core'
import { DOMParser, type Fragment } from '@tiptap/pm/model'
import type { TextEditorExtensionsBinding } from '@apackdev/sdk/fe'
import { formatReferenceHref } from '@apackdev/sdk/fe/references'
import { createExtensions } from '../extensions.ts'

/** Reuse the editor's Markdown clipboard contract on demand, outside message construction. */
export function copyChatSelection(event: ClipboardEvent, root: HTMLElement, groups: readonly TextEditorExtensionsBinding[]): void {
  const selection = root.ownerDocument.getSelection()
  if (!event.clipboardData || !selection?.rangeCount || selection.isCollapsed) return
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return
  let fragment: Node = range.cloneContents()
  // cloneContents omits the common ancestor; retain marks/blocks for partial selections.
  for (let ancestor = range.commonAncestorContainer; ancestor !== root; ancestor = ancestor.parentNode!) {
    if (ancestor.nodeType !== 1) continue
    const wrapper = ancestor.cloneNode(false)
    wrapper.appendChild(fragment)
    fragment = wrapper
  }
  const container = document.createElement('div')
  container.appendChild(fragment)
  for (const decoration of container.querySelectorAll('.code-block-copy-btn,.ProseMirror-trailingBreak,.ProseMirror-separator')) decoration.remove()
  for (const pill of container.querySelectorAll<HTMLElement>('.reference-pill[data-ref-id]')) {
    const anchor = document.createElement('a')
    anchor.href = formatReferenceHref({ type: pill.dataset.refType!, id: pill.dataset.refId! })
    anchor.textContent = pill.querySelector('.reference-pill-label')?.textContent ?? ''
    pill.replaceWith(anchor)
  }
  const editor = new Editor({ element: document.createElement('div'), editable: false, extensions: createExtensions({
    mode: 'viewer', variant: 'chat', injectedExtensions: groups.flatMap(group => Object.values(group.binding.extensions ?? {})),
  }) })
  try {
    const slice = DOMParser.fromSchema(editor.schema).parseSlice(container)
    const storage = editor.storage as typeof editor.storage & { markdown: { serializer: { serialize(content: Fragment): string } } }
    const markdown = storage.markdown.serializer.serialize(slice.content)
    event.clipboardData.setData('text/plain', markdown)
    event.clipboardData.setData('text/html', container.innerHTML)
    event.preventDefault()
  } finally { editor.destroy() }
}
