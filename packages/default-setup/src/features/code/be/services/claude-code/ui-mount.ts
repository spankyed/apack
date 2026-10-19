import { createClaudeQuestionHost } from './ui-question-host.ts'
import { selectClaudeAgentTranscriptRows } from './ui-agent-transcript.ts'
import { createClaudeTranscriptMessageHost } from './ui-transcript-messages.ts'
import { createClaudeUiNotices } from './ui-notices.ts'
import { createClaudeSiteScroll } from './ui-site-scroll.ts'
import { createClaudePaneHost } from './ui-pane-host.ts'
import { randomUUID } from 'node:crypto'
import { createClaudeUiDrawing, type ClaudeUiDrawing } from './ui-tree.ts'
import type { ClaudeUiControls } from './ui-controls.ts'

import type { ClaudeUiFieldEvent, ClaudeUiFocusEvent, ClaudeUiFocusReply, ClaudeUiMountState, ClaudePromptEdit, ClaudePromptReply, ClaudePromptCompletionRequest, ClaudePromptCompletionReply } from './ui-presentation.ts'

export interface ClaudeUiOwner {
  readAgent?(): Promise<import('../../../common/native-terminal.ts').ClaudeNativeTaskDetails>
  readonly nativeView?: import('./ui-controls.ts').ClaudeUiAttach['native_view']
  readonly question?: { ownerId: string; render: import('./terminal-owner.ts').ClaudeNativeTerminalOwner['renderQuestionDialog']; hold: import('./terminal-owner.ts').ClaudeNativeTerminalOwner['holdQuestionDialog'] }
  readonly done: Promise<void>
  readonly sessionId?: string
  subscribe(listener: (event: unknown) => void): () => void
  handle: { ui: Pick<ClaudeUiControls, 'prepareParentCommand' | 'startParentCommand' | 'readParentCommand' | 'submitAgent' | 'agentPanel' | 'answerAgentCommand' | 'clientEvent' | 'servePrompt' | 'focus' | 'attach' | 'detach' | 'releaseInstance' | 'toolGroups' | 'render' | 'press' | 'input' | 'select' | 'promptEdit' | 'promptAutocomplete' | 'panes' | 'showPane' | 'focusPane' | 'closePane' | 'scroll'> }
}

