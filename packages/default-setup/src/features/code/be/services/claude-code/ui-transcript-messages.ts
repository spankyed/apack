import { stripVTControlCharacters } from 'node:util'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import { claudeAssistantDisplayText } from '../../../common/claude-message-display.ts'
import type { ClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiTranscriptFrame, ClaudeUiTranscriptRow, ClaudeUiFieldEvent, ClaudeUiNode } from './ui-presentation.ts'

type Entry = {
  row: ClaudeUiTranscriptRow
  epoch: number
  instanceRevision: number
  released?: boolean
  releasePromise?: Promise<void>
  dirty: boolean
  pressing: boolean
  body: ClaudeUiTranscriptFrame['body']
  displayText: string
  outputRewritten?: boolean
  engineOutput?: string
  drawing?: ClaudeUiDrawing
  fields?: ClaudeUiDrawing
  revisions: Map<string, number>
  completed: Map<string, number>
}
function inert(node: ClaudeUiNode): ClaudeUiNode {
  if (node.kind === 'button' || node.kind === 'markdown') { const { actionId: _, ...rest } = node; return rest }
  if ('children' in node && node.children) return { ...node, children: node.children.map(inert) }
  return node
}
const rowKey = (row: ClaudeUiTranscriptRow) => JSON.stringify([row.component, row.uuid])
const sameSource = (a: ClaudeUiTranscriptRow, b: ClaudeUiTranscriptRow) => a.component === b.component && a.uuid === b.uuid && a.sessionId === b.sessionId && a.messageId === b.messageId && a.text === b.text && a.start === b.start && a.end === b.end && (a.component !== 'ToolResult' || b.component !== 'ToolResult' || a.blockIndex === b.blockIndex && a.resultUuid === b.resultUuid && a.assistantUuid === b.assistantUuid && a.tool === b.tool) && (a.component !== 'ToolUse' && a.component !== 'ToolProgress' || b.component !== 'ToolUse' && b.component !== 'ToolProgress' || a.blockIndex === b.blockIndex && a.assistantUuid === b.assistantUuid && a.resultUuid === b.resultUuid && a.activityStatus === b.activityStatus) && (a.component !== 'AssistantMessage' || b.component !== 'AssistantMessage' || (a.isSummary === b.isSummary && (!a.isSummary || (b.isSummary && a.blockIndex === b.blockIndex))))
const same = (a: ClaudeUiTranscriptRow, b: ClaudeUiTranscriptRow) => {
  if (!sameSource(a, b)) return false
  if (a.component === 'AssistantMessage' && b.component === 'AssistantMessage') return a.isFirstOfReply === b.isFirstOfReply
  if (a.component === 'UserMessage' && b.component === 'UserMessage') return a.isExpanded === b.isExpanded && JSON.stringify(a.origin) === JSON.stringify(b.origin)
  if ((a.component === 'ToolUse' || a.component === 'ToolProgress') && (b.component === 'ToolUse' || b.component === 'ToolProgress')) return true
  if (a.component === 'ToolResult' && b.component === 'ToolResult') return a.isErrored === b.isErrored
  return a.component === 'CommandOutput' && b.component === 'CommandOutput' && a.isErrored === b.isErrored
}
const originalDisplayText = (row: ClaudeUiTranscriptRow) => row.component === 'AssistantMessage' ? claudeAssistantDisplayText(row.isSummary ? row.text.trim() : row.text) : row.text

