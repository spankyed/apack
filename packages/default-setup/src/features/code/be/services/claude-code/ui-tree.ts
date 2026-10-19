import { readClaudeUiHover } from './ui-hover.ts'
import { readClaudeUiBoxLayout } from './ui-box-layout.ts'
import { randomUUID } from 'node:crypto'
import { ClaudeProtocolError } from './errors.ts'
import type { ClaudeUiPress } from './ui-controls.ts'

import type { ClaudeUiNode } from './ui-presentation.ts'

export interface ClaudeUiDrawing {
  clientActions: ReadonlyMap<string,{instance:string;key:string;type:string;plugin:string}>
  clientInstances: ReadonlySet<string>
  scrollTargets: ReadonlyMap<string, { plugin: string; key: string }>
  focusables: ReadonlyMap<string, { plugin: string; key: string }>
  links: ReadonlyMap<string, ReadonlySet<string> | undefined>
  fields: ReadonlyMap<string, { type: 'input' | 'select'; plugin: string; handle: number; key: string; clientInstance?: string; options?: string[] }>
  tree: ClaudeUiNode
  /** Backend authority only: never serialize this map into plugin state or durable data. */
  actions: ReadonlyMap<string, Omit<ClaudeUiPress, 'client_id' | 'surface'>>
}

