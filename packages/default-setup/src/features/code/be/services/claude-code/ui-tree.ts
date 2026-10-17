import { randomUUID } from 'node:crypto'
import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeUiPress } from './ui-controls.ts'

import type { ClaudeUiNode } from './ui-presentation.ts'

export interface ClaudeUiDrawing {
  links: ReadonlyMap<string, ReadonlySet<string> | undefined>
  fields: ReadonlyMap<string, { type: 'input' | 'select'; plugin: string; handle: number; key: string; options?: string[] }>
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
export function createClaudeUiDrawing(tree: unknown, previous?: ClaudeUiDrawing): ClaudeUiDrawing {
  validateBudget(tree)
  const actions = new Map<string, Omit<ClaudeUiPress, 'client_id' | 'surface'>>()
  const fields = new Map<string, { type: 'input' | 'select'; plugin: string; handle: number; key: string; options?: string[] }>()
  const links = new Map<string, ReadonlySet<string> | undefined>()
  const identities = new Set<string>()
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
    if (value.type === 'Markdown') {
      if (!record(value.props) || typeof value.props.text !== 'string' || (value.props.dimColor !== undefined && typeof value.props.dimColor !== 'boolean')) throw new ClaudeProtocolError('native Markdown props are invalid')
      const props = value.props
      if (props.pressableLinks !== undefined && (!Array.isArray(props.pressableLinks) || !props.pressableLinks.every(href => typeof href === 'string'))) throw new ClaudeProtocolError('native Markdown links are invalid')
      const pressableLinks = props.pressableLinks as string[] | undefined
      const node: ClaudeUiNode = { kind: 'markdown', text: props.text as string, dim: props.dimColor === true, ...attribution,
        ...(pressableLinks !== undefined ? { pressableLinks } : {}) }
      if (value.press === undefined) return node
      if (!record(value.press) || typeof value.press.plugin !== 'string' || !value.press.plugin || typeof value.press.handle !== 'number'
        || !Number.isSafeInteger(value.press.handle) || typeof props.key !== 'string') throw new ClaudeProtocolError('native Markdown callback is invalid')
      const actionId = randomUUID()
      actions.set(actionId, { plugin: value.press.plugin, handle: value.press.handle, key: props.key })
      links.set(actionId, pressableLinks === undefined ? undefined : new Set(pressableLinks))
      return { ...node, actionId }
    }
    if (value.type === 'Code') {
      const props = value.props
      if (!record(props) || typeof props.source !== 'string'
        || (props.language !== undefined && typeof props.language !== 'string') || (props.path !== undefined && typeof props.path !== 'string')
        || (props.startLine !== undefined && (typeof props.startLine !== 'number' || !Number.isSafeInteger(props.startLine)))
        || (props.format !== undefined && props.format !== 'source' && props.format !== 'diff')
        || (props.wrap !== undefined && props.wrap !== 'wrap' && props.wrap !== 'truncate-end')) throw new ClaudeProtocolError('native Code props are invalid')
      return { kind: 'code', source: props.source, format: props.format === 'diff' ? 'diff' : 'source', wrap: props.wrap === 'truncate-end' ? 'truncate-end' : 'wrap', ...attribution,
        ...(typeof props.language === 'string' ? { language: props.language } : {}), ...(typeof props.path === 'string' ? { path: props.path } : {}), ...(typeof props.startLine === 'number' ? { startLine: props.startLine } : {}) }
    }
    if (value.type === 'Input' || value.type === 'Select') {
      const props = value.props, press = value.press
      if (!record(props) || typeof props.key !== 'string' || !record(press)
        || typeof press.plugin !== 'string' || !press.plugin || press.plugin.length > 256
        || typeof press.handle !== 'number' || !Number.isSafeInteger(press.handle)) throw new ClaudeProtocolError('native UI field has invalid identity')
      for (const name of ['label', 'placeholder', 'value']) if (props[name] !== undefined && typeof props[name] !== 'string') throw new ClaudeProtocolError('native UI field has invalid text')
      if (typeof props.value === 'string' && props.value.length > 16384) throw new ClaudeProtocolError('native UI field text exceeds limit')
      const type = value.type === 'Input' ? 'input' : 'select'
      const identity = JSON.stringify([type, press.plugin, props.key])
      if (identities.has(identity)) throw new ClaudeProtocolError('native UI field key is ambiguous')
      identities.add(identity)
      const actionId = [...(previous?.fields ?? [])].find(([, field]) => field.type === type && field.plugin === press.plugin && field.key === props.key)?.[0] ?? randomUUID()
      const field = { type, plugin: press.plugin, handle: press.handle, key: props.key } as const
      const label = typeof props.label === 'string' ? { label: props.label } : {}
      const common = { actionId, ...label, value: typeof props.value === 'string' ? props.value : '', autoFocus: props.autoFocus === true, ...attribution }
      if (type === 'input') {
        if (props.rows !== undefined && (typeof props.rows !== 'number' || !Number.isSafeInteger(props.rows) || props.rows < 1)) throw new ClaudeProtocolError('native UI input rows are invalid')
        fields.set(actionId, field)
        return { kind: 'input', ...common, rows: Math.min(typeof props.rows === 'number' ? props.rows : 1, 48), ...(typeof props.placeholder === 'string' ? { placeholder: props.placeholder } : {}) }
      }
      if (!Array.isArray(props.options) || !props.options.length) throw new ClaudeProtocolError('native UI select requires options')
      const options = props.options.map(option => {
        if (!record(option) || typeof option.value !== 'string' || option.value.length > 16384 || (option.label !== undefined && typeof option.label !== 'string')) throw new ClaudeProtocolError('native UI select option is invalid')
        return { value: option.value, label: typeof option.label === 'string' ? option.label : option.value }
      })
      if (new Set(options.map(option => option.value)).size !== options.length) throw new ClaudeProtocolError('native UI select options are ambiguous')
      fields.set(actionId, { ...field, options: options.map(option => option.value) })
      return { kind: 'select', ...common, options }
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
  return { tree: visit(tree), actions, fields, links }
}
