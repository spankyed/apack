import { parseClaudeStatus } from '#extensions/blocks/display/native-status-text.ts'
import type { CSSProperties, ComputedRef, InjectionKey } from 'vue'
import type { ClaudeUiBoxPaint, ClaudeUiTextStyle } from '#features/code/be/services/claude-code/ui-presentation.ts'

// Fallback for owners that do not export resolved native paint. The terminal adapter resolves its active native theme before transport.
const palette: Record<string, string> = {
  text: '#e5e5e5', inverseText: '#171717', inactive: '#737373', subtle: '#a3a3a3', suggestion: '#a3a3a3',
  remember: '#c084fc', success: '#4ade80', error: '#f87171', warning: '#facc15', merged: '#c084fc',
  claude: '#d97757', permission: '#60a5fa', planMode: '#60a5fa', autoAccept: '#4ade80',
  promptBorder: '#737373', bashBorder: '#c084fc', ide: '#60a5fa',
  diffAdded: '#4ade80', diffRemoved: '#f87171', diffAddedDimmed: '#166534', diffRemovedDimmed: '#991b1b',
  diffAddedWord: '#14532d', diffRemovedWord: '#7f1d1d',
}

/** Parse a color as a single browser property; never interpolate native strings into CSS rules. */
export function claudeUiColor(value: string | undefined): string | undefined {
  if (!value) return
  if (Object.hasOwn(palette, value)) return palette[value]
  const ansi = ['black','red','green','yellow','blue','magenta','cyan','white','blackBright','redBright','greenBright','yellowBright','blueBright','magentaBright','cyanBright','whiteBright']
  const named = value.startsWith('ansi:') ? ansi.indexOf(value.slice(5)) : -1
  const indexed = /^ansi256\((\d{1,3})\)$/.exec(value)
  if (named >= 0 || indexed) {
    const index = named >= 0 ? named : Number(indexed![1])
    if (index > 255) return
    return parseClaudeStatus(`\x1b[38;5;${index}mX`)[0]?.style.color
  }
  const style = document.createElement('span').style
  style.color = value
  return style.color || undefined
}

export function claudeUiBoxPaint(paint: ClaudeUiBoxPaint | undefined): CSSProperties {
  if (!paint) return {}
  const result: CSSProperties = { backgroundColor: claudeUiColor(paint.backgroundColor) }
  if (paint.borderStyle !== undefined && ['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed', 'quote'].includes(paint.borderStyle)) {
    // Ink border families map to their browser equivalents; corner glyph parity is surface-specific.
    result.borderStyle = paint.borderStyle === 'double' ? 'double' : paint.borderStyle === 'dashed' ? 'dashed' : 'solid'
    result.borderWidth = paint.borderStyle === 'double' ? '3px' : paint.borderStyle === 'bold' ? '2px' : '1px'
    if (paint.borderStyle === 'round') result.borderRadius = '0.375rem'
    if (paint.borderStyle === 'singleDouble' || paint.borderStyle === 'doubleSingle') {
      const horizontal = paint.borderStyle === 'doubleSingle'
      Object.assign(result, { borderTopStyle: horizontal ? 'double' : 'solid', borderBottomStyle: horizontal ? 'double' : 'solid',
        borderLeftStyle: horizontal ? 'solid' : 'double', borderRightStyle: horizontal ? 'solid' : 'double',
        borderTopWidth: horizontal ? '3px' : '1px', borderBottomWidth: horizontal ? '3px' : '1px',
        borderLeftWidth: horizontal ? '1px' : '3px', borderRightWidth: horizontal ? '1px' : '3px' })
    }
    if (paint.borderStyle === 'quote') Object.assign(result, { borderWidth: '0', borderLeftWidth: '2px' })
    result['--native-border-color'] = claudeUiColor(paint.borderColor) ?? 'currentColor'
  }
  return result
}

export type ClaudeTextPaint = Pick<ClaudeUiTextStyle, 'color' | 'backgroundColor' | 'inverse'>
export const claudeTextPaint: InjectionKey<ComputedRef<ClaudeTextPaint>> = Symbol('claude-text-paint')
export function claudeUiTextPaint(paint: ClaudeTextPaint): CSSProperties {
  const foreground = claudeUiColor(paint.color), background = claudeUiColor(paint.backgroundColor)
  return paint.inverse ? { color: background ?? palette.inverseText, backgroundColor: foreground ?? palette.text }
    : { color: foreground, backgroundColor: background }
}

/** CSS variables repaint existing decorations without changing editor state or invoking prompt hooks. */
export function claudePromptThemeStyle(palette: Readonly<Record<string, string>> | undefined): CSSProperties {
  const style: CSSProperties = {}
  for (const [role, value] of Object.entries(palette ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(role)) continue
    const color = claudeUiColor(value)
    if (color) style[`--claude-native-prompt-${role}`] = color
  }
  return style
}
