import { createClaudeNestedActivity, type ClaudeNestedActivity } from './nested-activity.ts'
import { ClaudeProtocolError, ClaudeResultError } from './errors.ts'
import { normaliseResult, type QueryHandle } from './query.ts'
import { ControlRequestLineSchema, type ControlRequestLine, type QueryResult, type ResultLine, type StreamLine, type UserInputMessage } from './types.ts'

export interface ClaudeConversationTurn {
  handle: QueryHandle
  inputId?: string
  /** Explicit teardown won before or during consumption; never register new app ownership. */
  stopped: boolean
  /** Native process cost already accounted for before this turn. */
  costBaseline: number
  activity: ClaudeNestedActivity
}
export type ClaudeTurnConsumer = (turn: ClaudeConversationTurn) => Promise<void>
export interface ClaudeConversation {
  readonly handle: QueryHandle
  readonly busy: boolean
  readonly closing: boolean
  readonly sessionId?: string
  readonly sessionCwd?: string
  readonly done: Promise<void>
  start(input: string | UserInputMessage, consume: ClaudeTurnConsumer): string
  release(handle: QueryHandle): boolean
  ownsTurn(handle: QueryHandle): boolean
  subscribe(listener: (event: StreamLine) => void): () => void
  close(): Promise<void>
  kill(): void
}

class ConversationQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private waiting?: { resolve(value: IteratorResult<T>): void; reject(error: unknown): void }
  private ended = false
  private error?: unknown
  push(value: T): void {
    if (this.ended) return
    if (this.waiting) { this.waiting.resolve({ value, done: false }); this.waiting = undefined }
    else {
      if (this.values.length >= 4096) throw new ClaudeProtocolError('conversation turn event queue exceeded its limit')
      this.values.push(value)
    }
  }
  close(error?: unknown): void {
    this.ended = true
    this.error = error
    if (this.waiting) {
      if (error) this.waiting.reject(error)
      else this.waiting.resolve({ value: undefined as T, done: true })
      this.waiting = undefined
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => {
      if (this.error) return Promise.reject(this.error)
      if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false })
      if (this.ended) return Promise.resolve({ value: undefined as T, done: true })
      if (this.waiting) return Promise.reject(new ClaudeProtocolError('a conversation turn has one event consumer'))
      return new Promise((resolve, reject) => { this.waiting = { resolve, reject } })
    }, return: async () => ({ value: undefined as T, done: true }) }
  }
}

