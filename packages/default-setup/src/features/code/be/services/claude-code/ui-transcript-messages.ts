import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import { claudeAssistantDisplayText } from '../../../common/claude-message-display.ts'
import type { ClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiTranscriptFrame, ClaudeUiTranscriptRow, ClaudeUiFieldEvent, ClaudeUiNode } from './ui-presentation.ts'

type Entry = {
  row: ClaudeUiTranscriptRow
  epoch: number
  dirty: boolean
  pressing: boolean
  body: ClaudeUiTranscriptFrame['body']
  displayText: string
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
const sameSource = (a: ClaudeUiTranscriptRow, b: ClaudeUiTranscriptRow) => a.component === b.component && a.uuid === b.uuid && a.sessionId === b.sessionId && a.messageId === b.messageId && a.text === b.text && a.start === b.start && a.end === b.end && (a.component !== 'AssistantMessage' || b.component !== 'AssistantMessage' || (a.isSummary === b.isSummary && (!a.isSummary || (b.isSummary && a.blockIndex === b.blockIndex))))
const same = (a: ClaudeUiTranscriptRow, b: ClaudeUiTranscriptRow) => sameSource(a, b) && (a.component === 'AssistantMessage' && b.component === 'AssistantMessage' ? a.isFirstOfReply === b.isFirstOfReply : a.component === 'UserMessage' && b.component === 'UserMessage' && a.isExpanded === b.isExpanded && JSON.stringify(a.origin) === JSON.stringify(b.origin))
const originalDisplayText = (row: ClaudeUiTranscriptRow) => row.component === 'AssistantMessage' ? claudeAssistantDisplayText(row.isSummary ? row.text.trim() : row.text) : row.text

/** Message instances share one view attachment; each keeps its own drawing and callback lifetime. */
export function createClaudeTranscriptMessageHost(options: {
  ui: Pick<ClaudeUiControls, 'render' | 'press' | 'input' | 'select'>
  client: { client_id: string; surface: 'desktop' }
  rows(): ClaudeUiTranscriptRow[]
  current(): boolean
  publish(): void
}) {
  const entries = new Map<string, Entry>()
  let disposed = false, started = false, rendering = false, refreshPending = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const current = () => !disposed && options.current()
  const present = (entry: Entry) => current() && entries.get(entry.row.uuid) === entry
  const valid = (entry: Entry) => present(entry) && options.rows().some(row => same(row, entry.row))
  const publish = () => { if (current()) options.publish() }
  function retire(entry: Entry) {
    entry.epoch++; entry.dirty = true; entry.drawing = undefined
    entry.body = entry.fields?.fields.size ? { status: 'live', tree: inert(entry.fields.tree) } : { status: 'rendering' }
  }
  function sync() {
    if (!current()) return
    const rows = options.rows(), wanted = new Set(rows.map(row => row.uuid))
    let changed = false
    for (const [id] of entries) if (!wanted.has(id)) { entries.delete(id); changed = true }
    for (const row of rows) {
      const prior = entries.get(row.uuid)
      if (prior && same(prior.row, row)) continue
      if (prior && sameSource(prior.row, row)) { prior.row = row; retire(prior); changed = true; continue }
      entries.set(row.uuid, { row, epoch: 0, dirty: true, pressing: false, body: { status: 'rendering' }, displayText: originalDisplayText(row), revisions: new Map(), completed: new Map() })
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
          const result = await options.ui.render({ ...options.client, component: entry.row.component, instance_id: entry.row.uuid,
            props: entry.row.component === 'AssistantMessage' ? { text: originalDisplayText(entry.row), isFirstOfReply: entry.row.isFirstOfReply, ...(entry.row.isSummary ? { isSummary: true } : {}) }
              : { text: entry.row.text, origin: entry.row.origin, isExpanded: entry.row.isExpanded } })
          if (!valid(entry) || epoch !== entry.epoch) continue
          const drawing = createClaudeUiDrawing(result.tree, entry.fields)
          function stamp(node: ClaudeUiNode) {
            if (node.kind === 'input' || node.kind === 'select') node.revision = completed.get(node.actionId) ?? 0
            else if ('children' in node) node.children?.forEach(stamp)
          }
          stamp(drawing.tree)
          entry.drawing = drawing; entry.fields = drawing
          entry.displayText = typeof result.props.text === 'string' ? entry.row.component === 'UserMessage' && result.rewritten ? result.props.text.slice(0, 100000) : result.props.text : originalDisplayText(entry.row)
          entry.body = { status: 'live', tree: drawing.tree }
          for (const id of entry.revisions.keys()) if (!drawing.fields.has(id)) { entry.revisions.delete(id); entry.completed.delete(id) }
          publish()
        } catch {
          if (present(entry) && epoch === entry.epoch) { entry.drawing = undefined; entry.fields = undefined; entry.displayText = originalDisplayText(entry.row); entry.body = { status: 'error' }; publish() }
        }
      }
    } finally {
      rendering = false
      if (refreshPending || [...entries.values()].some(entry => entry.dirty)) schedule()
    }
  }
  function fail(entry: Entry) {
    if (!present(entry)) return
    entry.epoch++; entry.dirty = false; entry.drawing = undefined; entry.fields = undefined
    entry.displayText = originalDisplayText(entry.row); entry.body = { status: 'error' }; publish()
  }
  function refresh() { if (!current()) return; sync(); if ([...entries.values()].some(entry => entry.dirty)) schedule() }
  function invalidate(entry: Entry) { if (present(entry)) { retire(entry); publish(); schedule() } }
  return {
    get state(): ClaudeUiTranscriptFrame[] { return [...entries.values()].map(entry => ({ ...entry.row, displayText: entry.displayText, body: entry.body })) },
    start() { started = true; refresh() },
    refresh,
    receive(line: Record<string, unknown>) {
      if (!current()) return
      if (line.type === 'system' && line.subtype === 'ui_invalidate' && line.event === 'ui.render') {
        let changed = false
        for (const entry of entries.values()) if (!entry.dirty) { retire(entry); changed = true }
        if (changed) publish()
        refreshPending = true; schedule()
      } else if (line.type === 'assistant' || (line.type === 'user' && line.isReplay === true) || (line.type === 'system' && line.subtype === 'init') || line.type === 'conversation_reset') {
        // Owner observers run before the chat consumer persists this completed row.
        refreshPending = true; schedule()
      }

    },
    dispose() { disposed = true; entries.clear(); if (scheduled) clearTimeout(scheduled); scheduled = undefined },
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
        const result = await options.ui.press({ ...options.client, ...action, ...(link ? { href } : {}) })
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
      const identity = { ...options.client, plugin: field.plugin, handle: field.handle, key: field.key, component: entry.row.component, instance_id: entry.row.uuid, value: event.value }
      try {
        const result = field.type === 'select' ? await options.ui.select(identity) : await options.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
        if (valid(entry) && entry.fields?.fields.has(event.actionId)) { entry.completed.set(event.actionId, Math.max(entry.completed.get(event.actionId) ?? 0, event.revision)); invalidate(entry) }
        return { handled: valid(entry) && result.handled }
      } catch { fail(entry); return { handled: false } }
    },
  }
}
