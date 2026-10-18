import { randomUUID } from 'node:crypto'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeUiControls } from './ui-controls.ts'
import type { ClaudeUiOwner } from './ui-mount.ts'
import type { ClaudeUiFieldEvent, ClaudeUiNode, ClaudeUiQuestionFrame, ClaudeUiQuestionRow } from './ui-presentation.ts'

const same = (a: ClaudeUiQuestionRow, b?: ClaudeUiQuestionRow) => !!b && a.messageId === b.messageId && a.id === b.id && a.revision === b.revision && a.sessionId === b.sessionId && a.requestId === b.requestId
function inert(node: ClaudeUiNode): ClaudeUiNode {
  if (node.kind === 'button' || node.kind === 'markdown') { const { actionId: _, ...rest } = node; return rest }
  if ('children' in node && node.children) return { ...node, children: node.children.map(inert) }
  return node
}
type Entry = { row: ClaudeUiQuestionRow; frame: ClaudeUiQuestionFrame; epoch: number; dirty: boolean; pressing: boolean; drawing?: ClaudeUiDrawing; fields?: ClaudeUiDrawing; revisions: Map<string, number> }

/** A question drawing belongs to this view and the still-pending native dialog. */
export function createClaudeQuestionHost(options: {
  source?: ClaudeUiOwner['question']
  ui: Pick<ClaudeUiControls, 'press' | 'input' | 'select'>
  client: { client_id: string; surface: 'desktop' }
  row(): ClaudeUiQuestionRow | undefined
  current(): boolean
  publish(): void
}) {
  let entry: Entry | undefined, disposed = false, started = false, rendering = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  const current = () => !disposed && options.current()
  const valid = (value: Entry) => current() && entry === value && same(value.row, options.row())
  const publish = () => { if (current()) options.publish() }
  function sync() {
    const row = options.row()
    if (!options.source || !row) { if (entry) { entry = undefined; publish() }; return }
    if (entry && same(entry.row, row)) return
    entry = { row, frame: { messageId: row.messageId, id: row.id, revision: row.revision, draftActionId: randomUUID(), body: { status: 'rendering' } }, epoch: 0, dirty: true, pressing: false, revisions: new Map() }
    publish()
  }
  function schedule() {
    if (!started || !current() || rendering || scheduled || !entry?.dirty) return
    scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
  }
  function invalidate() {
    if (!entry || !current()) return
    entry.epoch++; entry.dirty = true; entry.drawing = undefined
    if (entry.fields) entry.frame.body = { status: 'live', tree: inert(entry.fields.tree) }
    publish(); schedule()
  }
  async function render() {
    if (!entry || !options.source || !entry.dirty || !current() || rendering) return
    const target = entry, epoch = target.epoch
    rendering = true; target.dirty = false
    try {
      const result = await options.source.render({ ...target.row, clientId: options.client.client_id })
      if (!valid(target) || epoch !== target.epoch) return
      const drawing = createClaudeUiDrawing(result.tree, target.fields)
      function stamp(node: ClaudeUiNode) {
        if (node.kind === 'input' || node.kind === 'select') node.revision = target.revisions.get(node.actionId) ?? 0
        else if ('children' in node) node.children?.forEach(stamp)
      }
      stamp(drawing.tree)
      target.drawing = drawing; target.fields = drawing
      target.frame = { ...target.frame, token: result.question.token, shownInput: result.question.shownInput, presentation: result.question.presentation, body: { status: 'live', tree: drawing.tree } }
      publish()
    } catch {
      if (valid(target) && epoch === target.epoch) {
        target.drawing = undefined
        if (!target.fields) target.frame.body = { status: 'error', message: 'Native question controls unavailable. Use the native interface to continue.' }
        publish()
      }
    } finally { rendering = false; schedule() }
  }
  return {
    get state() { return entry && valid(entry) ? entry.frame : undefined },
    start() { started = true; sync(); schedule() },
    refresh() { if (current()) { sync(); schedule() } },
    receive(event: Record<string, unknown>) {
      if (event.type !== 'system' || event.subtype !== 'ui_invalidate' || event.event !== 'ui.render' || !entry) return
      if (Array.isArray(event.instances) && !event.instances.some(value => value && typeof value === 'object' && (value as Record<string, unknown>).component === 'AskUserQuestion' && (value as Record<string, unknown>).instance_id === entry!.row.requestId)) return
      invalidate()
    },
    ownsAction(id: string) { return !!entry?.drawing?.actions.has(id) },
    ownsField(id: string) { return entry?.frame.draftActionId === id || !!entry?.fields?.fields.has(id) },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      const target = entry
      if (!target || !valid(target) || !options.source || !Number.isSafeInteger(event.revision) || event.revision <= (target.revisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      if (event.actionId === target.frame.draftActionId) {
        if (event.kind !== 'change') return { handled: false }
        target.revisions.set(event.actionId, event.revision)
        try { await options.source.hold({ ...target.row, clientId: options.client.client_id, renderToken: event.value }); if (valid(target)) invalidate(); return { handled: valid(target) } } catch { return { handled: false } }
      }
      const field = target.fields?.fields.get(event.actionId)
      if (!field || (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit')) return { handled: false }
      target.revisions.set(event.actionId, event.revision)
      const identity = { ...options.client, plugin: field.plugin, handle: field.handle, key: field.key, component: 'AskUserQuestion', instance_id: target.row.requestId, value: event.value }
      const result = field.type === 'select' ? await options.ui.select(identity) : await options.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
      if (valid(target)) invalidate()
      return { handled: valid(target) && result.handled }
    },
    async press(id: string, href?: string): Promise<{ handled: boolean }> {
      const target = entry, drawing = target?.drawing, action = drawing?.actions.get(id)
      if (!target || !drawing || !action || !valid(target) || target.pressing) return { handled: false }
      if (drawing.links.has(id)) {
        if (!href || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return { handled: false }
        try { if (!['http:', 'https:', 'file:'].includes(new URL(href).protocol)) return { handled: false } } catch { return { handled: false } }
        const allowed = drawing.links.get(id); if (allowed && !allowed.has(href)) return { handled: false }
      }
      target.pressing = true
      try { const result = await options.ui.press({ ...options.client, ...action, ...(drawing.links.has(id) ? { href } : {}) }); if (valid(target)) invalidate(); return { handled: valid(target) && result.handled } }
      finally { target.pressing = false }
    },
    dispose() { disposed = true; entry = undefined; if (scheduled) clearTimeout(scheduled); scheduled = undefined },
  }
}
