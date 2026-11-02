import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'

const COPY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'

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

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'code-block-copy-btn'
      button.setAttribute('aria-label', 'Copy code')
      button.contentEditable = 'false'
      button.innerHTML = COPY_SVG

      let resetTimer: ReturnType<typeof setTimeout> | null = null
      button.addEventListener('mousedown', (e) => { e.preventDefault() })
      button.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(code.textContent ?? '')
          button.innerHTML = CHECK_SVG
          button.classList.add('is-copied')
          if (resetTimer) clearTimeout(resetTimer)
          resetTimer = setTimeout(() => {
            button.innerHTML = COPY_SVG
            button.classList.remove('is-copied')
          }, 1500)
        } catch {
          // clipboard unavailable — leave icon as-is
        }
      })

      wrapper.appendChild(button)
      wrapper.appendChild(pre)

      return {
        dom: wrapper,
        contentDOM: code,
        destroy: () => {
          if (resetTimer) clearTimeout(resetTimer)
        },
      }
    }
  },
})
