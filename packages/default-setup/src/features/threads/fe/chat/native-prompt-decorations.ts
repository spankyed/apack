import './native-prompt-decorations.css'
import { claudeUiColor } from './native-ui-paint.ts'
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
      apply: (tr, value) => {
        const drawn = tr.getMeta(key)
        if (drawn !== undefined) return drawn
        // Schema maintenance belongs to the native redraw; later person edits retire its paint.
        if (tr.getMeta('appendedTransaction')?.getMeta(key) !== undefined) {
          const mapped = value.map(tr.mapping, tr.doc)
          if (!mapped.find(undefined, undefined, spec => spec.claudePromptLines === true).length) return mapped
          const decorations = mapped.find()
          const projected = decorations.filter(item => item.spec.claudePromptProjection).map((item, order) => ({ ...item.spec.claudePromptProjection, from: item.from, to: item.to, order }))
          return projectClaudePromptLines(tr.doc, projected, decorations.filter(item => !item.spec.claudePromptLines))
        }
        return tr.docChanged || tr.selectionSet ? DecorationSet.empty : value
      },
    },
    props: { decorations: state => key.getState(state) },
  })
  return { key, plugin }
}

type ClaudePromptRun = NonNullable<ClaudeUiPromptFrame['decorations']>[number]
interface ClaudePromptProjection {
  from: number
  to: number
  order: number
  styles: readonly string[]
  underline?: boolean
  strikethrough?: boolean
}

function claudePromptRunStyles(run: ClaudePromptRun): string[] {
  const styles: string[] = []
  // False is an explicit native override; absence retains the person's rich formatting.
  if (run.bold !== undefined) styles.push(run.bold ? 'font-weight:600' : 'font-weight:normal')
  if (run.italic !== undefined) styles.push(run.italic ? 'font-style:italic' : 'font-style:normal')
  if (run.dimColor !== undefined) styles.push(run.dimColor ? 'opacity:0.6' : 'opacity:1')
  const foreground = claudeUiColor(run.color), background = claudeUiColor(run.backgroundColor)
  if (foreground) styles.push(`color:${typeof run._apackThemeColor === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(run._apackThemeColor) ? `var(--claude-native-prompt-${run._apackThemeColor}, ${foreground})` : foreground}`)
  if (background) styles.push(`background-color:${typeof run._apackThemeBackgroundColor === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(run._apackThemeBackgroundColor) ? `var(--claude-native-prompt-${run._apackThemeBackgroundColor}, ${background})` : background}`)
  return styles
}

/** Parent text decorations cannot be cancelled by a child. Paint disjoint inline leaves instead. */
function projectClaudePromptLines(doc: ProseMirrorNode, projected: readonly ClaudePromptProjection[], retained: readonly Decoration[]): DecorationSet {
  const drawn = [...retained]
  if (!projected.some(run => run.underline !== undefined || run.strikethrough !== undefined)) {
    for (const run of projected) if (run.styles.length) drawn.push(Decoration.inline(run.from, run.to, { class: 'claude-prompt-decoration', style: run.styles.join(';') }))
    return DecorationSet.create(doc, drawn)
  }
  const ordered = [...projected].sort((left, right) => left.from - right.from || left.order - right.order)
  let next = 0, active: ClaudePromptProjection[] = []
  doc.descendants((node, pos) => {
    if (!node.isText && !(node.isInline && node.isAtom)) return
    const end = pos + node.nodeSize
    active = active.filter(run => run.to > pos)
    while (next < ordered.length && ordered[next].from < end) active.push(ordered[next++])
    const candidates = active.filter(run => run.to > pos).sort((left, right) => left.from - right.from || left.order - right.order)
    const richUnderline = node.marks.some(mark => mark.type.name === 'underline')
    const richStrike = node.marks.some(mark => mark.type.name === 'strike')
    if (!candidates.length && !richUnderline && !richStrike) return false
    const edges = [...new Set([pos, end, ...candidates.flatMap(run => [Math.max(pos, run.from), Math.min(end, run.to)])])].sort((left, right) => left - right)
    let startIndex = 0, covering: ClaudePromptProjection[] = []
    for (let index = 0; index + 1 < edges.length; index++) {
      const from = edges[index], to = edges[index + 1]
      covering = covering.filter(run => run.to > from)
      while (startIndex < candidates.length && candidates[startIndex].from <= from) covering.push(candidates[startIndex++])
      const source = [...covering].sort((left, right) => left.order - right.order)
      let underline: boolean | undefined, strikethrough: boolean | undefined
      for (const run of source) {
        if (run.underline !== undefined) underline = run.underline
        if (run.strikethrough !== undefined) strikethrough = run.strikethrough
      }
      const baseStyles = source.flatMap(run => run.styles)
      const native = baseStyles.length > 0 || underline !== undefined || strikethrough !== undefined
      if (!native && !richUnderline && !richStrike) continue
      const lines = [(underline ?? richUnderline) && 'underline', (strikethrough ?? richStrike) && 'line-through'].filter(Boolean)
      const styles = [...baseStyles, `text-decoration-line:${lines.join(' ') || 'none'}`]
      const projection = native ? { styles: baseStyles, underline, strikethrough } : undefined
      drawn.push(Decoration.inline(from, to, { class: `claude-prompt-line-paint ${native ? 'claude-prompt-decoration' : 'claude-prompt-line-inherit'}`, style: styles.join(';') }, { claudePromptLines: true, ...(projection ? { claudePromptProjection: projection } : {}) }))
    }
    return false
  })
  return DecorationSet.create(doc, drawn)
}

/** Decorations are presentation only: no marks, draft characters or submitted text are added. */
export function drawClaudePromptDecorations(doc: ProseMirrorNode, runs: NonNullable<ClaudeUiPromptFrame['decorations']>, serialize: ClaudePromptSerializer, sourcePositions?: ReadonlyMap<number, number>, sourceOffsets?: ReadonlyMap<number, number>): DecorationSet {
  const drawn: Decoration[] = [], projected: ClaudePromptProjection[] = []
  const positions = new Map<string, number | undefined>()
  const position = (offset: number, bias: -1 | 0 | 1) => {
    if (sourcePositions) {
      const exact = sourcePositions.get(offset)
      if (exact !== undefined) return exact
      if (!sourceOffsets) return
    }
    if (sourceOffsets) {
      const canonical = sourceOffsets.get(offset)
      if (canonical === undefined) return
      offset = canonical
    }
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
    projected.push({ from, to, order: projected.length, styles: claudePromptRunStyles(run), underline: run.underline, strikethrough: run.strikethrough })
  }
  return projectClaudePromptLines(doc, projected, drawn)
}
