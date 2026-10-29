import type { AnyExtension } from '@tiptap/vue-3'
import { markInputRule } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { common, createLowlight } from 'lowlight'
import { CodeBlockCopy } from './extensions/code-block-copy.ts'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { ResizableImage } from './extensions/resizable-image.ts'
import { SubDocumentLink } from './extensions/sub-document-link.ts'
import { getEditorConfig } from './editor-config.ts'
import { ListShiftEnter } from './extensions/list-shift-enter.ts'
import { MarkdownParseFixes } from './extensions/markdown-parse-fixes.ts'
import { EmptyLinePreserver } from './extensions/empty-line-preserver.ts'
import { BlockquotePipe } from './extensions/blockquote-pipe.ts'
import { DetailsBlock, DetailsBlockSummary, DetailsBlockContent } from './extensions/details-block.ts'
import { ImageUploadPlaceholder } from './extensions/image-upload-placeholder.ts'
import { ImageSelectionDecoration } from './extensions/image-selection-decoration.ts'
import { CustomHorizontalRule } from './extensions/custom-horizontal-rule.ts'
import { SearchAndFind } from './extensions/search.ts'
import { CommandSuggestion } from './extensions/command-suggestion.ts'

const lowlight = createLowlight(common)

// Custom Code extension: don't trigger inline code when backtick is followed by a space.
// Default regex: /(^|[^`])`([^`]+)`(?!`)$/
// Modified:      /(^|[^`])`([^\s`][^`]*)`(?!`)$/  — first char inside backticks must be non-whitespace
const codeInputRegex = /(^|[^`])`([^\s`][^`]*)`(?!`)$/
const CustomCode = Code.extend({
  addInputRules() {
    return [
      markInputRule({
        find: codeInputRegex,
        type: this.type,
      }),
    ]
  },
})

export type TiptapMode = 'editor' | 'input' | 'viewer'
export type TiptapVariant = 'full' | 'chat'

interface CreateExtensionsOptions {
  mode: TiptapMode
  variant?: TiptapVariant
  placeholder?: string
  injectedExtensions?: AnyExtension[]
}

function createFullExtensions(mode: TiptapMode): AnyExtension[] {
  // Note: BlockquotePipe is NOT in this list anymore — it's pushed
  // unconditionally in createExtensions below so the chat viewer can render
  // `> …` blockquotes (from Claude responses and tool-use annotations).
  return [
    SubDocumentLink,
    Table.configure({ resizable: mode !== 'viewer' }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
    ResizableImage.configure({ inline: false, allowBase64: false }),
    ImageSelectionDecoration,
    DetailsBlockSummary,
    DetailsBlockContent,
    DetailsBlock,
  ]
}

export function createExtensions({ mode, variant = 'full', placeholder, injectedExtensions = [] }: CreateExtensionsOptions) {
  const cfg = getEditorConfig(mode, variant)

  const extensions: AnyExtension[] = [
    StarterKit.configure({
      paragraph: false,
      codeBlock: false,
      link: false,
      blockquote: false,
      gapcursor: false,
      horizontalRule: false,
      dropcursor: { color: 'rgb(96 165 250 / 0.5)', width: 4 },
      code: false,
      listKeymap: {
        listTypes: [
          { itemName: 'listItem', wrapperNames: ['bulletList', 'orderedList'] },
          { itemName: 'taskItem', wrapperNames: ['taskList'] },
        ],
      },
      // Chat input must retain heading syntax when native prompt APIs parse Markdown.
      ...(!cfg.richFormatting && { strike: false, trailingNode: false }),
    }),
    // Blockquote is loaded unconditionally (custom input rule is `|<space>`,
    // not `>`, so it doesn't collide with `>`-typed chat input). This ensures
    // the chat viewer has a `blockquote` schema node to parse markdown like
    // `> text` into — without it, tiptap-markdown falls back to inserting the
    // raw `<blockquote><p>…</p></blockquote>` HTML as literal text.
    BlockquotePipe,
    Markdown.configure({
      html: cfg.markdownHtml,
      breaks: cfg.markdownBreaks,
      transformCopiedText: true,
      transformPastedText: true,
    }),
    MarkdownParseFixes,
    CodeBlockCopy.configure({ lowlight }),
    Link.configure({
      openOnClick: false,
      autolink: true,
    }),
    CustomCode.configure({ HTMLAttributes: { spellcheck: 'false' } }),
    EmptyLinePreserver,
    ...injectedExtensions,
  ]

  if (cfg.richFormatting) extensions.push(Color, Highlight.configure({ multicolor: true }), CustomHorizontalRule)
  if (cfg.fullExtensions) extensions.push(...createFullExtensions(mode))
  if (!cfg.fullExtensions && mode === 'viewer') {
    extensions.push(
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    )
  }
  if (cfg.listShiftEnter) extensions.push(ListShiftEnter)
  if (cfg.editorInteractions) extensions.push(ImageUploadPlaceholder)
  if (cfg.searchBar) extensions.push(SearchAndFind)
  // Built in rather than contributed: it asks the `commands` designation, so it needs nothing from any
  // named pack and no pack can fail to declare it. Still config-gated, because `/` is ordinary text in a
  // note or a document — the commands are the chat's affordance even though they are the app's data.
  if (cfg.commandSuggestion) extensions.push(CommandSuggestion)
  if (placeholder) extensions.push(Placeholder.configure({
    placeholder: ({ editor, node }) => {
      if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
      if (node.type.name === 'codeBlock') return ''
      if (node.type.name === 'detailsSummary') return 'Toggle summary'
      return editor.state.doc.content.size <= 2 ? placeholder : ''
    },
    includeChildren: true,
  }))

  return extensions
}
