import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createCodeCopyButton } from '../internal/code-copy-button.ts'

/**
 * CodeBlockLowlight with a copy button rendered in a wrapper around <pre>.
 * The <code> element remains the contentDOM so the lowlight plugin's
 * decorations keep applying syntax highlighting as usual.
 */
export const CodeBlockCopy = CodeBlockLowlight.extend({
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'code-block-wrapper'

      const pre = document.createElement('pre')
      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value != null) pre.setAttribute(key, String(value))
      }

      const code = document.createElement('code')
      if (node.attrs.language) {
        code.className = `language-${node.attrs.language}`
      }
      pre.appendChild(code)

      const { button, dispose } = createCodeCopyButton(code)

      wrapper.appendChild(button)
      wrapper.appendChild(pre)

      return {
        dom: wrapper,
        contentDOM: code,
        destroy: dispose,
      }
    }
  },
})
