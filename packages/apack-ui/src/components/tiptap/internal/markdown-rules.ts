import type MarkdownIt from 'markdown-it'

const configured = new WeakSet<MarkdownIt>()

/** Application Markdown rules shared by editor parsing and read-only rendering. */
export function configureMarkdownRules(markdownit: MarkdownIt): void {
  if (configured.has(markdownit)) return
  configured.add(markdownit)
  markdownit.core.ruler.after('block', 'fix-empty-task-items', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'inline' && /^\[[ xX]\]$/.test(token.content)) {
        token.content += ' '
      }
    }
  })

  // Convert &nbsp;-only paragraphs back to empty paragraphs
  markdownit.core.ruler.push('strip-nbsp-empty-lines', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'inline' && token.content === '\u00a0') {
        token.content = ''
        token.children = []
      }
    }
  })

  // Don't render backtick-space content as inline code (e.g. ` text`)
  markdownit.core.ruler.push('no-spaced-code-inline', (state) => {
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue
      for (const child of token.children) {
        if (child.type === 'code_inline' && child.content.startsWith(' ')) {
          Object.assign(child, { type: 'text', tag: '', markup: '', content: `\`${child.content}\`` })
        }
      }
    }
  })
}
