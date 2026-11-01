import { Extension } from '@tiptap/core'
import { configureMarkdownRules } from '../internal/markdown-rules.ts'

export const MarkdownParseFixes = Extension.create({
  name: 'markdownParseFixes',
  addStorage() {
    return { markdown: { parse: { setup: configureMarkdownRules } } }
  },
})