/** One independent native attachment per mounted view; never starts or owns a conversation. */
export function mountClaudeUi(options: {
  owner: ClaudeUiOwner
  isCurrent(): boolean
  publish(state: ClaudeUiMountState): void
  requestFocus?(focusId: string, revision: number, paneId?: string): void
  question?(): import('./ui-presentation.ts').ClaudeUiQuestionRow | undefined
  messages?(groups: readonly import('./ui-controls.ts').ClaudeUiToolGroup[]): import('./ui-presentation.ts').ClaudeUiTranscriptRow[]
  promptHost?: import('./ui-prompt-host.ts').ClaudePromptHost
  nativeView?: import('./ui-controls.ts').ClaudeUiAttach['native_view']
}) {
  const { owner } = options
  const client = { client_id: `apack-${randomUUID()}`, surface: 'desktop' as const }
  const instanceId = 'above-prompt'
  let disposed = false
  let attached = false
  let attachmentError: string | undefined
  let dirty = false
  let rendering = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let drawing: ClaudeUiDrawing | undefined
  let fieldDrawing: ClaudeUiDrawing | undefined
  const fieldRevisions = new Map<string, number>()
  const completedFields = new Map<string, number>()
  let focusRevision = 0
  let promptRevision = 0
  let completionRevision = 0
  let generation = 0
  let pressing = false
  let stopPromptHost: (() => void) | undefined
  let disposal: Promise<void> | undefined
  let unsubscribe = () => {}
  let lastState: ClaudeUiMountState = { status: 'connecting' }
  let agent: import('../../../common/native-terminal.ts').ClaudeNativeTaskDetails | undefined
  let agentProblem: string | undefined
  let agentReading = false
  let agentTimer: ReturnType<typeof setInterval> | undefined
  let panelQueue = Promise.resolve()
  let agentInput: ClaudeUiMountState['agentInput']
  async function refreshAgent() {
    if (agentReading || !current() || !owner.readAgent && agentInput?.status !== 'panel') return
    agentReading = true
    try {
      const next = owner.readAgent ? await owner.readAgent() : undefined
      if (!current()) return
      agent = next; agentProblem = undefined
      const panelState = agentInput
      if (panelState?.status === 'panel' && panelState.panel) {
        const result = await owner.handle.ui.agentPanel({ client_id: client.client_id, panel_id: panelState.panel.id, operation: 'read' })
        if (!current()) return
        if (agentInput === panelState && !result.open) agentInput = { revision: panelState.revision, status: 'panel_done' }
      }
      messages.refresh(); publish(lastState)
    } catch (error) { if (current()) { agentProblem = error instanceof Error ? error.message : 'Agent conversation could not refresh'; publish(lastState) } }
    finally { agentReading = false }
  }

  let panes: ReturnType<typeof createClaudePaneHost> | undefined
  const scroll = createClaudeSiteScroll({ ui: owner.handle.ui, client, component: 'AbovePrompt', instanceId, current, drawing: () => drawing ?? fieldDrawing, publish: () => publish(lastState) })

  const messages = createClaudeTranscriptMessageHost({ ui: owner.handle.ui, client, current, rows: groups => {
    const rows = [...(owner.readAgent ? selectClaudeAgentTranscriptRows(agent, owner.sessionId ?? '') : options.messages?.(groups) ?? [])]
    // Native local output can remain live without ever entering the saved journal.
    const output = agentInput?.status === 'command_output' ? agentInput.output : undefined
    if (!owner.nativeView && owner.sessionId && output && !rows.some(row => row.uuid === output.messageId)) rows.push({ component: 'CommandOutput', messageId: output.messageId, uuid: output.messageId, sessionId: owner.sessionId, text: output.text, start: 0, end: output.text.length, isErrored: output.isErrored })
    return rows
  }, publish: () => publish(lastState) })

  const question = createClaudeQuestionHost({ source: owner.question, ui: owner.handle.ui, client, row: () => options.question?.(), current, publish: () => publish(lastState) })

  const notices = createClaudeUiNotices({ current, sessionId: () => owner.sessionId, publish: () => publish(lastState) })

  function publish(state: ClaudeUiMountState): void {
    // An observer must not break native attachment cleanup or the process event reader.
    lastState = state
    const pane = panes?.state?.roster
    notices.setHeld(pane?.panes.find(value => value.id === pane.shown_id)?.hold_toasts === true)
    try { options.publish({ ...state, ...(agent ? { agent } : {}), ...(agentProblem ? { agentProblem } : {}), ...(agentInput ? { agentInput } : {}), ...(question.state ? { question: question.state } : {}), ...(messages.state.length ? { transcriptMessages: messages.state } : {}), ...(notices.state ? { notices: notices.state } : {}), ...(panes?.state ? { panes: panes.state } : {}), ...(scroll.state ? { scroll: scroll.state } : {}) }) } catch { /* presentation is not process authority */ }
  }
  function current(): boolean {
    if (disposed) return false
    if (options.isCurrent()) return true
    void dispose().catch(() => {})
    return false
  }
  function schedule(): void {
    if (!attached || rendering || scheduled || !current()) return
    // At most one render in flight, with a bounded refresh rate during invalidation bursts.
    scheduled = setTimeout(() => { scheduled = undefined; void render() }, 50)
  }
  function retireDrawing(): void {
    if (!fieldDrawing || !fieldDrawing.fields.size && !fieldDrawing.clientInstances.size) { publish({ status: 'rendering' }); return }
    function retire(node: import('./ui-presentation.ts').ClaudeUiNode): import('./ui-presentation.ts').ClaudeUiNode {
      if (node.kind === 'button' || node.kind === 'markdown') {
        const { actionId: _, ...inert } = node
        return inert
      }
      if (node.kind === 'box' || node.kind === 'link' || node.kind === 'client') return { ...node, children: node.children.map(retire) }
      if (node.kind === 'text' && node.children) return { ...node, children: node.children.map(retire) }
      return node
    }
    // Keep in-progress fields mounted, but never display an expired button/link as actionable.
    publish({ status: 'live', tree: retire(fieldDrawing.tree) })
  }
  function invalidate(clientSnapshot = false): void {
    if (!current()) return
    generation++
    if (!clientSnapshot) drawing = undefined
    const alreadyDirty = dirty
    dirty = true
    if (attached && !alreadyDirty && !clientSnapshot) retireDrawing()
    schedule()
  }
  async function render(): Promise<void> {
    if (!current() || !dirty || rendering) return
    rendering = true
    dirty = false
    const revision = generation
    // Stamp only callbacks completed before this render began. A reply racing newer typing is stale.
    const completed = new Map(completedFields)
    try {
      const result = await owner.handle.ui.render({ ...client, component: 'AbovePrompt', instance_id: instanceId, props: {} })
      if (!current() || revision !== generation) return
      drawing = createClaudeUiDrawing(result.tree, fieldDrawing)
      function stamp(node: import('./ui-presentation.ts').ClaudeUiNode): void {
        if (node.kind === 'box' || node.kind === 'client') node.children.forEach(stamp)
        else if (node.kind === 'input' || node.kind === 'select') node.revision = completed.get(node.actionId) ?? 0
      }
      stamp(drawing.tree)
      for (const id of fieldRevisions.keys()) if (!drawing.fields.has(id)) { fieldRevisions.delete(id); completedFields.delete(id) }
      fieldDrawing = drawing
      publish({ status: 'live', tree: drawing.tree })
    } catch (error) {
      if (current() && revision === generation) {
        drawing = undefined
        fieldDrawing = undefined
        publish({ status: 'error', message: error instanceof Error ? error.message : 'Native UI render failed' })
      }
    } finally {
      rendering = false
      if (dirty) schedule()
    }
  }
  function dispose(): Promise<void> {
    if (disposal) return disposal
    disposed = true
    if (agentTimer) clearInterval(agentTimer)
    agentTimer = undefined
    panes?.dispose()
    scroll.dispose()
    notices.dispose()
    const messagesReleased = messages.dispose()
    question.dispose()
    stopPromptHost?.(); stopPromptHost = undefined
    fieldDrawing = undefined
    fieldRevisions.clear()
    completedFields.clear()
    generation++
    drawing = undefined
    if (scheduled) clearTimeout(scheduled)
    scheduled = undefined
    unsubscribe()
    publish({ status: 'disconnected' })
    disposal = (async () => {
      await ready
      await messagesReleased
      attached = false
      // Attach may have applied before a lost/error reply; detach is idempotent natively.
      await owner.handle.ui.detach(client.client_id)
    })()
    return disposal
  }

  panes = createClaudePaneHost({ ui: owner.handle.ui, client, current, publish: () => publish(lastState), requestFocus: options.requestFocus })
  publish({ status: 'connecting' })
  unsubscribe = owner.subscribe(event => {
    const line = event as Record<string, unknown>
    notices.receive(line)
    messages.receive(line)
    question.receive(line)
    panes?.receive(line)
    scroll.receive(line)
    if (line.type === 'system' && line.subtype === 'ui_focus' && current() && line.client_id === client.client_id && line.component === 'AbovePrompt' && line.instance_id === instanceId) {
      const target = [...(drawing?.focusables ?? [])].find(([, identity]) => identity.plugin === line.plugin && identity.key === line.key)
      if (target) { try { options.requestFocus?.(target[0], focusRevision) } catch { /* closed presentation */ } }
    }
    if (line.type === 'system' && line.subtype === 'ui_invalidate' && line.event === 'ui.render' && line.tool_groups !== true) {
      if (line.client_snapshot === true && line.client_id !== client.client_id) return
      invalidate(line.client_snapshot === true)
    }
  })
  const ready = (async () => {
    try {
      if (options.promptHost) stopPromptHost = owner.handle.ui.servePrompt(client.client_id, options.promptHost)
      await owner.handle.ui.attach({ ...client, ...((options.nativeView ?? owner.nativeView) ? { native_view: options.nativeView ?? owner.nativeView } : {}) })
      attached = true
      if (current()) { await refreshAgent(); if (!current()) return; invalidate(); messages.start(); question.start(); await panes?.start(); if (current()) agentTimer = setInterval(() => { void refreshAgent() }, 1000) }
    } catch (error) {
      stopPromptHost?.(); stopPromptHost = undefined
      attachmentError = error instanceof Error ? error.message : 'Native UI attachment failed'
      if (current()) publish({ status: 'error', message: attachmentError })
    }
  })()
  void owner.done.then(() => dispose(), () => dispose()).catch(() => {})

  return {
    ready,
    dispose,
    async submitParentCommand(revision: number, text: string, hasReferences: boolean): Promise<import('./ui-controls.ts').ClaudeParentCommandResult> {
      await ready
      if (owner.nativeView || !attached || !current()) throw new Error('Claude composer is not attached')
      if (!Number.isSafeInteger(revision) || revision <= (agentInput?.revision ?? 0) || ['pending', 'confirmation', 'deciding', 'panel'].includes(agentInput?.status ?? '')) throw new Error('A native command is pending')
      const prepared = await owner.handle.ui.prepareParentCommand({ client_id: client.client_id, text })
      if (prepared.kind !== 'prepared') { if (current()) { agentInput = undefined; messages.refresh(); publish(lastState) } return prepared }
      if (hasReferences) throw new Error('Remove attachments or references before running a native command')
      if (!current()) throw new Error('Claude composer changed before command execution')
      agentInput = { revision, status: 'pending' }; messages.refresh(); publish(lastState)
      const ticket = { client_id: client.client_id, command_id: prepared.id }
      try {
      let startError: unknown
      try { await owner.handle.ui.startParentCommand(ticket) } catch (error) { startError = error }
      // Execution is single-use. Read the held ticket even if reset invalidates this drawing.
      let retryUntil = Date.now() + 2000
      for (;;) {
        let outcome
        try { outcome = await owner.handle.ui.readParentCommand(ticket) }
        catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (Date.now() >= retryUntil || !/owner changed before its reply|reply identity does not match|session changed during UI request/.test(message)) throw error
          await new Promise(resolve => setTimeout(resolve, 50)); continue
        }
        retryUntil = Date.now() + 2000
        if (outcome.kind === 'running') { await new Promise(resolve => setTimeout(resolve, 50)); continue }
        if (outcome.kind === 'failed') throw new Error(outcome.message)
        if (outcome.kind === 'prepared') throw startError ?? new Error('Native command did not start')
        const result = outcome.result
        if (current()) {
          if (result.kind === 'panel') agentInput = { revision, status: 'panel', panel: { id: result.id, commandName: result.commandName } }
          else if (result.kind === 'command_output') agentInput = { revision, status: 'command_output', output: result }
          else if (result.kind === 'confirmation') agentInput = { revision, status: 'confirmation', command: result }
          else agentInput = { revision, status: 'done' }
          messages.refresh(); publish(lastState)
        }
        return result
      }
      } catch (error) { if (current()) { agentInput = { revision, status: 'error', problem: error instanceof Error ? error.message : 'Native command failed' }; publish(lastState) } throw error }
    },
    async submitAgent(revision: number, text: string) {
      if (!owner.nativeView || !current() || !Number.isSafeInteger(revision) || revision <= (agentInput?.revision ?? 0) || ['pending', 'confirmation', 'deciding', 'panel'].includes(agentInput?.status ?? '')) return
      agentInput = { revision, status: 'pending' }; messages.refresh(); publish(lastState)
      try {
        await ready
        if (!attached || !current()) return
        const result = await owner.handle.ui.submitAgent({ client_id: client.client_id, text })
        if (!current()) return
        if (result.kind === 'review') agentInput = { revision, status: 'review', review: { text: result.text, removed: result.removed } }
        else if (result.kind === 'panel') agentInput = { revision, status: 'panel', panel: { id: result.id, commandName: result.commandName } }
        else if (result.kind === 'command_output') agentInput = { revision, status: 'command_output', output: { messageId: result.messageId, commandName: result.commandName, text: result.text, isErrored: result.isErrored, ...(result.outcome ? { outcome: result.outcome } : {}) } }
        else if (result.kind === 'blocked') agentInput = { revision, status: 'blocked', problem: result.message }
        else if (result.kind === 'confirmation') agentInput = { revision, status: 'confirmation', command: { id: result.id, title: result.title, confirmLabel: result.confirmLabel, ...(result.commandName ? { commandName: result.commandName } : {}) } }
        else agentInput = { revision, status: 'done', receipt: { messageId: result.messageId } }
        publish(lastState); if (agentInput.status === 'done') void refreshAgent()
      } catch (error) { if (current()) { agentInput = { revision, status: 'error', problem: error instanceof Error ? error.message : 'Agent input failed' }; publish(lastState) } }
    },
    agentPanel(revision: number, panelId: string, text?: string) {
      panelQueue = panelQueue.then(async () => {
        if (!current() || agentInput?.status !== 'panel' || agentInput.revision !== revision || agentInput.panel?.id !== panelId) return
        const result = await owner.handle.ui.agentPanel({ client_id: client.client_id, panel_id: panelId, ...(text !== undefined ? { operation: 'input' as const, text } : { operation: 'close' as const }) })
        if (!current()) return
        if (!result.open && agentInput?.panel?.id === panelId) { agentInput = { revision, status: 'panel_done' }; publish(lastState) }
      }).catch(error => { if (current()) { agentProblem = error instanceof Error ? error.message : 'Native command panel failed'; publish(lastState) } })
      return panelQueue
    },
    async answerAgentCommand(revision: number, commandId: string, decision: 'confirm' | 'cancel') {
      if (!current() || agentInput?.status !== 'confirmation' || agentInput.revision !== revision || agentInput.command?.id !== commandId) return
      const command = agentInput.command
      agentInput = { revision, status: 'deciding', command, decision }; publish(lastState)
      try {
        await owner.handle.ui.answerAgentCommand({ client_id: client.client_id, command_id: commandId, decision })
        if (current()) { agentInput = { revision, status: 'command_done', command, decision }; publish(lastState); void refreshAgent() }
      } catch (error) { if (current()) { agentInput = { revision, status: 'error', problem: error instanceof Error ? error.message : 'Native command decision failed' }; publish(lastState) } }
    },
    refreshTranscript: () => { messages.refresh(); question.refresh() },
    notice(event: import('./ui-presentation.ts').ClaudeUiNoticeEvent) { notices.operate(event) },
    scroll(event: import('./ui-presentation.ts').ClaudeUiScrollEvent) { if (event.paneId) panes?.scroll(event); else scroll.report(event) },
    pane(event: import('./ui-presentation.ts').ClaudeUiPaneEvent) { return panes?.operate(event) },
    get promptRevision() { return promptRevision },
    async focus(event: ClaudeUiFocusEvent): Promise<ClaudeUiFocusReply | undefined> {
      if (event.paneId) return panes?.focus(event)
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= focusRevision || typeof event.isHeld !== 'boolean' || !['person', 'auto'].includes(event.by)) return
      focusRevision = event.revision
      const snapshot = drawing, revision = event.revision, epoch = generation
      const identity = typeof event.focusId === 'string' ? snapshot?.focusables.get(event.focusId) : event.focusId
      if (typeof event.focusId === 'string' && !identity) return
      await ready
      if (!attached || !current() || revision !== focusRevision || epoch !== generation) return
      const result = await owner.handle.ui.focus({ ...client, component: 'AbovePrompt', instance_id: instanceId,
        is_held: event.isHeld, by: event.by, ...(identity !== undefined ? { element: identity } : {}) })
      if (!current() || revision !== focusRevision || epoch !== generation || snapshot !== drawing) return
      if (identity === undefined) return
      const target = result.element === null ? null : [...(drawing?.focusables ?? [])].find(([, candidate]) => candidate.plugin === result.element?.plugin && candidate.key === result.element.key)?.[0]
      // An unrecognized native redirect must never focus a different view or an obsolete DOM node.
      if (target === undefined) return
      return { revision, moved: result.moved, focusId: target, ...(result.deny !== undefined ? { deny: result.deny } : {}) }
    },
    async autocompletePrompt(event: ClaudePromptCompletionRequest): Promise<ClaudePromptCompletionReply | undefined> {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= completionRevision) return
      completionRevision = event.revision
      const editRevision = promptRevision, { revision, ...box } = event
      try {
        await ready
        if (!current() || revision !== completionRevision || editRevision !== promptRevision) return
        if (!attached) return { revision, status: 'error', message: attachmentError ?? 'Native composer is not attached' }
        const result = await owner.handle.ui.promptAutocomplete({ ...client, ...box })
        if (!current() || revision !== completionRevision || editRevision !== promptRevision) return
        return { revision, status: 'ready', result }
      } catch (error) {
        if (current() && revision === completionRevision && editRevision === promptRevision) return { revision, status: 'error', message: error instanceof Error ? error.message : 'Native autocomplete failed' }
      }
    },
    async editPrompt(event: ClaudePromptEdit): Promise<ClaudePromptReply | undefined> {
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= promptRevision) return
      promptRevision = event.revision
      const { revision, ...box } = event
      try {
        await ready
        if (!current() || revision !== promptRevision) return
        if (!attached) return { revision, status: 'error', message: attachmentError ?? 'Native composer is not attached' }
        const frame = await owner.handle.ui.promptEdit({ ...client, ...box })
        if (!current() || revision !== promptRevision) return
        return { revision, status: 'applied', frame }
      } catch (error) {
        if (current() && revision === promptRevision) return { revision, status: 'error', message: error instanceof Error ? error.message : 'Native composer edit failed' }
      }
    },
    async clientEvent(event: import('./ui-presentation.ts').ClaudeUiClientEvent) {
      if(!current()||!attached)return {handled:false}
      return owner.handle.ui.clientEvent({...event,client_id:client.client_id})
    },
    async field(event: ClaudeUiFieldEvent): Promise<{ handled: boolean }> {
      if (question.ownsField(event.actionId)) return question.field(event)
      if (messages.ownsField(event.actionId)) return messages.field(event)
      if (panes?.ownsField(event.actionId)) return panes.field(event)
      if (!current() || !Number.isSafeInteger(event.revision) || event.revision <= (fieldRevisions.get(event.actionId) ?? 0) || typeof event.value !== 'string' || event.value.length > 16384) return { handled: false }
      const field = fieldDrawing?.fields.get(event.actionId)
      if (!field || (field.type === 'select' ? event.kind !== 'select' || !field.options?.includes(event.value) : event.kind !== 'change' && event.kind !== 'submit')) return { handled: false }
      fieldRevisions.set(event.actionId, event.revision)
      const identity = { ...client, plugin: field.plugin, handle: field.handle, key: field.key, component: 'AbovePrompt', instance_id: instanceId, value: event.value }
      // Native queues each plugin's field callbacks. Keyed identity safely re-resolves redraws.
      // Never retry a callback whose native side effect may already have happened.
      const result = field.type === 'select' ? await owner.handle.ui.select(identity)
        : await owner.handle.ui.input({ ...identity, kind: event.kind as 'change' | 'submit' })
      if (current() && fieldDrawing?.fields.has(event.actionId)) {
        completedFields.set(event.actionId, Math.max(completedFields.get(event.actionId) ?? 0, event.revision))
        invalidate()
      }
      return { handled: current() && result.handled }
    },
    /** No retry: a native press may have applied its side effect even if its reply was lost. */
    async press(actionId: string, href?: string): Promise<{ handled: boolean }> {
      if (question.ownsAction(actionId)) return question.press(actionId, href)
      if (messages.ownsAction(actionId)) return messages.press(actionId, href)
      if (panes?.ownsAction(actionId)) return panes.press(actionId, href)
      if (!current() || pressing) return { handled: false }
      const action = drawing?.actions.get(actionId)
      if (!action) return { handled: false }
      const isLink = drawing?.links.has(actionId)
      if (isLink) {
        if (!href || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href)) return { handled: false }
        try { if (!['https:', 'http:', 'file:'].includes(new URL(href).protocol)) return { handled: false } } catch { return { handled: false } }
        const allowed = drawing?.links.get(actionId)
        if (allowed && !allowed.has(href)) return { handled: false }
      } else if (href !== undefined) return { handled: false }
      pressing = true
      // Retire immediately; a second click cannot reuse an accepted capability.
      drawing = undefined
      retireDrawing()
      try {
        const result = await owner.handle.ui.press({ ...client, ...action, ...(href !== undefined ? { href } : {}) })
        return { handled: current() && result.handled }
      } finally {
        pressing = false
        if (current()) invalidate()
      }
    },
  }
}
