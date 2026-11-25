import { Node, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type MarkdownIt from 'markdown-it'
import { tex } from '@mdit/plugin-tex'
import katex from 'katex'

const activeParses = new WeakMap<Editor, boolean>()
const parserState = new WeakMap<MarkdownIt, boolean>()
const texRules = ['math_inline_dollar', 'math_inline_bracket', 'math_block_dollar', 'math_block_bracket']

/** A conversation viewer parses one message at a time using a shared Markdown parser. */
export function withTranscriptMath<T>(editor: Editor, enabled: boolean, parse: () => T): T {
  const before = activeParses.get(editor)
  activeParses.set(editor, enabled)
  try {
    return parse()
  } finally {
    if (before === undefined) activeParses.delete(editor)
    else activeParses.set(editor, before)
  }
}

function configureMathParser(md: MarkdownIt, enabled: boolean) {
  const before = parserState.get(md)
  if (before === enabled) return
  if (before === undefined && !enabled) return
  if (before === undefined) {
    md.use(tex, { delimiters: 'all', render: () => '' })
    // The parser's render callback omits the original delimiter. Keep it on the
    // ProseMirror node so copying the transcript preserves bracket-style TeX.
    const renderToken: NonNullable<MarkdownIt['renderer']['rules']['math_inline']> = (tokens, index) => {
      const token = tokens[index]!
      const display = token.type === 'math_block'
      const tag = display ? 'div' : 'span'
      const kind = display ? 'display' : 'inline'
      const bracket = token.markup.startsWith('\\') ? ' data-bracket-math' : ''
      return '<' + tag + ' data-transcript-math="' + kind + '"' + bracket + ' data-latex="' +
        md.utils.escapeHtml(token.content.trim()) + '"></' + tag + '>' + (display ? '\n' : '')
    }
    md.renderer.rules.math_inline = renderToken
    md.renderer.rules.math_block = renderToken
  } else if (enabled) {
    md.enable(texRules)
  } else {
    md.disable(texRules)
  }
  parserState.set(md, enabled)
}

function formatSource(latex: string, inline: boolean, bracketed: boolean) {
  const dollars = inline ? '$' : '$$'
  const [open, close] = bracketed ? (inline ? ['\\(', '\\)'] : ['\\[', '\\]']) : [dollars, dollars]
  const boundary = inline ? '' : '\n'
  return open + boundary + latex + boundary + close
}

function createMathNode(inline: boolean, enabled: () => boolean) {
  const element = inline ? 'span' : 'div'
  const kind = inline ? 'inline' : 'display'
  return Node.create({
    name: inline ? 'transcriptInlineMath' : 'transcriptDisplayMath',
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    addAttributes: () => ({
      latex: {
        default: '',
        parseHTML: element => element.getAttribute('data-latex'),
        renderHTML: attrs => ({ 'data-latex': attrs.latex }),
      },
      bracketed: {
        default: false,
        parseHTML: element => element.hasAttribute('data-bracket-math'),
        renderHTML: attrs => attrs.bracketed ? { 'data-bracket-math': '' } : {},
      },
    }),
    parseHTML: () => [{ tag: element + '[data-transcript-math=' + kind + ']' }],
    renderHTML: ({ node, HTMLAttributes }) => [element, {
      ...HTMLAttributes,
      'data-transcript-math': kind,
    }, formatSource(node.attrs.latex, inline, node.attrs.bracketed)],
    renderText: ({ node }) => formatSource(node.attrs.latex, inline, node.attrs.bracketed),
    addNodeView: () => ({ node, view }) => {
      const dom = view.dom.ownerDocument.createElement(element)
      dom.dataset.transcriptMath = kind
      const latex: string = node.attrs.latex
      // Bound rendering work for large or incomplete streamed responses.
      if (latex.length > 8192) {
        dom.textContent = formatSource(latex, inline, node.attrs.bracketed)
      } else {
        katex.render(latex, dom, {
          displayMode: !inline, throwOnError: false, trust: false, maxExpand: 400, maxSize: 20,
        })
      }
      return { dom }
    },
    addStorage() {
      return { markdown: {
        parse: inline ? {
          setup(this: { editor: Editor }, md: MarkdownIt) {
            configureMathParser(md, activeParses.get(this.editor) ?? enabled())
          },
        } : undefined,
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write(formatSource(node.attrs.latex, inline, node.attrs.bracketed))
          if (!inline) state.closeBlock(node)
        },
      } }
    },
  })
}

export function transcriptMathExtensions(enabled = () => false) {
  return [createMathNode(true, enabled), createMathNode(false, enabled)]
}