const limits = { depth: 32, values: 8192, nodes: 1024, bytes: 262144 } as const
const encoder = new TextEncoder()
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Adapter-only document text role; interpreted as one color property by the renderer. */
function documentColor(props: Record<string, unknown>): { color?: string } {
  if (props._apackDocumentTheme === undefined) return {}
  const theme = props._apackDocumentTheme
  if (!record(theme) || typeof theme.text !== 'string' || !theme.text.length || theme.text.length > 128 || /[\u0000-\u001f\u007f]/.test(theme.text)) throw new ClaudeProtocolError('native document theme is invalid')
  return { color: theme.text }
}

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
  const clientInstances = new Set<string>()
  const clientActions = new Map<string,{instance:string;key:string;type:string;plugin:string}>()
  let clientScope: string | undefined
  function actionIdentity(type:string,plugin:string,key:unknown):string {
    if (!clientScope || typeof key !== 'string') return randomUUID()
    const prior=[...(previous?.clientActions??[])].filter(([,entry])=>entry.instance===clientScope&&entry.key===key&&entry.type===type&&entry.plugin===plugin)
    const id=prior.length===1?prior[0]![0]:randomUUID()
    clientActions.set(id,{instance:clientScope,key,type,plugin});return id
  }
  const actions = new Map<string, Omit<ClaudeUiPress, 'client_id' | 'surface'>>()
  const fields = new Map<string, { type: 'input' | 'select'; plugin: string; handle: number; key: string; clientInstance?: string; options?: string[] }>()
  const scrollBoxes = new Map<string, { plugin: string; key: string }>()
  const focusables = new Map<string, { plugin: string; key: string }>()
  function focusIdentity(plugin: string, key: unknown): { focusId?: string } {
    if (plugin.length > 256 || typeof key !== 'string' || key.length > 256) return {}
    const focusId = randomUUID()
    focusables.set(focusId, { plugin, key })
    return { focusId }
  }
  const links = new Map<string, ReadonlySet<string> | undefined>()
  const identities = new Set<string>()
  let nodes = 0
  function visit(value: unknown, inheritedPlugin?: string): ClaudeUiNode {
    if (++nodes > limits.nodes) throw new ClaudeProtocolError('native UI tree exceeds node limit')
    if (typeof value === 'string') return { kind: 'text', text: value }
    if (!record(value) || typeof value.type !== 'string') throw new ClaudeProtocolError('native UI node must have a component type')
    const plugin = record(value.part) && typeof value.part.plugin === 'string' ? value.part.plugin : inheritedPlugin
    const attribution = plugin === undefined ? {} : { plugin }
    if (value.type === 'NativeClient') {
      const props=value.props
      if(!record(props)||typeof props.id!=='string'||!/^[a-f0-9-]{36}$/i.test(props.id)||!Array.isArray(value.children)||typeof props.pointer!=='boolean'||typeof props.keys!=='boolean')throw new ClaudeProtocolError('Invalid native Client presentation')
      clientInstances.add(props.id)
      const parent=clientScope;clientScope=props.id
      try {return {kind:'client',id:props.id,pointer:props.pointer,keys:props.keys,layout:readClaudeUiBoxLayout(props),children:value.children.map(child=>visit(child,plugin)),...attribution}} finally {clientScope=parent}
    }
    if (value.type === 'Box' || value.type === 'Text') {
      const children = value.children ?? []
      if (!Array.isArray(children)) throw new ClaudeProtocolError('native UI container must have children')
      if (value.type === 'Text') {
        const props = value.props ?? {}
        if (!record(props)) throw new ClaudeProtocolError('native Text props are invalid')
        const style: NonNullable<Extract<ClaudeUiNode, { kind: 'text' }>['style']> = {}
        for (const name of ['bold', 'italic', 'underline', 'strikethrough', 'mono', 'tabular', 'dimColor', 'inverse'] as const) {
          if (props[name] !== undefined) {
            if (typeof props[name] !== 'boolean') throw new ClaudeProtocolError('native Text style is invalid')
            style[name] = props[name]
          }
        }
        for (const name of ['color', 'backgroundColor'] as const) {
          if (props[name] !== undefined) {
            if (typeof props[name] !== 'string') throw new ClaudeProtocolError('native Text color is invalid')
            style[name] = props[name]
          }
        }
        const choices = { wrap: ['wrap', 'end', 'middle', 'truncate', 'truncate-start', 'truncate-middle', 'truncate-end'], size: ['caption', 'footnote', 'body', 'heading', 'title'], weight: ['regular', 'medium', 'semibold', 'bold'], dir: ['ltr', 'rtl'] } as const
        for (const name of ['wrap', 'size', 'weight', 'dir'] as const) {
          const candidate = props[name]
          if (candidate !== undefined) {
            if (typeof candidate !== 'string' || !(choices[name] as readonly string[]).includes(candidate)) throw new ClaudeProtocolError('native Text style is invalid')
            Object.assign(style, { [name]: candidate })
          }
        }
        const hover = readClaudeUiHover(value, props)
        const styling = { ...(Object.keys(style).length ? { style } : {}), ...(hover ? { hover } : {}) }
        return children.every(child => typeof child === 'string')
          ? { kind: 'text', text: children.join(''), ...styling, ...attribution }
          : { kind: 'text', text: '', children: children.map(child => visit(child, plugin)), ...styling, ...attribution }
      }
      const props = value.props ?? {}
      if (!record(props)) throw new ClaudeProtocolError('native Box props are invalid')
      const layout = readClaudeUiBoxLayout(props)
      const paint: NonNullable<Extract<ClaudeUiNode, { kind: 'box' }>['paint']> = {}
      for (const name of ['borderStyle', 'borderColor', 'backgroundColor'] as const) {
        if (props[name] !== undefined) {
          if (typeof props[name] !== 'string') throw new ClaudeProtocolError('native Box paint is invalid')
          paint[name] = props[name]
        }
      }
      if (props.borderDimColor !== undefined) {
        if (typeof props.borderDimColor !== 'boolean') throw new ClaudeProtocolError('native Box border dim is invalid')
        paint.borderDimColor = props.borderDimColor
      }
      const hover = readClaudeUiHover(value, props)
      const boxKey = props.key === undefined ? undefined : typeof props.key === 'string' && props.key.length > 0 && props.key.length <= 10000 && !/[\u0000-\u001f\u007f]/.test(props.key) ? props.key : false
      const scrollId = plugin && plugin.length <= 256 && typeof boxKey === 'string' && boxKey.length <= 256 ? randomUUID() : undefined
      if (scrollId) scrollBoxes.set(scrollId, { plugin: plugin!, key: boxKey as string })
      return { kind: 'box', ...(scrollId ? { scrollId } : {}), ...(boxKey !== undefined ? { boxKey } : {}), ...(hover ? { hover } : {}), children: children.map(child => visit(child, plugin)), ...(layout ? { layout } : {}), ...(Object.keys(paint).length ? { paint } : {}), ...attribution }
    }
    if (value.type === 'Link') {
      if (!record(value.props) || typeof value.props.href !== 'string' || (value.props.label !== undefined && typeof value.props.label !== 'string')) throw new ClaudeProtocolError('native Link props are invalid')
      const raw = value.props.href
      let href: string | undefined
      if (raw.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(raw)) {
        try {
          const url = new URL(raw)
          if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) href = raw
        } catch { /* A remote surface draws an unsupported target as plain text. */ }
      }
      const children = value.children
      if (children !== undefined && !Array.isArray(children)) throw new ClaudeProtocolError('native Link children are invalid')
      return { kind: 'link', ...documentColor(value.props), ...(href !== undefined ? { href } : {}), children: children === undefined || !children.length
        ? [{ kind: 'text', text: typeof value.props.label === 'string' ? value.props.label : raw }]
        : children.map(child => visit(child, plugin)), ...attribution }
    }
    if (value.type === 'Svg') {
      const props = value.props
      if (!record(props) || typeof props.source !== 'string' || !props.source.length || props.source.length > 131072 || typeof props.alt !== 'string' || /[\u0000-\u001f\u007f]/.test(props.alt) || value.children !== undefined) throw new ClaudeProtocolError('native Svg props are invalid')
      for (const name of ['width', 'height'] as const) {
        const dimension = props[name]
        if (dimension !== undefined && (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0 || dimension > 4096)) throw new ClaudeProtocolError('native Svg dimensions are invalid')
      }
      if (props.isInteractive !== undefined && typeof props.isInteractive !== 'boolean') throw new ClaudeProtocolError('native Svg interactivity is invalid')
      return { kind: 'svg', source: props.source, alt: props.alt, ...(props.width !== undefined ? { width: props.width as number } : {}), ...(props.height !== undefined ? { height: props.height as number } : {}), interactive: props.isInteractive === true, ...attribution }
    }
    if (value.type === 'Markdown') {
      if (!record(value.props) || typeof value.props.text !== 'string' || (value.props.dimColor !== undefined && typeof value.props.dimColor !== 'boolean')) throw new ClaudeProtocolError('native Markdown props are invalid')
      const props = value.props
      if (props.pressableLinks !== undefined && (!Array.isArray(props.pressableLinks) || !props.pressableLinks.every(href => typeof href === 'string'))) throw new ClaudeProtocolError('native Markdown links are invalid')
      const pressableLinks = props.pressableLinks as string[] | undefined
      if (props._apackMarkdownAnsi !== undefined && (typeof props._apackMarkdownAnsi !== 'string' || props._apackMarkdownAnsi.length > 65536)) throw new ClaudeProtocolError('native Markdown drawing is invalid')
      const node: ClaudeUiNode = { kind: 'markdown', ...(typeof props._apackMarkdownAnsi === 'string' ? { nativeAnsi: props._apackMarkdownAnsi } : {}), ...documentColor(props), text: props.text as string, dim: props.dimColor === true, ...attribution,
        ...(pressableLinks !== undefined ? { pressableLinks } : {}) }
      if (value.press === undefined) return node
      if (!record(value.press) || typeof value.press.plugin !== 'string' || !value.press.plugin || typeof value.press.handle !== 'number'
        || !Number.isSafeInteger(value.press.handle) || typeof props.key !== 'string') throw new ClaudeProtocolError('native Markdown callback is invalid')
      const actionId = actionIdentity(value.type,value.press.plugin,props.key)
      actions.set(actionId, { plugin: value.press.plugin, handle: value.press.handle, key: props.key })
      links.set(actionId, pressableLinks === undefined ? undefined : new Set(pressableLinks))
      return { ...node, actionId }
    }
    if (value.type === 'Code') {
      const props = value.props
      if (!record(props) || typeof props.source !== 'string'
        || (props.language !== undefined && typeof props.language !== 'string') || (props.path !== undefined && typeof props.path !== 'string')
        || (props.startLine !== undefined && (typeof props.startLine !== 'number' || !Number.isSafeInteger(props.startLine) || props.startLine < 1 || props.startLine > 1_000_000_000))
        || (props.format !== undefined && props.format !== 'source' && props.format !== 'diff')
        || (props.wrap !== undefined && props.wrap !== 'wrap' && props.wrap !== 'truncate-end')) throw new ClaudeProtocolError('native Code props are invalid')
      if (props._apackCodeAnsi !== undefined && (typeof props._apackCodeAnsi !== 'string' || props._apackCodeAnsi.length > 65536)) throw new ClaudeProtocolError('native Code drawing is invalid')
      return { kind: 'code', ...documentColor(props), ...(typeof props._apackCodeAnsi === 'string' ? { nativeAnsi: props._apackCodeAnsi } : {}), source: props.source, format: props.format === 'diff' ? 'diff' : 'source', wrap: props.wrap === 'truncate-end' ? 'truncate-end' : 'wrap', ...attribution,
        ...(typeof props.language === 'string' ? { language: props.language } : {}), ...(typeof props.path === 'string' ? { path: props.path } : {}), ...(typeof props.startLine === 'number' ? { startLine: props.startLine } : {}) }
    }
    if (value.type === 'Input' || value.type === 'Select') {
      const props = value.props, press = value.press
      if (!record(props) || typeof props.key !== 'string' || !record(press)
        || typeof press.plugin !== 'string' || !press.plugin || press.plugin.length > 256
        || typeof press.handle !== 'number' || !Number.isSafeInteger(press.handle)) throw new ClaudeProtocolError('native UI field has invalid identity')
      for (const name of ['label', 'placeholder', 'value', 'submitLabel']) if (props[name] !== undefined && typeof props[name] !== 'string') throw new ClaudeProtocolError('native UI field has invalid text')
      if (typeof props.value === 'string' && props.value.length > 16384) throw new ClaudeProtocolError('native UI field text exceeds limit')
      const type = value.type === 'Input' ? 'input' : 'select'
      const identity = JSON.stringify([type, press.plugin, props.key, clientScope ?? null])
      if (identities.has(identity)) throw new ClaudeProtocolError('native UI field key is ambiguous')
      identities.add(identity)
      const actionId = [...(previous?.fields ?? [])].find(([, field]) => field.type === type && field.plugin === press.plugin && field.key === props.key && field.clientInstance === clientScope)?.[0] ?? randomUUID()
      const field = { type, plugin: press.plugin, handle: press.handle, key: props.key, ...(clientScope?{clientInstance:clientScope}:{}) } as const
      let theme: { text: string; inverseText: string } | undefined
      if (props._apackFieldTheme !== undefined) {
        const nativeTheme = props._apackFieldTheme
        if (!record(nativeTheme) || ['text', 'inverseText'].some(name => typeof nativeTheme[name] !== 'string' || !nativeTheme[name].length || nativeTheme[name].length > 256)) throw new ClaudeProtocolError('native UI field theme is invalid')
        theme = { text: nativeTheme.text as string, inverseText: nativeTheme.inverseText as string }
      }
      const label = typeof props.label === 'string' ? { label: props.label } : {}
      const common = { actionId, ...(theme ? { theme } : {}), ...(!clientScope?focusIdentity(press.plugin, props.key):{}), revision: 0, ...label, value: typeof props.value === 'string' ? props.value : '', autoFocus: props.autoFocus === true, ...attribution }
      if (type === 'input') {
        if (props.rows !== undefined && (typeof props.rows !== 'number' || !Number.isSafeInteger(props.rows) || props.rows < 1)) throw new ClaudeProtocolError('native UI input rows are invalid')
        fields.set(actionId, field)
        return { kind: 'input', ...common, submitLabel: typeof props.submitLabel === 'string' ? props.submitLabel : 'submit', rows: Math.min(typeof props.rows === 'number' ? props.rows : 1, 48), ...(typeof props.placeholder === 'string' ? { placeholder: props.placeholder } : {}) }
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
      const props = value.props
      if ((props.dimColor !== undefined && typeof props.dimColor !== 'boolean')
        || (props.variant !== undefined && props.variant !== 'primary' && props.variant !== 'secondary')
        || (props.role !== undefined && props.role !== 'dismiss')
        || (props.autoFocus !== undefined && props.autoFocus !== true)) throw new ClaudeProtocolError('native UI button style is invalid')
      for (const name of ['color', 'hotkeyColor'] as const) if (props[name] !== undefined && (typeof props[name] !== 'string' || props[name].length > 256)) throw new ClaudeProtocolError('native UI button color is invalid')
      if (props.hotkey !== undefined && (typeof props.hotkey !== 'string' || props.hotkey.length !== 1 || !/^[0-9a-z]$/.test(props.hotkey))) throw new ClaudeProtocolError('native UI button hotkey is invalid')
      // The native wire carries a normalized accessible label alongside optional inline children.
      function validateInline(child: unknown): void {
        if (typeof child === 'string') return
        if (!record(child) || child.type !== 'Text' || (child.children !== undefined && !Array.isArray(child.children))) throw new ClaudeProtocolError('native UI button children must be text')
        if (Array.isArray(child.children)) child.children.forEach(validateInline)
      }
      if (value.children !== undefined && !Array.isArray(value.children)) throw new ClaudeProtocolError('native UI button children are invalid')
      if (Array.isArray(value.children)) value.children.forEach(validateInline)
      const hover = readClaudeUiHover(value, props)
      const button: ClaudeUiNode = { kind: 'button', ...(typeof props._apackExpanded === 'boolean' ? {expanded:props._apackExpanded} : {}), ...(typeof props.color === 'string' ? { color: props.color } : {}), ...(typeof props.hotkeyColor === 'string' ? { hotkeyColor: props.hotkeyColor } : {}), ...(hover ? { hover } : {}), label: props.label as string, ...attribution,
        ...(Array.isArray(value.children) && value.children.length ? { children: value.children.map(child => visit(child, plugin)) } : {}),
        ...(props.hotkey !== undefined ? { hotkey: props.hotkey as string } : {}),
        ...(props.dimColor !== undefined ? { dimColor: props.dimColor as boolean } : {}),
        ...(props.variant !== undefined ? { variant: props.variant as 'primary' | 'secondary' } : {}),
        ...(props.role === 'dismiss' ? { role: 'dismiss' as const } : {}),
        ...(props.autoFocus === true ? { autoFocus: true } : {}) }
      if (value.press === undefined) return button
      if (!record(value.press) || typeof value.press.plugin !== 'string' || !value.press.plugin
        || typeof value.press.handle !== 'number' || !Number.isSafeInteger(value.press.handle)
        || (value.props.key !== undefined && typeof value.props.key !== 'string')) {
        throw new ClaudeProtocolError('native UI button has an invalid callback')
      }
      const actionId = actionIdentity(value.type,value.press.plugin,props.key)
      actions.set(actionId, { plugin: value.press.plugin, handle: value.press.handle,
        ...(typeof value.props.key === 'string' ? { key: value.props.key } : {}) })
      return { ...button, actionId, ...focusIdentity(value.press.plugin, props.key) }
    }
    return { kind: 'unsupported', component: value.type, ...attribution }
  }
  const result = visit(tree)
  const targets = [...scrollBoxes, ...focusables]
  const counts = new Map<string, number>()
  for (const [, identity] of targets) { const key = JSON.stringify(identity); counts.set(key, (counts.get(key) ?? 0) + 1) }
  const scrollTargets = new Map(targets.filter(([, identity]) => counts.get(JSON.stringify(identity)) === 1))
  return { tree: result, clientInstances, clientActions, actions, fields, links, focusables, scrollTargets }
}