/** One reader for the process lifetime; an ordinary result ends only its turn. */
export function createClaudeConversation(native: QueryHandle, consumeAutonomous: ClaudeTurnConsumer): ClaudeConversation {
  type ActiveTurn = { turn: ClaudeConversationTurn; queue: ConversationQueue<StreamLine>; consumed: Promise<void>; released: Promise<void>; resolveRelease(): void; terminal: boolean; resolve(result: QueryResult): void; reject(error: unknown): void }
  const activity = createClaudeNestedActivity()
  let active: ActiveTurn | undefined
  let pending: { inputId: string; consume: ClaudeTurnConsumer } | undefined
  let closing = false
  let exited = false
  let stopped = false
  let sessionId: string | undefined
  let sessionCwd: string | undefined
  let cumulativeCost = 0
  let consumerFailure: unknown
  const listeners = new Set<(event: StreamLine) => void>()
  // Native workers can ask concurrently; present one permission or generic dialog at a time.
  const permissionRequests = new Map<string, ControlRequestLine>()
  const settledPermissions = new Set<string>()
  let presentedPermission: string | undefined
  function retirePermission(requestId: string): void {
    permissionRequests.delete(requestId)
    if (presentedPermission === requestId) presentedPermission = undefined
    settledPermissions.add(requestId)
    if (settledPermissions.size > 4096) settledPermissions.delete(settledPermissions.values().next().value!)
  }
  function clearPermissions(): void {
    permissionRequests.clear(); settledPermissions.clear(); presentedPermission = undefined
  }
  function showNextPermission(): void {
    if (presentedPermission || closing || exited || active?.terminal) return
    const next = permissionRequests.entries().next().value
    if (!next) return
    presentedPermission = next[0]
    const current = active ?? activate(consumeAutonomous)
    current.queue.push(next[1])
  }
  const processHandle: QueryHandle = { ...native, respond(requestId, response) {
    if (settledPermissions.has(requestId)) throw new ClaudeProtocolError('native permission request has already settled')
    if (permissionRequests.get(requestId)?.request.subtype === 'request_user_dialog') throw new ClaudeProtocolError('generic dialog requires its own response type')
    native.respond(requestId, response)
    if (permissionRequests.has(requestId)) {
      retirePermission(requestId)
      try { showNextPermission() } catch (error) {
        closing = true; activity.close(); clearPermissions(); native.kill()
        throw error
      }
    }
  }, cancelUserDialog(requestId) {
    if (settledPermissions.has(requestId) || permissionRequests.get(requestId)?.request.subtype !== 'request_user_dialog') throw new ClaudeProtocolError('generic dialog is no longer pending')
    native.cancelUserDialog(requestId)
    retirePermission(requestId)
    try { showNextPermission() } catch (error) {
      closing = true; activity.close(); clearPermissions(); native.kill(); throw error
    }
  } }


  function activate(consume: ClaudeTurnConsumer, inputId?: string): ActiveTurn {
    const queue = new ConversationQueue<StreamLine>()
    let resolve!: (result: QueryResult) => void
    let reject!: (error: unknown) => void
    const result = new Promise<QueryResult>((yes, no) => { resolve = yes; reject = no })
    result.catch(() => {})
    const turn = { handle: { ...processHandle, events: queue, result }, inputId, stopped, costBaseline: cumulativeCost, activity }
    let resolveRelease!: () => void
    const released = new Promise<void>(resolve => { resolveRelease = resolve })
    const current: ActiveTurn = { turn, queue, resolve, reject, released, resolveRelease, terminal: false, consumed: Promise.resolve() }
    active = current
    current.consumed = Promise.resolve().then(() => consume(turn)).catch(error => {
      consumerFailure = error
      closing = true
      native.kill()
      throw error
    })
    current.consumed.catch(() => {})
    return current
  }

  const done = (async () => {
    let failure: unknown
    try {
      for await (const event of native.events) {
        const line = event as Record<string, unknown>
        if (line.type === 'conversation_reset') {
          if (typeof line.new_conversation_id !== 'string' || !line.new_conversation_id.trim()) {
            throw new ClaudeProtocolError('native conversation reset has no identity')
          }
          // Native resets its cost ledger independently of the later session/init identity.
          cumulativeCost = 0
          if (active) active.turn.costBaseline = 0
        }
        if (line.type === 'system' && line.subtype === 'init') {
          if (typeof line.session_id === 'string' && line.session_id) sessionId = line.session_id
          if (typeof line.cwd === 'string' && line.cwd) sessionCwd = line.cwd
        }
        if (pending && line.type === 'command_lifecycle' && line.command_uuid === pending.inputId && line.state === 'started') {
          if (active) throw new ClaudeProtocolError('native inputs overlapped before the prior turn completed')
          activate(pending.consume, pending.inputId)
          pending = undefined
        }
        if (pending && line.type === 'command_lifecycle' && line.command_uuid === pending.inputId
          && ['cancelled', 'discarded', 'refused'].includes(String(line.state))) {
          if (active) throw new ClaudeProtocolError('pending input ended while another turn was active')
          const rejected = activate(pending.consume, pending.inputId)
          pending = undefined
          const error = new ClaudeProtocolError(`native input ${String(line.state)} before starting`)
          rejected.reject(error)
          rejected.queue.close(error)
          await rejected.consumed
          if (active === rejected) active = undefined
          for (const listener of listeners) { try { listener(event) } catch { /* isolate observers */ } }
          continue
        }
        const nested = activity.receive(event)
        for (const listener of listeners) { try { listener(event) } catch { /* isolate raw observers */ } }
        if (nested) continue
        if (line.type === 'control_request') {
          const parsed = ControlRequestLineSchema.safeParse(event)
          if (!parsed.success) throw new ClaudeProtocolError('malformed native control request')
          const request = parsed.data
          if (request.request.subtype === 'can_use_tool' || request.request.subtype === 'request_user_dialog') {
            const id = request.request_id
            if (!id) throw new ClaudeProtocolError('native permission request has no identity')
            if (settledPermissions.has(id) || permissionRequests.has(id)) continue
            if (permissionRequests.size >= 4096) throw new ClaudeProtocolError('native permission queue exceeded its limit')
            permissionRequests.set(id, request)
            showNextPermission()
            continue
          }
        }
        if (line.type === 'control_cancel_request') {
          const id = line.request_id
          if (typeof id !== 'string' || !id) throw new ClaudeProtocolError('native permission cancellation has no identity')
          if (permissionRequests.has(id)) {
            const wasPresented = presentedPermission === id
            retirePermission(id)
            if (wasPresented) (active ?? activate(consumeAutonomous)).queue.push(event)
            showNextPermission()
            continue
          }
        }
        if (!active && (line.type === 'assistant' || line.type === 'result'
          || line.type === 'stream_event' || line.type === 'control_request')) activate(consumeAutonomous)
        const current = active
        if (!current) continue
        if (line.type !== 'result') { current.queue.push(event); continue }
        const raw = event as ResultLine
        if (current.turn.inputId && raw.user_message_uuid && raw.user_message_uuid !== current.turn.inputId) {
          throw new ClaudeProtocolError('native result belongs to a different input')
        }
        current.queue.push(event)
        const normalized = normaliseResult(raw)
        cumulativeCost = Math.max(cumulativeCost, normalized.totalCostUsd)
        if (raw.subtype === 'success' && raw.is_error !== true) current.resolve(normalized)
        else current.reject(new ClaudeResultError(raw.subtype, raw.errors?.length ? raw.errors : raw.result ? [raw.result] : [], raw.session_id))
        current.terminal = true
        current.queue.close()
        // A released terminal consumer may close this process while replaying a queued input.
        // Waiting for that consumer here would make close wait on itself.
        await Promise.race([current.consumed, current.released])
        if (active === current) active = undefined
        showNextPermission()
      }
    } catch (error) { failure = error; native.kill() }
    finally {
      failure ??= consumerFailure
      exited = true
      closing = true
      while (active || pending) {
        if (!active && pending) { activate(pending.consume, pending.inputId); pending = undefined }
        const current = active
        if (!current) break
        const error = failure ?? new ClaudeProtocolError('conversation exited before the turn completed')
        current.reject(error)
        current.queue.close(error)
        await current.consumed.catch(() => {})
        if (active === current) active = undefined
      }
      activity.close()
      clearPermissions()
      listeners.clear()
    }
    if (failure) throw failure
  })()
  done.catch(() => {})

  return {
    handle: processHandle,
    get busy() { return active !== undefined || pending !== undefined || permissionRequests.size > 0 },
    get closing() { return closing || exited },
    get sessionId() { return sessionId },
    get sessionCwd() { return sessionCwd },
    done,
    start(input, consume) {
      if (closing || exited) throw new ClaudeProtocolError('conversation is closed')
      if (active || pending || permissionRequests.size) throw new ClaudeProtocolError('conversation already has an active input or permission request')
      const inputId = native.send(input)
      pending = { consume, inputId }
      return inputId
    },
    ownsTurn(handle) { return active?.turn.handle === handle },
    release(handle) {
      if (active?.turn.handle !== handle) return false
      if (!active.terminal) {
        const error = new ClaudeProtocolError('conversation turn was stopped before completion')
        stopped = true
        active.turn.stopped = true
        closing = true
        active.reject(error)
        active.queue.close(error)
        activity.close()
        clearPermissions()
        native.kill()
      } else { active.queue.close(); active.resolveRelease() }
      active = undefined
      return true
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async close() {
      closing = true
      await native.close()
      await done
    },
    kill() { activity.close(); clearPermissions(); stopped = true; if (active) active.turn.stopped = true; closing = true; native.kill() },
  }
}
