import { ClaudeProtocolError } from './errors.ts'
import { readClaudeUiBoxLayout } from './ui-box-layout.ts'
import type { ClaudeUiHover } from './ui-presentation.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Native hover is inert presentation, with group ownership distinct from root attribution. */
export function readClaudeUiHover(node: Record<string, unknown>, props: Record<string, unknown>): ClaudeUiHover | undefined {
  if (node.hover === undefined) return
  if (!record(node.hover)) throw new ClaudeProtocolError('native UI hover is invalid')
  const hover = node.hover
  const result: ClaudeUiHover = {}
  const bad = () => { throw new ClaudeProtocolError('native UI hover is invalid') }
  if (hover.scope !== undefined) {
    const stamp = node.type === 'Button' ? node.press : node.group
    if (typeof hover.scope !== 'string' || !hover.scope.length || hover.scope.length > 64 || /[\u0000-\u001f\u007f]/.test(hover.scope)
      || !record(stamp) || typeof stamp.plugin !== 'string' || !stamp.plugin) bad()
    result.group = JSON.stringify([(stamp as Record<string, unknown>).plugin, hover.scope])
  }
  const box = node.type === 'Box'
  const colors = box ? ['borderStyle', 'borderColor', 'backgroundColor'] : ['color', 'backgroundColor']
  const booleans = box ? ['borderDimColor'] : ['dimColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse']
  const offsets = ['top', 'left', 'right', 'bottom']
  for (const [name, value] of Object.entries(hover)) {
    if (name === 'scope') continue
    if (colors.includes(name)) {
      if (typeof value !== 'string') bad()
      if (box) Object.assign(result.paint ??= {}, { [name]: value })
      else Object.assign(result.text ??= {}, { [name]: value })
    } else if (booleans.includes(name)) {
      if (typeof value !== 'boolean') bad()
      if (box) Object.assign(result.paint ??= {}, { [name]: value })
      else Object.assign(result.text ??= {}, { [name]: value })
    } else if (box && (name === 'display' || offsets.includes(name))) {
      if (name === 'display' ? value !== 'flex' || props.display !== 'none' : props.position !== 'absolute') bad()
      const layout = readClaudeUiBoxLayout({ [name]: value })
      Object.assign(result.layout ??= {}, layout)
    } else bad()
  }
  if (result.paint?.borderStyle !== undefined && props.borderStyle === undefined) bad()
  return result
}
