import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeUiBoxLayout } from './ui-presentation.ts'

const choices = {
  position: ['relative', 'absolute'], flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  flexWrap: ['nowrap', 'wrap', 'wrap-reverse'], alignItems: ['flex-start', 'center', 'flex-end', 'stretch'],
  alignSelf: ['flex-start', 'center', 'flex-end', 'auto'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  display: ['flex', 'none'], overflow: ['visible', 'hidden'],
} as const
const spaces = ['gap', 'columnGap', 'rowGap', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] as const
const steps = ['xs', 'sm', 'md', 'lg', 'xl']
/** Only declared layout properties cross the boundary; strings never become arbitrary CSS. */
export function readClaudeUiBoxLayout(props: Record<string, unknown>): ClaudeUiBoxLayout | undefined {
  const layout: ClaudeUiBoxLayout = {}
  const bad = () => { throw new ClaudeProtocolError('native Box layout is invalid') }
  for (const name of Object.keys(choices) as (keyof typeof choices)[]) {
    const value = props[name]
    if (value === undefined) continue
    if (typeof value !== 'string' || !(choices[name] as readonly string[]).includes(value)) bad()
    Object.assign(layout, { [name]: value })
  }
  for (const name of [...spaces, 'top', 'bottom', 'left', 'right', 'flexGrow', 'flexShrink', 'width', 'height', 'minWidth', 'minHeight'] as const) {
    const value = props[name]
    if (value === undefined) continue
    const dimension = ['width', 'height', 'minWidth', 'minHeight'].includes(name)
    const offset = ['top', 'bottom', 'left', 'right'].includes(name)
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 10000 || (dimension && value < 0) || (offset && !Number.isInteger(value))) bad()
    } else if (typeof value === 'string' && (dimension ? /^\d{1,3}%$/.test(value) : (spaces as readonly string[]).includes(name) && steps.includes(value))) {
      // Percentage dimensions and named spacing are native declarations, not raw CSS.
    } else bad()
    Object.assign(layout, { [name]: value })
  }
  return Object.keys(layout).length ? layout : undefined
}
