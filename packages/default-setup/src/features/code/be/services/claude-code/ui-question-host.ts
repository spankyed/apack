import { ClaudeQuestionAnswerSchema, ClaudeQuestionCountdownEventSchema, type ClaudeQuestionImage, type ClaudeQuestionPartialAnswer } from '../../../common/native-question.ts'
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
type Entry = { partialSequence?: number; countdownSequence?: number; row: ClaudeUiQuestionRow; frame: ClaudeUiQuestionFrame; epoch: number; dirty: boolean; pressing: boolean; heldToken?: string; holding?: Promise<void>; answering?: boolean; drawing?: ClaudeUiDrawing; fields?: ClaudeUiDrawing; revisions: Map<string, number> }

/** A question drawing belongs to this view and the still-pending native dialog. */
export function createClaudeQuestionHost(options: {
  source?: ClaudeUiOwner['question']
  ui: Pick<ClaudeUiControls, 'press' | 'input' | 'select'>
  client: { client_id: string; surface: 'desktop' }
  row(): ClaudeUiQuestionRow | undefined
  current(): boolean
  publish(): void
  pause?(row: ClaudeUiQuestionRow, ownerId: string): Promise<void>
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
      if (event.subtype === 'apack_question_countdown') {
        const target = entry, countdown = ClaudeQuestionCountdownEventSchema.safeParse(event)
        if (!target || !valid(target) || !countdown.success) return
        const value = countdown.data, row = target.row
        if (value.session_id !== row.sessionId || value.dialog_id !== row.id || value.revision !== row.revision ||
            value.request_id !== row.requestId || value.sequence <= (target.countdownSequence ?? 0)) return
        target.countdownSequence = value.sequence
        target.frame = { ...target.frame, countdownSeconds: value.seconds ?? undefined }
        publish()
        return
      }
      if (event.type !== 'system' || event.subtype !== 'ui_invalidate' || event.event !== 'ui.render' || !entry) return
      if (Array.isArray(event.instances) && !event.instances.some(value => value && typeof value === 'object' && (value as Record<string, unknown>).component === 'AskUserQuestion' && (value as Record<string, unknown>).instance_id === entry!.row.requestId)) return
      invalidate()
    },
    async stagePartial(messageId: string, token: string, sequence: number, answer: ClaudeQuestionPartialAnswer) {
      const target = entry
      if (!target || !valid(target) || !options.source || target.row.messageId !== messageId ||
          !Number.isSafeInteger(sequence) || sequence <= (target.partialSequence ?? 0)) return
      target.partialSequence = sequence
      try {
        await target.holding
        if (!valid(target) || target.partialSequence !== sequence || token !== (target.heldToken ?? target.frame.token)) return
        await options.source.hold({ ...target.row, clientId: options.client.client_id, renderToken: token, partial: { sequence, answer } })
      } catch {
        if (valid(target) && target.partialSequence === sequence) {
          target.frame.problem = 'Claude did not save this partial answer for auto-continue.'
          publish()
        }
      }
    },
    async answer(messageId: string, token: string, answer: import('../../../common/native-question.ts').ClaudeQuestionAnswer, decision?: 'clarify', images?: readonly ClaudeQuestionImage[]): Promise<void> {
      const target = entry
      if (!target || !valid(target) || !options.source?.answer || target.answering || target.row.messageId !== messageId || !target.frame.shownInput || token !== (target.heldToken ?? target.frame.token)) return
      const parsed = ClaudeQuestionAnswerSchema.safeParse(answer)
      if (!parsed.success) return
      target.answering = true; target.frame.pending = true; target.frame.problem = undefined; publish()
      try {
        await target.holding
        if (!valid(target) || token !== (target.heldToken ?? target.frame.token)) return
        await options.source.answer({...target.row, answer: {...target.frame.shownInput, ...parsed.data}, ...(decision ? { decision } : {}), ...(images ? { images } : {}), renderToken: token, draftStarted: !!target.heldToken})
        if (valid(target)) { entry = undefined; publish() }
      } catch (error) {
        if (valid(target)) { target.frame.problem = error instanceof Error ? error.message : 'Native question answer failed'; publish() }
      } finally { target.answering = false; target.frame.pending = false; if (valid(target)) publish() }
    },
    async reject(messageId: string, token: string): Promise<void> {
      const target=entry
      if(!target||!valid(target)||!options.source?.reject||target.answering||target.row.messageId!==messageId||token!==(target.heldToken??target.frame.token))return
      target.answering=true;target.frame.pending=true;target.frame.problem=undefined;publish()
      try {
        await target.holding
        if(!valid(target)||token!==(target.heldToken??target.frame.token))return
        await options.source.reject({...target.row,renderToken:token,draftStarted:!!target.heldToken})
        if(valid(target)){entry=undefined;publish()}
      }catch(error){if(valid(target)){target.frame.problem=error instanceof Error?error.message:'Native question rejection failed';publish()}}
      finally{target.answering=false;target.frame.pending=false;if(valid(target))publish()}
    },
    async pause(messageId: string, token: string): Promise<boolean> {
      const target = entry;
      if (!target || !valid(target) || !options.source || !options.pause || target.answering || target.row.messageId !== messageId || !token || token !== (target.heldToken ?? target.frame.token) && !target.holding) return false;
      target.answering = true; target.frame.pending = true; target.frame.problem = undefined; publish();
      try {
        await target.holding;
        if (!valid(target) || token !== (target.heldToken ?? target.frame.token)) return false;
        await options.pause({ ...target.row }, options.source.ownerId);
        if (valid(target)) { entry = undefined; publish(); }
        return true;
      } catch (error) {
        if (valid(target)) { target.frame.problem = error instanceof Error ? error.message : 'Native question cancellation failed'; publish(); }
        return false;
      } finally { target.answering = false; target.frame.pending = false; if (valid(target)) publish(); }
    },
    ownsAction(id: string) { return !!entry?.drawing?.actions.has(id) },
    ownsField(id: string) { return entry?.frame.draftActionId === id || !!entry?.fields?.fields.has(id) },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      const target = entry
      if (!target || !valid(target) || !options.source || !Number.isSafeInteger(event.revision) || event.revision <= (target.revisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      if (event.actionId === target.frame.draftActionId) {
        if (event.kind !== 'change') return { handled: false }
        target.revisions.set(event.actionId, event.revision)
        try {
          target.holding = options.source.hold({ ...target.row, clientId: options.client.client_id, renderToken: event.value })
          await target.holding
          if (valid(target)) { target.heldToken = event.value; invalidate() }
          return { handled: valid(target) }
        } catch {
          if (valid(target)) { target.frame.problem = 'Native question draft was not acknowledged'; publish() }
          return { handled: false }
        }
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
        // eslint-disable-next-line no-control-regex -- Match or reject native terminal control sequences explicitly.
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
