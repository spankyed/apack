import {createHash, randomUUID} from 'node:crypto'

export interface ClaudeNativeEditorScope {
  pid: number
  sessionId: string
  clientId: string
  panelId: string
}
export interface ClaudeNativeEditorOffer {
  pid: number
  parentPid: number
  fileIdentity: string
  content: string
}
export type ClaudeNativeEditorDecision = {kind: 'save'; content: string} | {kind: 'cancel'}
export interface ClaudeNativeEditorSnapshot {
  id: string
  revision: string
  scope: ClaudeNativeEditorScope
  content: string
  closing: boolean
}
type EditorArm = {
  scope: ClaudeNativeEditorScope
  native: Promise<unknown>
  opened(value: {kind: 'editor'; editor: ClaudeNativeEditorSnapshot}): void
  reject(error: Error): void
  hold(): () => void
  editor?: ClaudeNativeEditorSnapshot & {respond(decision: ClaudeNativeEditorDecision): void; release?: () => void; responded: boolean}
}

/** One original editor invocation; saving returns its result, never an app-written setting. */
export function createClaudeNativeEditorLease(options: {
  current(): {pid: number; sessionId: string} | undefined
  ownsChild(pid: number): Promise<boolean>
  changed(): void
  failed(scope: ClaudeNativeEditorScope, error: Error): void
}) {
  let arm: EditorArm | undefined, closed = false
  const current = (value: EditorArm) => {
    const owner = options.current()
    return !closed && arm === value && owner?.pid === value.scope.pid && owner.sessionId === value.scope.sessionId
  }
  const snapshot = (value: NonNullable<EditorArm['editor']>): ClaudeNativeEditorSnapshot => ({id: value.id, revision: value.revision, scope: {...value.scope}, content: value.content, closing: value.closing})
  const report = (value: EditorArm, error: unknown) => options.failed(value.scope, error instanceof Error ? error : new Error(String(error)))
  function retire(value: EditorArm) {
    if (arm !== value) return
    arm = undefined
    const editor = value.editor
    try {
      if (editor && !editor.responded) { editor.responded = true; editor.respond({kind: 'cancel'}) }
    } catch (error) { report(value, error) }
    finally { const release = editor?.release; if (editor) editor.release = undefined; release?.(); options.changed() }
  }
  function expire() {
    const pending = arm
    if (pending && !current(pending)) { pending.reject(new Error('Native editor owner changed')); retire(pending) }
  }
  return {
    get active(): ClaudeNativeEditorSnapshot | undefined { expire(); return arm?.editor ? snapshot(arm.editor) : undefined },
    begin(scope: ClaudeNativeEditorScope, invoke: () => Promise<unknown>, hold: () => () => void): Promise<{kind: 'native'; value: unknown} | {kind: 'editor'; editor: ClaudeNativeEditorSnapshot}> {
      expire()
      if (closed || arm) return Promise.reject(new Error('An original external editor operation is already pending'))
      const owner = options.current()
      if (!owner || owner.pid !== scope.pid || owner.sessionId !== scope.sessionId) return Promise.reject(new Error('Native editor owner is unavailable'))
      let opened!: EditorArm['opened'], reject!: EditorArm['reject']
      const opening = new Promise<{kind: 'editor'; editor: ClaudeNativeEditorSnapshot}>((resolve, refuse) => { opened = resolve; reject = refuse })
      const pending: EditorArm = {scope: {...scope}, native: Promise.resolve(), opened, reject, hold}
      arm = pending
      pending.native = Promise.resolve().then(invoke).then(value => {
        if (!current(pending)) { expire(); throw new Error('Native editor owner changed before its result') }
        retire(pending)
        return value
      }, error => { report(pending, error); retire(pending); throw error })
      // The native promise stays observed after the editor offer wins. No duplicate original call is made.
      return Promise.race([pending.native.then(value => ({kind: 'native' as const, value})), opening])
    },
    async offer(offer: ClaudeNativeEditorOffer, respond: (decision: ClaudeNativeEditorDecision) => void): Promise<boolean> {
      expire()
      const pending = arm
      if (!pending || !current(pending) || pending.editor || !Number.isSafeInteger(offer.pid) || offer.pid < 2 || offer.parentPid !== pending.scope.pid || !/^[a-f0-9]{64}$/.test(offer.fileIdentity) || typeof offer.content !== 'string') return false
      let owned: boolean
      try { owned = await options.ownsChild(offer.pid) } catch (error) { report(pending, error); return false }
      expire()
      if (!owned || !current(pending) || pending.editor) return false
      const id = randomUUID(), revision = createHash('sha256').update(id + offer.fileIdentity).digest('hex')
      const release = pending.hold()
      pending.editor = {id, revision, scope: {...pending.scope}, content: offer.content, closing: false, responded: false, respond, release}
      pending.opened({kind: 'editor', editor: snapshot(pending.editor)})
      options.changed()
      return true
    },
    async finish(scope: ClaudeNativeEditorScope, revision: string, decision: ClaudeNativeEditorDecision): Promise<unknown> {
      expire()
      const pending = arm, editor = pending?.editor
      if (!pending || !editor || !current(pending) || editor.closing || editor.revision !== revision || Object.entries(pending.scope).some(([key, value]) => scope[key as keyof ClaudeNativeEditorScope] !== value)) throw new Error('Native editor changed before this decision')
      editor.closing = true; editor.responded = true
      try {
        editor.respond(decision)
        const release = editor.release; editor.release = undefined; release?.()
        options.changed()
        return await pending.native
      } catch (error) { if (arm === pending) { report(pending, error); retire(pending) }; throw error }
    },
    disconnect(id: string) {
      const pending = arm, editor = pending?.editor
      if (!pending || !editor || editor.id !== id || editor.responded) return
      editor.closing = true; editor.responded = true
      const release = editor.release; editor.release = undefined; release?.()
      report(pending, new Error('Original editor child disconnected'))
      options.changed()
    },
    detach(clientId: string) {
      const pending = arm
      if (!pending || pending.scope.clientId !== clientId) return
      pending.reject(new Error('Native editor client detached'))
      retire(pending)
    },
    close() {
      closed = true
      const pending = arm
      if (pending) { pending.reject(new Error('Native editor owner closed')); retire(pending) }
    },
  }
}
