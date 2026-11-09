import type { TiptapMode, TiptapVariant } from './extensions.ts'

export interface EditorConfig {
  editable: boolean
  fullExtensions: boolean       // Tables, TaskList, Details, SubDocLinks, Blockquote, ResizableImage
  richFormatting: boolean       // Strike, horizontalRule, trailingNode (false = disabled)
  markdownHtml: boolean         // Markdown HTML support
  markdownBreaks: boolean       // Single \n → <br> (for chat viewer where Claude uses single newlines)
  listShiftEnter: boolean       // Shift+Enter → new bullet
  editorInteractions: boolean   // click/paste/drop handlers for sub-doc links, images
  viewerImageClick: boolean     // image lightbox click in viewer
  subDocumentTracking: boolean  // onTransaction for sub-doc link add/remove
  historyNavigation: boolean    // arrow key message history
  enterSubmit: boolean          // Enter submits, Shift+Enter splits
  blockMenu: boolean            // block menu + image bubble (also gated by showGutter prop)
  textBubbleMenu: boolean
  searchBar: boolean
  commandSuggestion: boolean   // `/` opens the chat's slash commands (the app's, through the `commands` designation)
}

type ConfigKey = `${TiptapMode}:${TiptapVariant}`

const CONFIGS: Partial<Record<ConfigKey, EditorConfig>> = {
  'editor:full': {
    editable: true,
    fullExtensions: true,
    richFormatting: true,
    markdownHtml: true,
    markdownBreaks: false,
    listShiftEnter: false,
    editorInteractions: true,
    viewerImageClick: false,
    subDocumentTracking: true,
    historyNavigation: false,
    enterSubmit: false,
    blockMenu: true,
    textBubbleMenu: true,
    searchBar: true,
    commandSuggestion: false,
  },
  'input:chat': {
    editable: true,
    fullExtensions: false,
    richFormatting: false,
    markdownHtml: false,
    markdownBreaks: false,
    listShiftEnter: true,
    editorInteractions: false,
    viewerImageClick: false,
    subDocumentTracking: false,
    historyNavigation: true,
    enterSubmit: true,
    blockMenu: false,
    textBubbleMenu: true,
    searchBar: false,
    commandSuggestion: true,
  },
  'viewer:full': {
    editable: false,
    fullExtensions: true,
    richFormatting: true,
    markdownHtml: true,
    markdownBreaks: false,
    listShiftEnter: false,
    editorInteractions: false,
    viewerImageClick: true,
    subDocumentTracking: false,
    historyNavigation: false,
    enterSubmit: false,
    blockMenu: false,
    textBubbleMenu: false,
    searchBar: false,
    commandSuggestion: false,
  },
  'viewer:chat': {
    editable: false,
    fullExtensions: false,
    richFormatting: true, // headings / strike / hr — Claude responses use them
    markdownHtml: false,
    markdownBreaks: true, // Claude Code text uses single \n for paragraph breaks
    listShiftEnter: false,
    editorInteractions: false,
    viewerImageClick: true,
    subDocumentTracking: false,
    historyNavigation: false,
    enterSubmit: false,
    blockMenu: false,
    textBubbleMenu: false,
    searchBar: false,
    commandSuggestion: false,
  },
}

export function getEditorConfig(mode: TiptapMode, variant: TiptapVariant = 'full'): EditorConfig {
  const cfg = CONFIGS[`${mode}:${variant}`]
  if (!cfg) throw new Error(`Unsupported editor config: ${mode}:${variant}`)
  return cfg
}
