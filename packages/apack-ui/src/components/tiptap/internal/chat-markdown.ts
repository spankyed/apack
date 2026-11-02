import MarkdownIt from 'markdown-it'
import { configureMarkdownRules } from './markdown-rules.ts'

/** Own one parser per viewer; contributed rules may carry mutable state. */
export function createChatMarkdownParser(): MarkdownIt {
  const parser = new MarkdownIt({ html: false, breaks: true, linkify: false })
  // Chat currently renders image attachments separately; inline Markdown images are not schema nodes.
  parser.renderer.rules.image = () => ''
  configureMarkdownRules(parser)
  return parser
}
