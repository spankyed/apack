import { randomUUID } from 'node:crypto'
import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeUiPress } from './ui-controls.ts'

import type { ClaudeUiNode } from './ui-presentation.ts'

export interface ClaudeUiDrawing {
  tree: ClaudeUiNode
  /** Backend authority only: never serialize this map into plugin state or durable data. */
  actions: ReadonlyMap<string, Omit<ClaudeUiPress, 'client_id' | 'surface'>>
}

const limits = { depth: 32, values: 8192, nodes: 1024, bytes: 262144 } as const
const encoder = new TextEncoder()
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Bound the whole wire value, including properties/components we do not render. */
function validateBudget(tree: unknown): void {
  const pending = [{ value: tree, depth: 0 }]
  const seen = new Set<object>()
  let values = 0
  let bytes = 0
  while (pending.length) {
    const { value, depth } = pending.pop()!
    if (++values > limits.values || depth > limits.depth) throw new ClaudeProtocolError('native UI tree exceeds structural limits')
    if (typeof value === 'string') bytes += encoder.encode(value).byteLength
    else if (value !== null && typeof value === 'object') {
      if (seen.has(value)) throw new ClaudeProtocolError('native UI tree contains repeated object references')
      seen.add(value)
      if (Array.isArray(value) && value.length > limits.values - values) throw new ClaudeProtocolError('native UI tree exceeds structural limits')
      const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value)
      if (entries.length > limits.values - values) throw new ClaudeProtocolError('native UI tree exceeds structural limits')
      for (const [key, item] of entries) {
        bytes += encoder.encode(key).byteLength
        pending.push({ value: item, depth: depth + 1 })
      }
    } else if (value !== null && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw new ClaudeProtocolError('native UI tree contains a non-JSON value')
    }
    if (bytes > limits.bytes) throw new ClaudeProtocolError('native UI tree exceeds payload limit')
  }
  if (encoder.encode(JSON.stringify(tree)).byteLength > limits.bytes) throw new ClaudeProtocolError('native UI tree exceeds payload limit')
}

/** Translate observed nodes only. Native props, engine refs and executable modules never cross this boundary. */
export function createClaudeUiDrawing(tree: unknown): ClaudeUiDrawing {
  validateBudget(tree)
  const actions = new Map<string, Omit<ClaudeUiPress, 'client_id' | 'surface'>>()
  let nodes = 0
  function visit(value: unknown): ClaudeUiNode {
    if (++nodes > limits.nodes) throw new ClaudeProtocolError('native UI tree exceeds node limit')
    if (typeof value === 'string') return { kind: 'text', text: value }
    if (!record(value) || typeof value.type !== 'string') throw new ClaudeProtocolError('native UI node must have a component type')
    const plugin = record(value.part) && typeof value.part.plugin === 'string' ? value.part.plugin : undefined
    const attribution = plugin === undefined ? {} : { plugin }
    if (value.type === 'Box' || value.type === 'Text') {
      if (!Array.isArray(value.children)) throw new ClaudeProtocolError('native UI container must have children')
      if (value.type === 'Text') {
        if (!value.children.every(child => typeof child === 'string')) return { kind: 'unsupported', component: 'Text', ...attribution }
        return { kind: 'text', text: value.children.join(''), ...attribution }
      }
      return { kind: 'box', children: value.children.map(visit), ...attribution }
    }
    if (value.type === 'Button') {
      if (!record(value.props) || typeof value.props.label !== 'string') throw new ClaudeProtocolError('native UI button must have a label')
      const button: ClaudeUiNode = { kind: 'button', label: value.props.label, ...attribution }
      if (value.press === undefined) return button
      if (!record(value.press) || typeof value.press.plugin !== 'string' || !value.press.plugin
        || typeof value.press.handle !== 'number' || !Number.isSafeInteger(value.press.handle)
        || (value.props.key !== undefined && typeof value.props.key !== 'string')) {
        throw new ClaudeProtocolError('native UI button has an invalid callback')
      }
      const actionId = randomUUID()
      actions.set(actionId, { plugin: value.press.plugin, handle: value.press.handle,
        ...(typeof value.props.key === 'string' ? { key: value.props.key } : {}) })
      return { ...button, actionId }
    }
    return { kind: 'unsupported', component: value.type, ...attribution }
  }
  return { tree: visit(tree), actions }
}