/** Message instances share one view attachment; each keeps its own drawing and callback lifetime. */
export function createClaudeTranscriptMessageHost(options: {
  ui: Pick<ClaudeUiControls, 'render' | 'press' | 'input' | 'select' | 'releaseInstance'>
  client: { client_id: string; surface: 'desktop' }
  rows(): ClaudeUiTranscriptRow[]
  current(): boolean
  publish(): void
}) {
  const entries = new Map<string, Entry>()
  let disposed = false, started = false, rendering = false, refreshPending = false, nextInstanceRevision = 0
  let disposal: Promise<void> | undefined
  const releases = new Set<Promise<void>>()
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const current = () => !disposed && options.current()
  const present = (entry: Entry) => current() && entries.get(rowKey(entry.row)) === entry
  const valid = (entry: Entry) => present(entry) && options.rows().some(row => same(row, entry.row))
  const publish = () => { if (current()) options.publish() }
  function retire(entry: Entry, clientSnapshot = false) {
    entry.epoch++; entry.dirty = true
    if (clientSnapshot) return
    entry.drawing = undefined
    entry.body = entry.fields && (entry.fields.fields.size || entry.fields.clientInstances.size) ? { status: 'live', tree: inert(entry.fields.tree) } : { status: 'rendering' }
  }
  function release(entry: Entry): Promise<void> {
    const currentEntry = entries.get(rowKey(entry.row))
    if (currentEntry && currentEntry !== entry && currentEntry.instanceRevision === entry.instanceRevision) return Promise.resolve()
    if (entry.released) return Promise.resolve()
    if (entry.releasePromise) return entry.releasePromise
    const pending = options.ui.releaseInstance({ client_id: options.client.client_id, component: entry.row.component, instance_id: entry.row.uuid, instance_revision: entry.instanceRevision }).then(() => { entry.released = true }, () => {}).finally(() => { releases.delete(pending); entry.releasePromise = undefined })
    entry.releasePromise = pending; releases.add(pending)
    return pending
  }
  function sync() {
    if (!current()) return
    const rows = options.rows(), wanted = new Set(rows.map(rowKey))
    let changed = false
    for (const [id, entry] of entries) if (!wanted.has(id)) { entries.delete(id); void release(entry); changed = true }
    for (const row of rows) {
      const prior = entries.get(rowKey(row))
      if (prior && same(prior.row, row)) continue
      if (prior && sameSource(prior.row, row)) { prior.row = row; retire(prior); changed = true; continue }
      const sameInstance = prior?.row.sessionId === row.sessionId
      if (prior && !sameInstance) void release(prior)
      entries.set(rowKey(row), { row, instanceRevision: sameInstance ? prior!.instanceRevision : ++nextInstanceRevision, epoch: 0, dirty: true, pressing: false, body: { status: 'rendering' }, displayText: originalDisplayText(row), revisions: new Map(), completed: new Map() })
      changed = true
    }
    if (changed) publish()
  }
  function schedule() {
    if (!started || !current() || rendering || scheduled) return
    scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
  }
  async function render() {
    if (!current() || rendering) return
    rendering = true
    try {
      if (refreshPending) { refreshPending = false; sync() }
      for (const entry of entries.values()) {
        if (!entry.dirty || !current()) continue
        entry.dirty = false
        const epoch = entry.epoch, completed = new Map(entry.completed)
        try {
          const result = await options.ui.render({ ...options.client, component: entry.row.component, instance_id: entry.row.uuid, instance_revision: entry.instanceRevision,
            props: entry.row.component === 'AssistantMessage' ? { text: originalDisplayText(entry.row), isFirstOfReply: entry.row.isFirstOfReply, ...(entry.row.isSummary ? { isSummary: true } : {}) }
              : (entry.row.component === 'ToolUse' || entry.row.component === 'ToolProgress') ? { assistant_uuid: entry.row.assistantUuid }
              : entry.row.component === 'ToolResult' ? { source_uuid: entry.row.resultUuid, assistant_uuid: entry.row.assistantUuid, text: entry.row.text, tool: entry.row.tool, isErrored: entry.row.isErrored }
              : entry.row.component === 'CommandOutput' ? { text: entry.row.text, isErrored: entry.row.isErrored }
              : { text: entry.row.text, origin: entry.row.origin, isExpanded: entry.row.isExpanded } })
          if (!valid(entry) || epoch !== entry.epoch) { if (!present(entry)) void release(entry); continue }
          const drawing = createClaudeUiDrawing(result.tree, entry.fields)
          function stamp(node: ClaudeUiNode) {
            if (node.kind === 'input' || node.kind === 'select') node.revision = completed.get(node.actionId) ?? 0
            else if ('children' in node) node.children?.forEach(stamp)
          }
          stamp(drawing.tree)
          entry.drawing = drawing; entry.fields = drawing
          entry.displayText = typeof result.props.text === 'string' ? entry.row.component === 'CommandOutput' ? stripVTControlCharacters(result.props.text).trim() : entry.row.component === 'UserMessage' && result.rewritten ? result.props.text.slice(0, 100000) : result.props.text : originalDisplayText(entry.row)
          entry.outputRewritten = entry.row.component === 'ToolResult' && result.output_rewritten === true
          entry.engineOutput = entry.row.component === 'ToolResult' || (entry.row.component === 'ToolUse' || entry.row.component === 'ToolProgress') ? result.engine_output : undefined
          if (entry.outputRewritten) entry.displayText = typeof result.props.output === 'string' ? result.props.output : JSON.stringify(result.props.output, null, 2) ?? ''
          entry.body = { status: 'live', tree: drawing.tree }
          for (const id of entry.revisions.keys()) if (!drawing.fields.has(id)) { entry.revisions.delete(id); entry.completed.delete(id) }
          publish()
        } catch {
          if (!present(entry)) void release(entry)
          if (present(entry) && epoch === entry.epoch) fail(entry)
        }
      }
    } finally {
      rendering = false
      if (refreshPending || [...entries.values()].some(entry => entry.dirty)) schedule()
    }
  }
  function fail(entry: Entry) {
    entry.outputRewritten = false; entry.engineOutput = undefined
    if (!present(entry)) return
    entry.epoch++; entry.dirty = false; entry.drawing = undefined; entry.fields = undefined
    entry.displayText = originalDisplayText(entry.row); entry.body = { status: 'error' }; publish()
  }
  function refresh() { if (!current()) return; sync(); if ([...entries.values()].some(entry => entry.dirty)) schedule() }
  function invalidate(entry: Entry) { if (present(entry)) { retire(entry); publish(); schedule() } }
  return {
    get state(): ClaudeUiTranscriptFrame[] { return [...entries.values()].map(entry => ({ ...entry.row, displayText: entry.displayText, ...(entry.engineOutput !== undefined ? { engineOutput: entry.engineOutput } : {}), ...(entry.outputRewritten ? { outputRewritten: true } : {}), body: entry.body })) },
    start() { started = true; refresh() },
    refresh,
    receive(line: Record<string, unknown>) {
      if (!current()) return
      if (line.type === 'system' && line.subtype === 'ui_invalidate' && line.event === 'ui.render') {
        const snapshot = line.client_snapshot === true
        if (snapshot && line.client_id !== options.client.client_id) return
        const sites = Array.isArray(line.instances) ? line.instances : undefined
        let changed = false
        for (const entry of entries.values()) if (!entry.dirty && (!snapshot || !sites || sites.some(site => site.surface === 'desktop' && site.component === entry.row.component && site.instance_id === entry.row.uuid))) { retire(entry, snapshot); changed = true }
        if (changed) publish()
        refreshPending = true; schedule()
      } else if (line.type === 'assistant' || (line.type === 'user' && line.isReplay === true) || (line.type === 'system' && line.subtype === 'init') || line.type === 'conversation_reset') {
        // Owner observers run before the chat consumer persists this completed row.
        refreshPending = true; schedule()
      }

    },
    dispose() { if (disposal) return disposal; disposed = true; for (const entry of entries.values()) void release(entry); entries.clear(); if (scheduled) clearTimeout(scheduled); scheduled = undefined; disposal = Promise.allSettled([...releases]).then(() => {}); return disposal },
    ownsAction(id: string) { return [...entries.values()].some(entry => entry.drawing?.actions.has(id)) },
    ownsField(id: string) { return [...entries.values()].some(entry => entry.fields?.fields.has(id)) },
    async press(id: string, href?: string): Promise<{ handled: boolean }> {
      const entry = [...entries.values()].find(value => value.drawing?.actions.has(id))
      if (!entry || !valid(entry) || entry.pressing) return { handled: false }
      const action = entry.drawing!.actions.get(id)!, link = entry.drawing!.links.has(id)
      if (link) {
        if (!href || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return { handled: false }
        try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return { handled: false } } catch { return { handled: false } }
      } else if (href !== undefined) return { handled: false }
      let failed = false
      entry.pressing = true; retire(entry); publish()
      try {
        const result = await options.ui.press({ ...options.client, ...action, component: entry.row.component, instance_id: entry.row.uuid, instance_revision: entry.instanceRevision, ...(link ? { href } : {}) })
        return { handled: valid(entry) && result.handled }
      } catch { failed = true; fail(entry); return { handled: false } }
      finally { entry.pressing = false; if (!failed && present(entry)) invalidate(entry) }
    },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      const entry = [...entries.values()].find(value => value.fields?.fields.has(event.actionId))
      if (!entry || !valid(entry) || !Number.isSafeInteger(event.revision) || event.revision <= (entry.revisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      const field = entry.fields!.fields.get(event.actionId)!
      if (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit') return { handled: false }
      entry.revisions.set(event.actionId, event.revision)
      const identity = { ...options.client, plugin: field.plugin, handle: field.handle, key: field.key, component: entry.row.component, instance_id: entry.row.uuid, instance_revision: entry.instanceRevision, value: event.value }
      try {
        const result = field.type === 'select' ? await options.ui.select(identity) : await options.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
        if (valid(entry) && entry.fields?.fields.has(event.actionId)) { entry.completed.set(event.actionId, Math.max(entry.completed.get(event.actionId) ?? 0, event.revision)); invalidate(entry) }
        return { handled: valid(entry) && result.handled }
      } catch { fail(entry); return { handled: false } }
    },
  }
}
