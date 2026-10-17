import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { ClaudeUiPromptFrame } from '#features/code/be/services/claude-code/ui-controls.ts'
import { findClaudePromptPosition, type ClaudePromptSerializer } from './native-prompt-document.ts'

export function createClaudePromptDecorations() {
  const key = new PluginKey<DecorationSet>('claude-native-prompt')
  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value) => tr.getMeta(key) ?? (tr.docChanged || tr.selectionSet ? DecorationSet.empty : value),
    },
    props: { decorations: state => key.getState(state) },
  })
  return { key, plugin }
}

const palette: Record<string, string> = {
  text: '#e5e5e5', inactive: '#737373', subtle: '#a3a3a3', suggestion: '#a3a3a3',
  success: '#4ade80', error: '#f87171', warning: '#facc15', claude: '#d97757',
  permission: '#60a5fa', planMode: '#60a5fa', autoAccept: '#4ade80',
}
function color(value: string | undefined): string | undefined {
  if (!value) return
  return palette[value] ?? (/^(?:#[a-fA-F0-9]{3,8}|(?:black|white|red|green|blue|yellow|cyan|magenta|gray|grey|transparent))$/.test(value) ? value : undefined)
}

/** Decorations are presentation only: no marks, draft characters or submitted text are added. */
export function drawClaudePromptDecorations(doc: ProseMirrorNode, runs: NonNullable<ClaudeUiPromptFrame['decorations']>, serialize: ClaudePromptSerializer): DecorationSet {
  const drawn: Decoration[] = []
  const positions = new Map<string, number | undefined>()
  const position = (offset: number, bias: -1 | 0 | 1) => {
    const address = `${offset}:${bias}`
    if (!positions.has(address)) positions.set(address, findClaudePromptPosition(doc, offset, serialize, bias))
    return positions.get(address)
  }
  for (const run of runs) {
    if (run.virtualText && run.start === run.end) {
      const at = position(run.start, 0)
      if (at !== undefined) drawn.push(Decoration.widget(at, () => {
        const span = document.createElement('span')
        span.textContent = run.virtualText!
        span.contentEditable = 'false'
        span.setAttribute('aria-hidden', 'true')
        span.className = 'claude-prompt-virtual'
        span.style.cssText = 'opacity:0.6;pointer-events:none;user-select:none'
        return span
      }, { side: -1, ignoreSelection: true }))
      continue
    }
    const from = position(run.start, 1), to = position(run.end, -1)
    if (from === undefined || to === undefined || to <= from) continue
    const styles: string[] = []
    if (run.bold) styles.push('font-weight:600')
    if (run.italic) styles.push('font-style:italic')
    if (run.dimColor) styles.push('opacity:0.6')
    const lines = [run.underline && 'underline', run.strikethrough && 'line-through'].filter(Boolean)
    if (lines.length) styles.push(`text-decoration-line:${lines.join(' ')}`)
    const foreground = color(run.color), background = color(run.backgroundColor)
    if (foreground) styles.push(`color:${foreground}`)
    if (background) styles.push(`background-color:${background}`)
    if (styles.length) drawn.push(Decoration.inline(from, to, { class: 'claude-prompt-decoration', style: styles.join(';') }))
  }
  return DecorationSet.create(doc, drawn)
}
